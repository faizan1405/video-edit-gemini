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
  hi: "यह एक हिंदी वीडियो है। कृपया हिंदी शब्दों को सटीक रूप से ट्रांसक्राइब करें। शब्दों को बिल्कुल वैसे ही लिखें जैसे बोले गए हैं।",
  hinglish:
    "This audio is Hinglish — Hindi and English code-mixed naturally. Transcribe exactly as spoken: keep Hindi words in Devanagari script (e.g. क्या, मतलब, नहीं, है, हम, तुम, पति, पत्नी, कानूनी, ऊपर) and English words in English script (e.g. actually, basically, like, law, legal, rights). Do NOT translate. Do NOT romanise Hindi. Preserve every filler, name, brand, and slang word exactly.",
  en: "This is an English language video. Transcribe every word exactly as spoken, preserving the speaker's natural phrasing and informal language.",
  auto: "The audio may be Hindi, English, or Hinglish (code-mixed). Transcribe exactly as spoken — keep Hindi words in Devanagari, English words in English, and do not translate or paraphrase."
};

const LANGUAGE_CODE_MAP = {
  hi: "hi",
  hinglish: "hi",
  en: "en",
  auto: undefined
};

// Only whisper-1 supports verbose_json with word-level timestamps.
// gpt-4o-transcribe / gpt-4o-mini-transcribe only support "json" format
// (confirmed by API: verbose_json returns 400 for these models).
function isWhisperModel(model) {
  return String(model).startsWith("whisper");
}

/**
 * Call the transcription endpoint with a specific model.
 * Returns the normalised transcription object on success.
 */
async function attemptTranscription(client, audioPath, model, captionLanguage) {
  const whisperLanguage = LANGUAGE_CODE_MAP[captionLanguage];
  const prompt = LANGUAGE_PROMPTS[captionLanguage] || LANGUAGE_PROMPTS.auto;

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

// ── Text alignment ─────────────────────────────────────────────────────────────
// gpt-4o-transcribe returns better text (especially for Hinglish) but no word
// timestamps.  whisper-1 returns word timestamps but worse tokens.  This function
// replaces whisper tokens with the gpt-4o-transcribe words while preserving
// whisper's timing, so captions show accurate text at correct positions.

/**
 * Normalize a token for fuzzy matching: lowercase, strip punctuation, collapse whitespace.
 */
function norm(token) {
  return String(token || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "")
    .trim();
}

/**
 * Align two word arrays using a simple greedy forward-matching algorithm.
 *
 * For each gpt-4o word, try to find a matching whisper word nearby (within a
 * sliding window).  When a match is found, replace the whisper token with the
 * gpt-4o token (preserving whisper's timing).  Unmatched whisper words keep
 * their original token — this is safe because the cleanup step will handle them.
 *
 * Returns a new words array with the same length and timestamps as whisperWords
 * but with tokens upgraded from gptWords where alignment succeeds.
 */
function alignWords(gptText, whisperWords) {
  if (!gptText || !whisperWords.length) return whisperWords;

  // Split the gpt-4o text into individual word tokens
  const gptTokens = gptText
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean);

  if (!gptTokens.length) return whisperWords;

  // Build aligned output: same length as whisperWords, same timestamps,
  // but tokens replaced where we can match.
  const aligned = whisperWords.map((w) => ({ ...w }));
  let gptIdx = 0;

  for (let wIdx = 0; wIdx < aligned.length && gptIdx < gptTokens.length; wIdx++) {
    const whisperNorm = norm(aligned[wIdx].token);
    if (!whisperNorm) continue;

    // Look ahead in gpt tokens (window of 3) for a match to this whisper position.
    let matchOffset = -1;
    for (let look = 0; look < 3 && gptIdx + look < gptTokens.length; look++) {
      if (norm(gptTokens[gptIdx + look]) === whisperNorm) {
        matchOffset = look;
        break;
      }
    }

    if (matchOffset >= 0) {
      // Found a match — apply all gpt tokens up to and including the match.
      // For skipped gpt tokens (matchOffset > 0), they don't have a whisper
      // slot, so we can't place them.  Just advance past them.
      aligned[wIdx].token = gptTokens[gptIdx + matchOffset];
      gptIdx += matchOffset + 1;
    } else {
      // No match in the lookahead window.  The whisper token might be an extra
      // word that gpt-4o didn't produce, or a fundamentally different token.
      // Try looking ahead in whisper words for the current gpt token instead.
      let whisperLook = -1;
      for (let look = 1; look <= 2 && wIdx + look < aligned.length; look++) {
        if (norm(aligned[wIdx + look].token) === norm(gptTokens[gptIdx])) {
          whisperLook = look;
          break;
        }
      }

      if (whisperLook < 0) {
        // Tokens diverged — use the gpt token for this position (better text)
        // and advance both pointers.  The timing from whisper is still correct
        // since the audio position corresponds to the same spoken word.
        aligned[wIdx].token = gptTokens[gptIdx];
        gptIdx++;
      }
      // else: whisper has extra tokens before the next match; keep them as-is
      // and let the next iteration pick up the gpt match.
    }
  }

  return aligned;
}

