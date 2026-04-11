import { runFfmpeg } from "../ffmpeg.js";

function parseSilenceLog(stderr) {
  const lines = stderr.split(/\r?\n/);
  const events = [];
  let currentStart = null;

  for (const line of lines) {
    const startMatch = line.match(/silence_start:\s*([0-9.]+)/);
    if (startMatch) {
      currentStart = Number(startMatch[1]);
      continue;
    }

    const endMatch = line.match(
      /silence_end:\s*([0-9.]+)\s*\|\s*silence_duration:\s*([0-9.]+)/
    );

    if (endMatch) {
      events.push({
        startSeconds: currentStart ?? Number(endMatch[1]) - Number(endMatch[2]),
        endSeconds: Number(endMatch[1]),
        durationSeconds: Number(endMatch[2])
      });
      currentStart = null;
    }
  }

  return events;
}

export async function detectSilences(audioPath) {
  const { stderr } = await runFfmpeg([
    "-i",
    audioPath,
    "-af",
    "silencedetect=noise=-35dB:d=0.45",
    "-f",
    "null",
    "-"
  ]);

  return parseSilenceLog(stderr);
}
