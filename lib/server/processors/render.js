import fs from "node:fs/promises";
import path from "node:path";
import { ensureDir } from "../fs-utils.js";
import { escapeSubtitlesPath, runFfmpeg } from "../ffmpeg.js";

function getCanvasSize(aspectRatio) {
  return aspectRatio === "16:9"
    ? { width: 1920, height: 1080 }
    : { width: 1080, height: 1920 };
}

function getScaleCropFilter(aspectRatio) {
  const { width, height } = getCanvasSize(aspectRatio);
  return `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},setsar=1`;
}

function quoteConcatPath(filePath) {
  return filePath.replace(/\\/g, "/").replace(/'/g, "'\\''");
}

function formatSeconds(value) {
  return Number(value).toFixed(3);
}

export async function renderEditedBaseVideo({
  inputPath,
  jobDir,
  segments,
  aspectRatio
}) {
  if (!segments.length) {
    throw new Error("The smart-cut timeline is empty, so there is nothing to render.");
  }

  const segmentDir = path.join(jobDir, "render-segments");
  await ensureDir(segmentDir);

  const videoFilter = getScaleCropFilter(aspectRatio);
  const renderedSegmentPaths = [];

  for (const [index, segment] of segments.entries()) {
    const segmentDuration = segment.sourceEndSeconds - segment.sourceStartSeconds;
    const outputPath = path.join(
      segmentDir,
      `segment-${String(index).padStart(3, "0")}.mp4`
    );

    await runFfmpeg([
      "-y",
      "-i",
      inputPath,
      "-ss",
      formatSeconds(segment.sourceStartSeconds),
      "-t",
      formatSeconds(segmentDuration),
      "-vf",
      videoFilter,
      "-r",
      "30",
      "-pix_fmt",
      "yuv420p",
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "20",
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      "-movflags",
      "+faststart",
      outputPath
    ]);

    renderedSegmentPaths.push(outputPath);
  }

  const concatFilePath = path.join(segmentDir, "concat.txt");
  const concatFileBody = renderedSegmentPaths
    .map((filePath) => `file '${quoteConcatPath(filePath)}'`)
    .join("\n");

  await fs.writeFile(concatFilePath, concatFileBody, "utf8");

  const baseVideoPath = path.join(jobDir, "edited-base.mp4");

  await runFfmpeg([
    "-y",
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    concatFilePath,
    "-c",
    "copy",
    "-movflags",
    "+faststart",
    baseVideoPath
  ]);

  return baseVideoPath;
}

export async function renderBrollComposite({
  baseVideoPath,
  jobDir,
  brollSegments,
  aspectRatio
}) {
  if (!brollSegments.length) {
    return baseVideoPath;
  }

  const { width, height } = getCanvasSize(aspectRatio);
  const pipWidth = aspectRatio === "16:9" ? 360 : 280;
  const pipBottomMargin = aspectRatio === "16:9" ? 56 : 240;
  const outputPath = path.join(jobDir, "edited-with-broll.mp4");

  const args = ["-y", "-i", baseVideoPath];
  const filterParts = [`[0:v]split=2[base0][pip0]`, `[pip0]scale=${pipWidth}:-2,setsar=1[pip]`];
  let currentLabel = "base0";

  for (const [index, segment] of brollSegments.entries()) {
    const inputIndex = index + 1;
    const overlayLabel = `overlay${index}`;
    const outputLabel = `out${index}`;

    if (segment.asset?.type === "video") {
      args.push("-stream_loop", "-1", "-i", segment.asset.localPath);
      filterParts.push(
        `[${inputIndex}:v]scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},setsar=1,format=rgba[asset${index}]`
      );
    } else {
      args.push("-loop", "1", "-framerate", "30", "-i", segment.asset.localPath);
      filterParts.push(
        `[${inputIndex}:v]scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},setsar=1,format=rgba,colorchannelmixer=aa=0.98[asset${index}]`
      );
    }

    const enable = `between(t,${formatSeconds(segment.startSeconds)},${formatSeconds(
      segment.endSeconds
    )})`;

    filterParts.push(
      `[${currentLabel}][asset${index}]overlay=0:0:enable='${enable}'[${overlayLabel}]`
    );
    filterParts.push(
      `[${overlayLabel}][pip]overlay=W-w-48:H-h-${pipBottomMargin}:enable='${enable}'[${outputLabel}]`
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

  await runFfmpeg([
    "-y",
    "-i",
    inputPath,
    "-vf",
    `subtitles='${escapeSubtitlesPath(assPath)}'`,
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
  ]);

  return outputPath;
}
