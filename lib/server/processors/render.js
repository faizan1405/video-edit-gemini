import path from "node:path";
import { escapeSubtitlesPath, runFfmpeg } from "../ffmpeg.js";
import { appConfig } from "../../config.js";
import {
  buildAssetFilter,
  buildOverlayPosition,
  selectAnimationPreset,
} from "./broll-animations.js";

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
  const pipBorder = 4; // dark border around PiP for visual separation from B-roll
  const outputPath = path.join(jobDir, "edited-with-broll.mp4");

  // Transition config — resolved once, applied per-segment.
  const useTransitions = appConfig.brollTransitionType !== "none";
  const fadeInSecs = appConfig.brollFadeInMs / 1000;
  const fadeOutSecs = appConfig.brollFadeOutMs / 1000;

  const args = ["-y", "-i", baseVideoPath];

  // Split base video into two streams: [base0] for the overlay pipeline and
  // [pipraw] which is scaled down and then split into one copy per B-roll
  // segment.  FFmpeg's filtergraph does NOT allow the same named output pad to
  // be consumed by more than one filter, so we must produce N distinct [pipN]
  // labels — one per segment — instead of reusing a single [pip].
  //
  // The PiP gets a dark border (pad) to visually separate it from the B-roll
  // background, giving a premium floating-window effect.
  const pipLabels = validSegments.map((_, i) => `[pip${i}]`).join("");
  const pipFilter = `scale=${pipWidth}:-2,setsar=1,pad=w=iw+${pipBorder * 2}:h=ih+${pipBorder * 2}:x=${pipBorder}:y=${pipBorder}:color=0x1a1a1a`;
  const filterParts = [
    `[0:v]split=2[base0][pipraw]`,
    validSegments.length === 1
      ? `[pipraw]${pipFilter}[pip0]`
      : `[pipraw]${pipFilter},split=${validSegments.length}${pipLabels}`
  ];

  let currentLabel = "base0";
  const usedPresets = []; // tracks chosen presets for anti-repetition

  for (const [index, segment] of validSegments.entries()) {
    const inputIndex = index + 1;
    const overlayLabel = `overlay${index}`;
    const outputLabel = `out${index}`;

    // ── Animation preset selection ───────────────────────────────────────────
    // Each segment gets its own preset from the animation library.
    // The selection rotates through the pool while avoiding immediate repeats.
    const preset = selectAnimationPreset(segment.asset.type, usedPresets, index);
    usedPresets.push(preset);

    // ── Asset input registration ─────────────────────────────────────────────
    if (segment.asset.type === "video") {
      args.push("-stream_loop", "-1", "-i", segment.asset.localPath);
    } else {
      args.push("-loop", "1", "-framerate", "30", "-i", segment.asset.localPath);
    }

    // ── Asset stream filter ──────────────────────────────────────────────────
    // Handles scale, directional crop, RGBA conversion, opacity, and fades.
    const assetFilter = buildAssetFilter({
      preset,
      assetType: segment.asset.type,
      width,
      height,
      segment,
      fadeInSecs,
      fadeOutSecs,
      useTransitions,
    });
    filterParts.push(`[${inputIndex}:v]${assetFilter}[asset${index}]`);

    // ── Overlay position ─────────────────────────────────────────────────────
    // For slide presets, x/y are time-based expressions that animate the
    // B-roll from off-screen into position.  For all others, x=0 y=0.
    const { x: overlayX, y: overlayY } = buildOverlayPosition({
      preset,
      segment,
      useTransitions,
    });

    const enable = `between(t,${formatSeconds(segment.startSeconds)},${formatSeconds(
      segment.endSeconds
    )})`;

    // Main B-roll overlay: asset covers full canvas at animated position
    filterParts.push(
      `[${currentLabel}][asset${index}]overlay=x='${overlayX}':y='${overlayY}':enable='${enable}'[${overlayLabel}]`
    );
    // PiP overlay: scaled-down base video (speaker) at bottom-right corner
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
