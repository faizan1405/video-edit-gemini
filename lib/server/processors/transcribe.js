import fs from "node:fs";
import OpenAI from "openai";
import { appConfig, requireEnv } from "../../config.js";

let openAiClient;

function getClient() {
  if (!openAiClient) {
    openAiClient = new OpenAI({
      apiKey: requireEnv("OPENAI_API_KEY", appConfig.openAiApiKey)
    });
  }

  return openAiClient;
}

function normalizeWord(word, index) {
  return {
    id: `w-${index}`,
    token: String(word.word || word.token || "").trim(),
    startSeconds: Number(word.start || word.startSeconds || 0),
    endSeconds: Number(word.end || word.endSeconds || 0)
  };
}

function normalizeSegment(segment, index) {
  return {
    id: `s-${index}`,
    text: String(segment.text || "").trim(),
    startSeconds: Number(segment.start || segment.startSeconds || 0),
    endSeconds: Number(segment.end || segment.endSeconds || 0)
  };
}

export async function transcribeAudio(audioPath) {
  const client = getClient();

  const response = await client.audio.transcriptions.create({
    file: fs.createReadStream(audioPath),
    model: appConfig.openAiTranscriptionModel,
    response_format: "verbose_json",
    timestamp_granularities: ["segment", "word"]
  });

  return {
    language: response.language || "",
    text: response.text || "",
    segments: (response.segments || []).map(normalizeSegment),
    words: (response.words || []).map(normalizeWord)
  };
}
