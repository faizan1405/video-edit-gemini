const fillerWords = new Set([
  "um",
  "uh",
  "erm",
  "ah",
  "hmm",
  "mm"
]);

function cleanToken(token) {
  return String(token || "")
    .replace(/["""']/g, "")
    .trim();
}

function normalizeLookup(token) {
  return cleanToken(token).toLowerCase().replace(/[^a-z0-9]/g, "");
}

function isFillerWord(token) {
  return fillerWords.has(normalizeLookup(token));
}

function joinTokens(words) {
  return words
    .map((word) => word.token)
    .join(" ")
    .replace(/\s+([,.!?;:])/g, "$1")
    .trim();
}

function buildRuns(words) {
  // Group words into speech runs separated by longer pauses or sentence breaks.
  // These runs are used purely for B-roll selection and UI display — NOT for cutting.
  const runs = [];
  let currentRun = [];

  for (const word of words) {
    if (!currentRun.length) {
      currentRun.push(word);
      continue;
    }

    const previousWord = currentRun[currentRun.length - 1];
    const gap = word.startSeconds - previousWord.endSeconds;
    const sentenceBreak = /[.!?।]$/.test(previousWord.token);

    // Break runs on long pauses (>1.5s) or sentence-ending punctuation
    if (gap > 1.5 || sentenceBreak || currentRun.length >= 20) {
      runs.push(currentRun);
      currentRun = [word];
      continue;
    }

    currentRun.push(word);
  }

  if (currentRun.length) {
    runs.push(currentRun);
  }

  return runs;
}

// silenceEvents is kept in the signature for API compatibility but is no longer used
// for cutting — the full video is always preserved.
export function buildTimeline({ transcription, silenceEvents, sourceDurationSeconds }) {
  // Build word list from transcription
  const transcriptionWords =
    transcription.words?.length > 0
      ? transcription.words
      : transcription.segments.flatMap((segment, segmentIndex) => {
          const tokens = String(segment.text || "")
            .split(/\s+/)
            .filter(Boolean);
          const duration = Math.max(
            0.2,
            segment.endSeconds - segment.startSeconds
          );
          const perWordDuration = duration / Math.max(tokens.length, 1);

          return tokens.map((token, tokenIndex) => ({
            id: `fallback-${segmentIndex}-${tokenIndex}`,
            token,
            startSeconds: segment.startSeconds + tokenIndex * perWordDuration,
            endSeconds:
              segment.startSeconds + (tokenIndex + 1) * perWordDuration
          }));
        });

  const words = transcriptionWords
    .map((word, index) => ({
      id: word.id || `word-${index}`,
      token: cleanToken(word.token || word.word),
      // Use ?? instead of || so that legitimate 0-second timestamps are preserved
      // (0 is falsy with ||, which would skip valid start=0 values).
      startSeconds: Number(word.startSeconds ?? word.start ?? 0),
      endSeconds: Number(word.endSeconds ?? word.end ?? 0)
    }))
    .filter((word) => word.token && word.endSeconds > word.startSeconds);

  // Build speech runs for B-roll segment selection and UI display
  const rawRuns = buildRuns(words);
  const filteredRuns = rawRuns.filter((run) => run.length > 0);

  // Build display segments — these use ORIGINAL source timestamps (no remapping).
  // They are shown in the UI and used for B-roll timing. The actual video is NOT cut.
  const segments = [];

  for (const run of filteredRuns) {
    const sourceStartSeconds = Math.max(0, run[0].startSeconds - 0.08);
    const sourceEndSeconds = Math.min(
      sourceDurationSeconds,
      run[run.length - 1].endSeconds + 0.14
    );
    const text = joinTokens(run.filter((w) => !isFillerWord(w.token)));

    if (!text) {
      continue;
    }

    segments.push({
      id: `seg-${segments.length}`,
      sourceStartSeconds,
      sourceEndSeconds,
      // Identity mapping: edited times equal source times.
      // The video is NOT cut — these are just speech region labels.
      editedStartSeconds: sourceStartSeconds,
      editedEndSeconds: sourceEndSeconds,
      words: [...run],
      text
    });
  }

  // Build mappedWords with ORIGINAL timestamps so captions align with the full video.
  // All words are included here; the caption builder applies its own filler filtering.
  const mappedWords = words.map((word) => ({
    ...word,
    // Identity mapping: captions use source/original timestamps directly
    editedStartSeconds: word.startSeconds,
    editedEndSeconds: word.endSeconds
  }));

  // Clean up internal words array from segments (not needed downstream)
  segments.forEach((segment) => {
    delete segment.words;
  });

  // Full video duration is always preserved — no silence removal
  const finalDurationSeconds = sourceDurationSeconds;
  const removedDurationSeconds = 0;

  return {
    segments,
    mappedWords,
    sourceDurationSeconds,
    finalDurationSeconds,
    removedDurationSeconds
  };
}
