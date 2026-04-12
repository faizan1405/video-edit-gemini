import path from "node:path";
import { escapeSubtitlesPath, runFfmpeg } from "../ffmpeg.js";
import { appConfig } from "../../config.js";

function getCanvasSize(aspectRatio) {
  return aspectRatio === "16:9"
    ? { width: 1920, height: 1080 }
    : { width: 1080, height: 1920 };
}

function getScaleCropFilter(aspectRatio) {
  const { width, height } = getCanvasSize(aspectRatio);
  return `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},setsar=1`;
}

function formatSeconds(value) {
  return Number(value).toFixed(3);
}

// Round up to the nearest even integer (required by libx264 for width/height).
function toEvenCeil(n) {
  const v = Math.ceil(n);
  return v % 2 === 0 ? v : v + 1;
}

export async function renderEditedBaseVideo({
  inputPath,
  jobDir,
  sourceDurationSeconds,
  aspectRatio
}) {
  // Render the FULL original video — no trimming, no silence removal.
  // Scale/crop to the target aspect ratio and normalize to 30fps H.264.
  const baseVideoPath = path.join(jobDir, "edited-base.mp4");
  const videoFilter = getScaleCropFilter(aspectRatio);

  const args = [
    "-y",
    "-i", inputPath
  ];

  // If duration is known, cap to it (avoids any overrun on corrupted files)
  if (sourceDurationSeconds && sourceDurationSeconds > 0) {
    args.push("-t", formatSeconds(sourceDurationSeconds));
  }

  args.push(
    "-vf", videoFilter,
    "-r", "30",
    "-pix_fmt", "yuv420p",
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-crf", "20",
    "-c:a", "aac",
    "-b:a", "192k",
    "-movflags", "+faststart",
    baseVideoPath
  );

  await runFfmpeg(args);
  return baseVideoPath;
}

export async function renderBrollComposite({
  baseVideoPath,
  jobDir,
  brollSegments,
  aspectRatio
}) {
  // Filter out any segments whose asset failed to download
  const validSegments = brollSegments.filter(
    (s) => s.asset && s.asset.localPath
  );

  if (!validSegments.length) {
    return baseVideoPath;
  }

  const { width, height } = getCanvasSize(aspectRatio);
  const pipWidth = aspectRatio === "16:9" ? 360 : 280;
  const pipBottomMargin = aspectRatio === "16:9" ? 56 : 240;
  const outputPath = path.join(jobDir, "edited-with-broll.mp4");

  // Transition config — resolved once, applied per-segment.
  const useTransitions = appConfig.brollTransitionType !== "none";
  const fadeInSecs = appConfig.brollFadeInMs / 1000;
  const fadeOutSecs = appConfig.brollFadeOutMs / 1000;
  const zoomStrength = appConfig.brollZoomStrength;

  const args = ["-y", "-i", baseVideoPath];

  // Split base video into two streams: [base0] for the overlay pipeline and
  // [pipraw] which is scaled down and then split into one copy per B-roll
  // segment.  FFmpeg's filtergraph does NOT allow the same named output pad to
  // be consumed by more than one filter, so we must produce N distinct [pipN]
  // labels — one per segment — instead of reusing a single [pip].
  const pipLabels = validSegments.map((_, i) => `[pip${i}]`).join("");
  const filterParts = [
    `[0:v]split=2[base0][pipraw]`,
    validSegments.length === 1
      ? `[pipraw]scale=${pipWidth}:-2,setsar=1[pip0]`
      : `[pipraw]scale=${pipWidth}:-2,setsar=1,split=${validSegments.length}${pipLabels}`
  ];

  let currentLabel = "base0";

  for (const [index, segment] of validSegments.entries()) {
    const inputIndex = index + 1;
    const overlayLabel = `overlay${index}`;
    const outputLabel = `out${index}`;

    // Per-segment fade timing uses absolute video timestamps so the fade filter
    // (which references the asset stream's own pts, which mirrors main-video time
    // because all inputs start at t=0 together) fires at the right moment.
    const segDur = segment.endSeconds - segment.startSeconds;
    // Clamp fade durations so they never overlap on very short B-roll clips.
    const maxFadeEach = Math.max(0, (segDur - 0.1) / 2);
    const fi = Math.min(fadeInSecs, maxFadeEach);
    const fo = Math.min(fadeOutSecs, maxFadeEach);
    const fadeInSt = formatSeconds(segment.startSeconds);
    const fadeOutSt = formatSeconds(
      Math.max(segment.startSeconds + fi, segment.endSeconds - fo - 0.05)
    );
    const fadeFilters =
      useTransitions && fi > 0
        ? `,fade=type=in:st=${fadeInSt}:d=${fi.toFixed(3)}:alpha=1,fade=type=out:st=${fadeOutSt}:d=${fo.toFixed(3)}:alpha=1`
        : "";

    if (segment.asset.type === "video") {
      args.push("-stream_loop", "-1", "-i", segment.asset.localPath);
      filterParts.push(
        `[${inputIndex}:v]scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},setsar=1,format=rgba${fadeFilters}[asset${index}]`
      );
    } else {
      args.push("-loop", "1", "-framerate", "30", "-i", segment.asset.localPath);
      // Images get a subtle static zoom: scale slightly larger than the canvas,
      // then center-crop back.  This gives a "close-up" feel with no zoompan overhead.
      const imgW = useTransitions && zoomStrength > 1.0 ? toEvenCeil(width * zoomStrength) : width;
      const imgH = useTransitions && zoomStrength > 1.0 ? toEvenCeil(height * zoomStrength) : height;
      filterParts.push(
        `[${inputIndex}:v]scale=${imgW}:${imgH}:force_original_aspect_ratio=increase,crop=${width}:${height},setsar=1,format=rgba,colorchannelmixer=aa=0.98${fadeFilters}[asset${index}]`
      );
    }

    const enable = `between(t,${formatSeconds(segment.startSeconds)},${formatSeconds(
      segment.endSeconds
    )})`;

    filterParts.push(
      `[${currentLabel}][asset${index}]overlay=0:0:enable='${enable}'[${overlayLabel}]`
    );
    filterParts.push(
      `[${overlayLabel}][pip${index}]overlay=W-w-48:H-h-${pipBottomMargin}:enable='${enable}'[${outputLabel}]`
    );

    currentLabel = outputLabel;
  }

  args.push(
    "-filter_complex",
    filterParts.join(";"),
    "-map",
    `[${currentLabel}]`,
    "-map",
    "0:a?",
    "-shortest",
    "-c:v",
    "libx264",
    "-preset",
    "medium",
    "-crf",
    "20",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    "-movflags",
    "+faststart",
    outputPath
  );

  await runFfmpeg(args);
  return outputPath;
}

export async function burnCaptions({
  inputPath,
  jobDir,
  assPath
}) {
  const outputPath = path.join(jobDir, "final-output.mp4");

  // Use just the filename (not the full path) and run FFmpeg with cwd set to
  // the job directory.  This avoids libass failures on Windows when the project
  // path contains spaces (e.g. "video edit gemini").
  const assFilename = path.basename(assPath);

  await runFfmpeg([
    "-y",
    "-i",
    inputPath,
    "-vf",
    `subtitles='${escapeSubtitlesPath(assFilename)}'`,
    "-map",
    "0:v:0",
    "-map",
    "0:a?",
    "-c:v",
    "libx264",
    "-preset",
    "medium",
    "-crf",
    "18",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "copy",
    "-movflags",
    "+faststart",
    outputPath
  ], { cwd: jobDir });

  return outputPath;
}
