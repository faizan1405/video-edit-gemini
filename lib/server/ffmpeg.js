import { spawn } from "node:child_process";
import ffmpegPath from "ffmpeg-static";
import ffprobeStatic from "ffprobe-static";

function getBinaryPath(binaryPath, label) {
  if (!binaryPath) {
    throw new Error(
      `${label} binary was not found. Install dependencies so the packaged binary is available.`
    );
  }

  return binaryPath;
}

export async function runProcess(binaryPath, args, options = {}) {
  const resolvedBinaryPath = getBinaryPath(binaryPath, options.label || "Binary");

  return new Promise((resolve, reject) => {
    const child = spawn(resolvedBinaryPath, args, {
      cwd: options.cwd || process.cwd(),
      env: process.env
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(
          new Error(
            `${options.label || "Process"} exited with code ${code}\n${stderr}`
          )
        );
        return;
      }

      resolve({ stdout, stderr });
    });
  });
}

export async function runFfmpeg(args, options = {}) {
  return runProcess(ffmpegPath, args, { ...options, label: "FFmpeg" });
}

export async function runFfprobe(args, options = {}) {
  return runProcess(ffprobeStatic.path, args, { ...options, label: "FFprobe" });
}

export async function inspectMedia(inputPath) {
  const { stdout } = await runFfprobe([
    "-v",
    "error",
    "-show_entries",
    "format=duration:stream=index,codec_type,width,height,r_frame_rate",
    "-of",
    "json",
    inputPath
  ]);

  const parsed = JSON.parse(stdout);
  const videoStream = (parsed.streams || []).find(
    (stream) => stream.codec_type === "video"
  );

  return {
    durationSeconds: Number(parsed.format?.duration || 0),
    width: Number(videoStream?.width || 0),
    height: Number(videoStream?.height || 0),
    frameRate: videoStream?.r_frame_rate || "30/1"
  };
}

export function escapeSubtitlesPath(filePath) {
  return filePath
    .replace(/\\/g, "/")
    .replace(/:/g, "\\:")
    .replace(/'/g, "\\'");
}
