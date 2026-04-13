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

/**
 * Minimal, conservative cleanup of a transcription returned by gpt-4o-transcribe.
 *
 * PURPOSE — fix objective speech-to-text errors ONLY:
 *   • Wrong homophones where context makes the correction unambiguous (their/there)
 *   • Exact duplicate phrases repeated 2+ times in a row (Whisper hallucination)
 *   • Missing or wrong punctuation (period, comma, question mark, danda "।")
 *   • Obvious Devanagari encoding glitches in Hindi/Hinglish segments
 *
 * HARD LIMITS — the model is explicitly prohibited from:
 *   • Rephrasing, rewriting, or "improving" any word
 *   • Replacing informal/colloquial words with formal equivalents
 *   • Changing Hindi/Hinglish words to English or vice versa
 *   • Adding or removing words (output array length must equal input length exactly)
 *   • Translating any part of the transcript
 *
 * The word-level timestamps from transcription are NEVER touched — only the
 * text token of each word may change.
 */
export async function cleanupTranscript(transcription) {
  const words = transcription.words;
  if (!words || words.length === 0) return transcription;

  const rawText = transcription.text;
  if (!rawText || rawText.length < 20) return transcription;

  const language = transcription.language || "en";
  const client = getClient();

  try {
    const completion = await client.chat.completions.create({
      model: appConfig.openAiCleanupModel,
      temperature: 0.0,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `You are cleaning a transcript for captions. Keep original wording exactly the same. Do not paraphrase or translate. Do not convert Hindi or Hinglish words to English. Do not convert English words to Hindi.

ONLY fix these specific issues:
1. Punctuation — add a missing period, comma, question mark, or Hindi danda "।" at the end of a word token when a sentence clearly ends there. Do not add punctuation inside words.
2. Capitalisation — capitalise the first word of a sentence only.
3. Obvious Devanagari encoding glitches — fix broken Unicode in Hindi script.
4. Very obvious speech-to-text mistake — only when you are 100% certain (e.g. "their" vs "there" where context is unambiguous).

STRICT RULES:
• Do NOT rephrase, rewrite, summarise, or "improve" any word
• Do NOT replace informal words with formal alternatives
• Do NOT change Hindi/Hinglish words to English or vice versa
• Do NOT translate anything
• Do NOT add new words
• Do NOT remove words — output array length MUST equal input wordCount exactly
• Do NOT change word order
• When in doubt, return the word UNCHANGED

OUTPUT: { "correctedWords": ["word1", "word2", ...] }
Array length MUST equal wordCount exactly. Return all words unchanged if nothing is safe to fix.`
        },
        {
          role: "user",
          content: JSON.stringify({
            language,
            wordCount: words.length,
            fullText: rawText.slice(0, 4000),
            words: words.map((w) => w.token)
          })
        }
      ]
    });

    const raw = completion.choices[0]?.message?.content?.trim()
      .replace(/^```json\s*/i, "")
      .replace(/```$/, "") || "{}";

    const parsed = JSON.parse(raw);
    const corrected = parsed.correctedWords;

    // Safety: only apply if the array length matches exactly.
    // Any mismatch means the model violated the constraint — skip cleanup entirely.
    if (!Array.isArray(corrected) || corrected.length !== words.length) {
      console.warn(
        `[transcript-cleanup] Length mismatch: got ${corrected?.length}, expected ${words.length}. Skipping cleanup.`
      );
      return transcription;
    }

    // Apply corrections to word tokens while preserving all timestamps.
    const cleanedWords = words.map((word, i) => ({
      ...word,
      token: String(corrected[i]).trim() || word.token
    }));

    const cleanedText = cleanedWords.map((w) => w.token).join(" ");
    const cleanedSegments = rebuildSegments(transcription.segments, cleanedWords);

    console.log(`[transcript-cleanup] Applied minimal corrections to ${words.length} words`);

    return {
      ...transcription,
      text: cleanedText,
      // Preserve the full primary-model transcript text (set by the gpt-4o-transcribe
      // merge step in transcribeAudio). The cleanup step only corrects whisper-1 word
      // tokens, so `text` becomes the concatenation of those tokens (potentially very
      // few words). fullTranscriptText keeps the full original for use by buildTimeline
      // when generating synthetic coverage segment context.
      fullTranscriptText: transcription.fullTranscriptText || transcription.text,
      words: cleanedWords,
      segments: cleanedSegments
    };
  } catch (err) {
    console.warn(
      `[transcript-cleanup] Cleanup failed — using raw transcript:`,
      err?.message || err
    );
    return transcription;
  }
}

/**
 * Rebuild segment text from corrected words by matching word timestamps
 * to segment time ranges.
 */
function rebuildSegments(segments, correctedWords) {
  if (!segments || !segments.length) return segments;

  return segments.map((seg) => {
    const segWords = correctedWords.filter(
      (w) =>
        w.startSeconds >= seg.startSeconds - 0.05 &&
        w.endSeconds <= seg.endSeconds + 0.05
    );

    if (!segWords.length) return seg;

    return {
      ...seg,
      text: segWords.map((w) => w.token).join(" ")
    };
  });
}
