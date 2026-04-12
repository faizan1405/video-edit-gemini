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

const LANGUAGE_PROMPTS = {
  hi: "यह एक हिंदी वीडियो है। कृपया हिंदी शब्दों को सटीक रूप से ट्रांसक्राइब करें।",
  hinglish:
    "This is a Hinglish video mixing Hindi and English words. Transcribe both languages accurately as spoken.",
  en: "This is an English language video. Please transcribe clearly and accurately."
};

const LANGUAGE_CODE_MAP = {
  hi: "hi",
  hinglish: "hi",
  en: "en",
  auto: undefined
};

export async function transcribeAudio(audioPath, captionLanguage = "auto") {
  const client = getClient();

  const whisperLanguage = LANGUAGE_CODE_MAP[captionLanguage];
  const prompt = LANGUAGE_PROMPTS[captionLanguage];

  const requestOptions = {
    file: fs.createReadStream(audioPath),
    model: appConfig.openAiTranscriptionModel,
    response_format: "verbose_json",
    timestamp_granularities: ["segment", "word"]
  };

  if (whisperLanguage) {
    requestOptions.language = whisperLanguage;
  }

  if (prompt) {
    requestOptions.prompt = prompt;
  }

  const response = await client.audio.transcriptions.create(requestOptions);

  // For Hinglish, override the detected language so downstream code applies the right font
  const detectedLanguage =
    captionLanguage === "hinglish" ? "hinglish" : response.language || "";

  return {
    language: detectedLanguage,
    captionLanguage,
    text: response.text || "",
    segments: (response.segments || []).map(normalizeSegment),
    words: (response.words || []).map(normalizeWord)
  };
}