/**
 * Synthesize word-level timestamps for a text string using whisper segments
 * (or uniform distribution across totalDuration as a last resort).
 *
 * This is the rescue path for Hinglish / Hindi audio where whisper-1 frequently
 * returns very sparse word timestamps — only 2-4 words for a 40-second clip —
 * which previously produced just 2 caption lines for the entire video.
 *
 * We take the accurate gpt-4o-transcribe text (all words present) and distribute
 * the words across the video's actual speech timing using whisper's segment
 * boundaries as anchors.  Segments are usually populated correctly even when
 * word timestamps are not.
 */
function synthesizeWordsFromText(text, segments, totalDuration) {
  const tokens = String(text || "")
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean);

  if (!tokens.length) return [];

  const usableSegments = (segments || []).filter(
    (s) => s.endSeconds > s.startSeconds
  );

  if (usableSegments.length && totalDuration > 0) {
    const totalSpan = usableSegments.reduce(
      (sum, s) => sum + (s.endSeconds - s.startSeconds),
      0
    );

    // Reasonable coverage check: if segments span at least 30% of the video,
    // distribute words proportionally across them.
    if (totalSpan > 0 && totalSpan >= totalDuration * 0.3) {
      const result = [];
      let tokenIdx = 0;

      for (let i = 0; i < usableSegments.length; i++) {
        const seg = usableSegments[i];
        const fraction = (seg.endSeconds - seg.startSeconds) / totalSpan;
        const segTokenCount =
          i === usableSegments.length - 1
            ? tokens.length - tokenIdx
            : Math.max(1, Math.round(tokens.length * fraction));

        const segTokens = tokens.slice(tokenIdx, tokenIdx + segTokenCount);
        if (!segTokens.length) continue;

        const perToken = (seg.endSeconds - seg.startSeconds) / segTokens.length;
        segTokens.forEach((tok, j) => {
          result.push({
            id: `syn-${tokenIdx + j}`,
            token: tok,
            startSeconds: seg.startSeconds + j * perToken,
            endSeconds: seg.startSeconds + (j + 1) * perToken
          });
        });
        tokenIdx += segTokens.length;
        if (tokenIdx >= tokens.length) break;
      }

      if (result.length) return result;
    }
  }

  // Fallback: spread tokens uniformly across the full video duration.
  const duration = totalDuration > 0 ? totalDuration : tokens.length * 0.4;
  const perToken = duration / tokens.length;
  return tokens.map((tok, i) => ({
    id: `syn-${i}`,
    token: tok,
    startSeconds: i * perToken,
    endSeconds: (i + 1) * perToken
  }));
}

