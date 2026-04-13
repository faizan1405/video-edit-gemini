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
    // Use ?? instead of || so that legitimate 0-second timestamps are preserved
    // (0 is falsy with ||, causing words at position 0 to lose their timing).
    startSeconds: Number(word.start ?? word.startSeconds ?? 0),
    endSeconds: Number(word.end ?? word.endSeconds ?? 0)
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

// Language-specific prompts help the transcription model focus on the right vocabulary.
const LANGUAGE_PROMPTS = {
  hi: "यह एक हिंदी वीडियो है। कृपया हिंदी शब्दों को सटीक रूप से ट्रांसक्राइब करें।",
  hinglish:
    "This is a Hinglish video mixing Hindi and English words. Transcribe every word exactly as spoken — preserve the original Hindi and English mix, do not translate or paraphrase.",
  en: "This is an English language video. Transcribe every word exactly as spoken, preserving the speaker's natural phrasing and informal language."
};

const LANGUAGE_CODE_MAP = {
  hi: "hi",
  hinglish: "hi",
  en: "en",
  auto: undefined
};

// whisper-1 supports verbose_json with word-level timestamps.
// gpt-4o-transcribe / gpt-4o-mini-transcribe only support "json" and return
// text-only (no words, no segments). We detect the model family so the right
// format is sent, and fall back to whisper-1 when timestamps are needed.
function isWhisperModel(model) {
  return String(model).startsWith("whisper");
}

/**
 * Call the transcription endpoint with a specific model.
 * Returns the normalised transcription object on success.
 */
async function attemptTranscription(client, audioPath, model, captionLanguage) {
  const whisperLanguage = LANGUAGE_CODE_MAP[captionLanguage];
  const prompt = LANGUAGE_PROMPTS[captionLanguage];

  const useVerboseJson = isWhisperModel(model);

  const requestOptions = {
    file: fs.createReadStream(audioPath),
    model,
    response_format: useVerboseJson ? "verbose_json" : "json"
  };

  // timestamp_granularities is only supported with verbose_json (whisper-1).
  if (useVerboseJson) {
    requestOptions.timestamp_granularities = ["segment", "word"];
  }

  if (whisperLanguage) requestOptions.language = whisperLanguage;
  if (prompt) requestOptions.prompt = prompt;

  const response = await client.audio.transcriptions.create(requestOptions);

  const rawWords = response.words || response.word_timestamps || [];

  // For Hinglish, override the detected language so downstream code applies the
  // right font (Nirmala UI for Devanagari) rather than whatever the model guesses.
  const detectedLanguage =
    captionLanguage === "hinglish" ? "hinglish" : response.language || "";

  return {
    language: detectedLanguage,
    captionLanguage,
    text: response.text || "",
    segments: (response.segments || []).map(normalizeSegment),
    words: rawWords.map(normalizeWord)
  };
}

/**
 * Transcribe the audio at audioPath.
 *
 * Strategy:
 *   1. Try the primary model (configured via TRANSCRIPTION_MODEL).
 *   2. If the primary model returns text but NO word timestamps (gpt-4o-transcribe
 *      models only return text), re-transcribe with whisper-1 to obtain timestamps,
 *      then merge: keep the primary model's superior text, use whisper's timing.
 *   3. If the primary call fails entirely, fall back to the configured fallback model.
 *   4. If the fallback also has no words, try whisper-1 one more time for timestamps.
 */
export async function transcribeAudio(audioPath, captionLanguage = "auto") {
  const client = getClient();
  const primaryModel = appConfig.openAiTranscriptionModel;
  const fallbackModel = appConfig.openAiTranscriptionFallbackModel;

  let bestTextResult = null;

  try {
    const result = await attemptTranscription(client, audioPath, primaryModel, captionLanguage);
    console.log(
      `[transcribe] Model=${primaryModel} words=${result.words.length} lang=${result.language}`
    );

    // Only trust word timestamps from whisper models — they use verbose_json
    // with timestamp_granularities and return complete, reliable per-word timing.
    // Non-whisper models (gpt-4o-transcribe, gpt-4o-mini-transcribe) may return
    // a partial/incomplete words array that only covers the first and last few
    // seconds, causing captions and B-roll to be generated for only those edges.
    if (result.words.length > 0 && isWhisperModel(primaryModel)) {
      return result;
    }

    // Primary model returned text but no reliable word timestamps.
    // Save the text result and fall through to whisper-1 for timestamps.
    bestTextResult = result;
    console.log(
      `[transcribe] ${primaryModel} returned ${result.words.length} words but is non-whisper model — will use whisper-1 for reliable timing`
    );
  } catch (primaryErr) {
    // Only attempt fallback when a different model is configured.
    if (fallbackModel && fallbackModel !== primaryModel) {
      console.warn(
        `[transcribe] Primary model "${primaryModel}" failed — retrying with "${fallbackModel}":`,
        primaryErr?.message || primaryErr
      );
      try {
        const result = await attemptTranscription(client, audioPath, fallbackModel, captionLanguage);
        console.log(
          `[transcribe] Fallback model=${fallbackModel} words=${result.words.length} lang=${result.language}`
        );
        if (result.words.length > 0 && isWhisperModel(fallbackModel)) {
          return result;
        }
        bestTextResult = result;
        console.log(
          `[transcribe] ${fallbackModel} returned ${result.words.length} words but is non-whisper model — will use whisper-1 for reliable timing`
        );
      } catch (fallbackErr) {
        console.error(
          `[transcribe] Fallback model "${fallbackModel}" also failed:`,
          fallbackErr?.message || fallbackErr
        );
        throw fallbackErr;
      }
    } else {
      throw primaryErr;
    }
  }

  // If we reach here, we have text from a non-whisper model but need timestamps.
  // Use whisper-1 which supports verbose_json with word-level timing.
  const whisperResult = await attemptTranscription(client, audioPath, "whisper-1", captionLanguage);
  console.log(
    `[transcribe] whisper-1 timestamp pass: words=${whisperResult.words.length} lang=${whisperResult.language}`
  );

  if (!bestTextResult || !bestTextResult.text) {
    return whisperResult;
  }

  // Merge: prefer the primary model's text + language, use whisper's timing.
  return {
    language: bestTextResult.language || whisperResult.language,
    captionLanguage: bestTextResult.captionLanguage,
    text: bestTextResult.text,
    segments: whisperResult.segments,
    words: whisperResult.words
  };
}
