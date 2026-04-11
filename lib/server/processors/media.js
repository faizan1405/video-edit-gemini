import path from "node:path";
import { runFfmpeg } from "../ffmpeg.js";

export async function extractTranscriptionAudio(jobDir, inputPath) {
  const audioPath = path.join(jobDir, "audio-for-transcription.mp3");

  await runFfmpeg([
    "-y",
    "-i",
    inputPath,
    "-vn",
    "-ac",
    "1",
    "-ar",
    "16000",
    "-b:a",
    "64k",
    audioPath
  ]);

  return audioPath;
}
