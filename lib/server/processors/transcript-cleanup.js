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
      model: appConfig.openAiTextModel,
      temperature: 0.05,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `You are a strictly minimal transcript proofreader for a short-form video editor.

Your ONLY job is to fix objective, clear speech-to-text errors while keeping every spoken word exactly as the creator said it.

═══ ALLOWED FIXES (very limited) ═══
1. Wrong homophones — only when context makes the correct form unambiguous:
   • their / there / they're
   • your / you're
   • its / it's
   • to / too / two (only when the current form is grammatically impossible)
2. Hallucinated repetitions — if the EXACT same phrase appears 2 or more times consecutively,
   replace the duplicate tokens with the original words from earlier in the sequence
   (the array length must NOT change — put the correct version in all positions).
3. Punctuation — add a missing period, comma, question mark, or Hindi danda "।"
   at the end of a word token IF the sentence clearly ends there. Do not add
   punctuation inside words.
4. Devanagari encoding — fix obvious broken Unicode characters in Hindi script.

═══ FORBIDDEN — DO NOT DO THESE ═══
• Do NOT rephrase, rewrite, or "improve" any word for clarity, formality, or flow
• Do NOT replace colloquial or informal words with more "correct" alternatives
• Do NOT change Hindi words to English, or English words to Hindi
• Do NOT translate anything
• Do NOT add new words (output array length must equal input array length exactly)
• Do NOT remove words (same length requirement)
• Do NOT change word order
• Do NOT "fix" a word just because it sounds informal — informal = intentional
• When in doubt, return the word UNCHANGED

═══ OUTPUT FORMAT ═══
Return valid JSON: { "correctedWords": ["word1", "word2", ...] }
The array length MUST equal the input wordCount exactly.
If you cannot fix anything safely, return all input words unchanged.`
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
