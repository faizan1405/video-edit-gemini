import fs from "node:fs/promises";
import { appConfig } from "../../config.js";

function secondsToAss(seconds) {
  const totalCentiseconds = Math.round(seconds * 100);
  const hours = Math.floor(totalCentiseconds / 360000);
  const minutes = Math.floor((totalCentiseconds % 360000) / 6000);
  const secs = Math.floor((totalCentiseconds % 6000) / 100);
  const centiseconds = totalCentiseconds % 100;

  return `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(
    2,
    "0"
  )}.${String(centiseconds).padStart(2, "0")}`;
}

function secondsToSrt(seconds) {
  const totalMilliseconds = Math.round(seconds * 1000);
  const hours = Math.floor(totalMilliseconds / 3600000);
  const minutes = Math.floor((totalMilliseconds % 3600000) / 60000);
  const secs = Math.floor((totalMilliseconds % 60000) / 1000);
  const milliseconds = totalMilliseconds % 1000;

  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(
    2,
    "0"
  )}:${String(secs).padStart(2, "0")},${String(milliseconds).padStart(3, "0")}`;
}

function escapeAss(text) {
  return text.replace(/{/g, "\\{").replace(/}/g, "\\}");
}

// Unicode ranges that cover the vast majority of emoji / pictographs.
// libass falls back to a generic font for glyphs the style font is missing,
// but the fallback is inconsistent across platforms (especially Windows).
// Wrapping emoji runs in an explicit font override tag forces libass to use
// an emoji-capable font (Segoe UI Emoji on Windows, Noto Color Emoji on Linux)
// and then restores the caption font for the surrounding text.
const EMOJI_REGEX =
  /(?:\p{Extended_Pictographic}(?:\u200d\p{Extended_Pictographic})*\uFE0F?|[\u{1F1E6}-\u{1F1FF}]{2})/gu;

function wrapEmojis(text, bodyFont, emojiFont = "Segoe UI Emoji") {
  if (!EMOJI_REGEX.test(text)) return text;
  EMOJI_REGEX.lastIndex = 0;
  return text.replace(EMOJI_REGEX, (match) => {
    return `{\\fn${emojiFont}}${match}{\\fn${bodyFont}}`;
  });
}

/**
 * Format caption tokens into 1 or 2 lines for readability.
 * Prefers breaking at natural pause points (commas, conjunctions)
 * rather than a raw midpoint split.
 */
function formatCaptionLines(tokens) {
  if (tokens.length <= 3) {
    return tokens.join(" ");
  }

  const fullText = tokens.join(" ");
  if (fullText.length < 18) {
    return fullText;
  }

  const midpoint = Math.ceil(tokens.length / 2);
  const BREAK_WORDS = new Set([
    "and", "or", "but", "so", "then", "that", "which", "when", "if", "for",
    "aur", "ya", "par", "toh", "ki", "jab",
    "और", "या", "पर", "तो", "कि", "जब"
  ]);

  let bestBreak = midpoint;
  for (let offset = 0; offset <= 2; offset++) {
    for (const pos of [midpoint + offset, midpoint - offset]) {
      if (pos > 0 && pos < tokens.length) {
        const prevToken = tokens[pos - 1].toLowerCase();
        if (BREAK_WORDS.has(tokens[pos].toLowerCase()) || prevToken.endsWith(",")) {
          bestBreak = pos;
          break;
        }
      }
    }
    if (bestBreak !== midpoint) break;
  }

  const firstLine = tokens.slice(0, bestBreak).join(" ");
  const secondLine = tokens.slice(bestBreak).join(" ");

  if (!secondLine) return firstLine;
  return `${firstLine}\\N${secondLine}`;
}

// Only remove true non-linguistic fillers that carry zero meaning.
const FILLER_WORDS = new Set([
  "um", "uh", "erm", "hmm", "uhh", "umm", "mm"
]);

function isCaptionFiller(token) {
  const normalized = String(token).toLowerCase().replace(/[^a-z0-9]/g, "");
  return FILLER_WORDS.has(normalized);
}

// ── Timing constants driven by appConfig ──────────────────────────────────────
// Read at call time (not module load) so tests can override appConfig in isolation.

function getMinDuration() {
  return (appConfig.minCaptionDurationMs || 1200) / 1000;
}

function getMaxDuration() {
  return (appConfig.maxCaptionDurationMs || 4000) / 1000;
}

function getMaxWords() {
  return appConfig.maxWordsPerCaption || 6;
}

// Small buffer added after the last word so the caption doesn't disappear the
// instant the speaker finishes the word.
const CAPTION_END_PADDING = 0.15;

/**
 * Validate and repair a list of caption segments.
 *
 * Fixes in order:
 *   1. Negative or zero duration → extend end to start + minDuration
 *   2. Overlap with the previous segment → push start forward
 *   3. Segments that shrank to < 0.2 s after overlap repair → drop them
 *   4. Bridge tiny gaps (< 0.25 s) between consecutive captions to eliminate flicker
 */
function validateAndRepairSegments(segments) {
  const MIN = getMinDuration();
  const repaired = [];

  for (let i = 0; i < segments.length; i++) {
    const seg = { ...segments[i] };

    // Fix zero/negative duration
    if (seg.endSeconds <= seg.startSeconds) {
      seg.endSeconds = seg.startSeconds + MIN;
    }

    // Fix overlap with previous segment
    if (repaired.length > 0) {
      const prev = repaired[repaired.length - 1];
      if (seg.startSeconds < prev.endSeconds) {
        // Push start to where prev ends; preserve end if possible
        const shift = prev.endSeconds - seg.startSeconds;
        seg.startSeconds = prev.endSeconds;
        seg.endSeconds = Math.max(seg.endSeconds, seg.startSeconds + 0.2);
        // If the shift consumed the segment entirely, skip it
        if (seg.endSeconds - seg.startSeconds < 0.2) continue;
        // Re-apply minimum duration after the shift
        if (seg.endSeconds - seg.startSeconds < MIN) {
          seg.endSeconds = seg.startSeconds + MIN;
        }
        // Suppress unused variable warning
        void shift;
      }
    }

    repaired.push(seg);
  }

  // Bridge small gaps: if the next caption starts within 0.25 s of the
  // previous ending, extend the previous caption to eliminate the flicker gap.
  for (let i = 0; i < repaired.length - 1; i++) {
    const gapToNext = repaired[i + 1].startSeconds - repaired[i].endSeconds;
    if (gapToNext > 0 && gapToNext < 0.25) {
      repaired[i].endSeconds = repaired[i + 1].startSeconds;
    }
  }

  return repaired;
}

export function buildCaptionSegments(mappedWords, language = "en") {
  const MIN_DURATION = getMinDuration();
  const MAX_DURATION = getMaxDuration();
  const MAX_WORDS = getMaxWords();

  const displayWords = mappedWords.filter((word) => !isCaptionFiller(word.token));
  const segments = [];
  let current = [];

  const isHindi = language === "hi" || language === "hindi" || language === "hinglish";

  // Tighter word/char limits for mobile readability.
  // Hindi/Hinglish words are longer — cap at 4 to stay within 3-5 word target.
  // English is capped at MAX_WORDS (env: MAX_WORDS_PER_CAPTION, default 5).
  const maxWordsPerSegment = isHindi ? Math.min(MAX_WORDS, 4) : MAX_WORDS;
  const maxCharsPerSegment = isHindi ? 22 : 28;

  // Punctuation that signals a natural sentence/clause break.
  const CLAUSE_BREAKS = /[.!?।,;:—–]$/;

  for (const word of displayWords) {
    if (!current.length) {
      current.push(word);
      continue;
    }

    const previous = current[current.length - 1];
    const gap = word.editedStartSeconds - previous.editedEndSeconds;
    const currentText = current.map((e) => e.token).join(" ");

    // Larger gap threshold for Hindi (natural inter-word spacing is wider).
    const gapThreshold = isHindi ? 0.75 : 0.55;

    // Time-based break: if this group already spans near the max duration, cut.
    const groupDuration = previous.editedEndSeconds - current[0].editedStartSeconds;

    if (
      gap > gapThreshold ||
      current.length >= maxWordsPerSegment ||
      currentText.length >= maxCharsPerSegment ||
      groupDuration > MAX_DURATION - 0.4 ||
      CLAUSE_BREAKS.test(previous.token)
    ) {
      segments.push(current);
      current = [word];
      continue;
    }

    current.push(word);
  }

  if (current.length) {
    segments.push(current);
  }

  const rawSegments = segments.map((words, index) => {
    const start = words[0].editedStartSeconds;
    const rawEnd = words[words.length - 1].editedEndSeconds + CAPTION_END_PADDING;

    // Enforce [MIN_DURATION, MAX_DURATION] window.
    const end = Math.min(
      Math.max(rawEnd, start + MIN_DURATION),
      start + MAX_DURATION
    );

    return {
      id: `caption-${index}`,
      startSeconds: start,
      endSeconds: end,
      text: formatCaptionLines(words.map((word) => word.token))
    };
  });

  // Validate and repair all timing issues before returning.
  return validateAndRepairSegments(rawSegments);
}

function getCaptionFontFamily(language) {
  const lang = String(language || "").toLowerCase();
  if (lang === "hindi" || lang === "hi" || lang === "hinglish") {
    return "Nirmala UI";
  }
  return "Arial";
}

export async function writeCaptionFiles(
  captionSegments,
  assPath,
  srtPath,
  aspectRatio,
  language
) {
  const playResX = aspectRatio === "16:9" ? 1920 : 1080;
  const playResY = aspectRatio === "16:9" ? 1080 : 1920;
  const assFontSize = aspectRatio === "16:9" ? 54 : 72;
  const assMarginV = aspectRatio === "16:9" ? 95 : 160;
  const fontFamily = getCaptionFontFamily(language);

  const assBody = [
    "[Script Info]",
    "ScriptType: v4.00+",
    "Collisions: Normal",
    `PlayResX: ${playResX}`,
    `PlayResY: ${playResY}`,
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    `Style: Default,${fontFamily},${assFontSize},&H00FFFFFF,&H000000FF,&H00000000,&H80000000,-1,0,0,0,100,100,0.5,0,1,3.5,1.2,2,60,60,${assMarginV},1`,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    ...captionSegments.map(
      (segment) =>
        `Dialogue: 0,${secondsToAss(segment.startSeconds)},${secondsToAss(segment.endSeconds)},Default,,0,0,0,,${wrapEmojis(escapeAss(segment.text), fontFamily)}`
    )
  ].join("\n");

  const srtBody = captionSegments
    .map(
      (segment, index) =>
        `${index + 1}\n${secondsToSrt(segment.startSeconds)} --> ${secondsToSrt(segment.endSeconds)}\n${segment.text.replace(/\\N/g, "\n")}\n`
    )
    .join("\n");

  await fs.writeFile(assPath, assBody, "utf8");
  await fs.writeFile(srtPath, srtBody, "utf8");
}