/**
 * Transcribe the audio at audioPath.
 *
 * Strategy:
 *   1. Try the primary model (gpt-4o-transcribe) — returns accurate text but no
 *      word timestamps (verbose_json is not supported by this model family).
 *   2. If the primary call fails, retry with the configured fallback model.
 *   3. Use whisper-1 (verbose_json) to get word-level timestamps.
 *   4. Align: replace whisper's word tokens with the primary model's more accurate
 *      text while preserving whisper's timing.  This gives captions that are both
 *      accurately worded (from gpt-4o-transcribe) and correctly timed (from whisper).
 *   5. If whisper-1 returns sparse words (common for Hindi/Hinglish), synthesize
 *      word timestamps from the gpt-4o-transcribe text using whisper segments.
 */
export async function transcribeAudio(audioPath, captionLanguage = "auto", totalDuration = 0) {
  const client = getClient();
  const primaryModel = appConfig.openAiTranscriptionModel;
  const fallbackModel = appConfig.openAiTranscriptionFallbackModel;

  let bestTextResult = null;

  try {
    const result = await attemptTranscription(client, audioPath, primaryModel, captionLanguage);
    console.log(
      `[transcribe] Model=${primaryModel} words=${result.words.length} lang=${result.language}`
    );

    // whisper-1 returns words natively via verbose_json — use directly.
    if (result.words.length > 0 && isWhisperModel(primaryModel)) {
      return result;
    }

    // gpt-4o-transcribe returned text but no word timestamps.
    // Save the text and fall through to whisper-1 for timing.
    bestTextResult = result;
    console.log(
      `[transcribe] ${primaryModel} returned text (${result.text.length} chars) — will use whisper-1 for word timestamps`
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
          `[transcribe] ${fallbackModel} returned text (${result.text.length} chars) — will use whisper-1 for word timestamps`
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

  // Use whisper-1 for reliable word-level timestamps (verbose_json).
  //
  // IMPORTANT: Use "auto" language detection — forcing "hi" for Hinglish causes
  // whisper-1 to return sparse word coverage (struggles with Hindi/English mix
  // in strict Hindi mode).
  const whisperResult = await attemptTranscription(client, audioPath, "whisper-1", "auto");
  console.log(
    `[transcribe] whisper-1 timestamp pass: words=${whisperResult.words.length} lang=${whisperResult.language}`
  );

  if (!bestTextResult || !bestTextResult.text) {
    return whisperResult;
  }

  // ── Decide: align vs synthesize ──────────────────────────────────────────
  // Count words produced by the primary model (gpt-4o-transcribe).
  const gptTokenCount = bestTextResult.text
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean).length;

  const whisperWordCount = whisperResult.words.length;

  // Whisper is considered "sparse" when its word count is far smaller than
  // the gpt-4o text word count.  This is the common Hindi/Hinglish case that
  // previously collapsed into just 2 caption lines.  Threshold 0.6 is chosen
  // to trigger synthesis only when the gap is large enough that alignment
  // would drop the majority of the transcript.
  const whisperIsSparse =
    gptTokenCount > 0 && whisperWordCount < gptTokenCount * 0.6;

  let finalWords;
  if (whisperIsSparse) {
    finalWords = synthesizeWordsFromText(
      bestTextResult.text,
      whisperResult.segments,
      totalDuration
    );
    console.log(
      `[transcribe] whisper-1 sparse (${whisperWordCount} vs gpt-4o ${gptTokenCount}) — synthesized ${finalWords.length} word timings from segments`
    );
  } else {
    finalWords = alignWords(bestTextResult.text, whisperResult.words);
    console.log(
      `[transcribe] Aligned ${finalWords.length} words from ${primaryModel} text onto whisper-1 timestamps`
    );
  }

  const finalText = finalWords.map((w) => w.token).join(" ");

  return {
    language: bestTextResult.language || whisperResult.language,
    captionLanguage: bestTextResult.captionLanguage,
    text: finalText,
    fullTranscriptText: bestTextResult.text,
    segments: whisperResult.segments,
    words: finalWords
  };
}
