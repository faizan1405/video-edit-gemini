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

  // ── Sparse-transcription safety net ────────────────────────────────────────
  // When whisper returns very few words (e.g. only 4 words for a 58-second
  // Hinglish video), the real segments only cover a tiny fraction of the video.
  // This leaves B-roll selection with no candidates for the middle of the video,
  // so B-roll ends up clustered at the very beginning and end.
  //
  // Fix: if real segment coverage < 40 % of sourceDurationSeconds (and the video
  // is longer than 15 s), fill the uncovered gaps with evenly-spaced synthetic
  // segments.  These synthetic segments use the full transcript text so that the
  // GPT B-roll planner still has meaningful context for query generation.
  if (sourceDurationSeconds > 15) {
    const coveredSeconds = segments.reduce(
      (sum, s) => sum + (s.sourceEndSeconds - s.sourceStartSeconds),
      0
    );
    const coverageRatio = coveredSeconds / sourceDurationSeconds;

    if (coverageRatio < 0.40) {
      // Use the full primary-model transcript text for synthetic segment context.
      // transcription.fullTranscriptText is set by the gpt-4o-transcribe merge path
      // and preserved through cleanupTranscript. transcription.text is a fallback
      // but may be just a few words when whisper-1 returned sparse timestamps.
      const fullText = (transcription.fullTranscriptText || transcription.text || mappedWords.map((w) => w.token).join(" ")).slice(0, 300);

      // Target one synthetic slot every ~6 s in the uncovered region
      const targetSlots = Math.max(4, Math.floor(sourceDurationSeconds / 6));
      const spacing = sourceDurationSeconds / (targetSlots + 1);

      for (let i = 1; i <= targetSlots; i++) {
        const mid = spacing * i;
        const slotStart = Math.max(0, mid - 2.5);
        const slotEnd = Math.min(sourceDurationSeconds, mid + 2.5);

        if (slotEnd - slotStart < 2) continue;

        // Skip if this slot overlaps an existing real segment
        const overlaps = segments.some(
          (s) => s.sourceStartSeconds < slotEnd + 0.5 && s.sourceEndSeconds > slotStart - 0.5
        );
        if (overlaps) continue;

        segments.push({
          id: `synthetic-${i}`,
          sourceStartSeconds: slotStart,
          sourceEndSeconds: slotEnd,
          editedStartSeconds: slotStart,
          editedEndSeconds: slotEnd,
          text: fullText
        });
      }

      // Keep chronological order
      segments.sort((a, b) => a.sourceStartSeconds - b.sourceStartSeconds);

      console.log(
        `[timeline] Sparse transcription detected (coverage ${(coverageRatio * 100).toFixed(0)}%). ` +
        `Added ${segments.filter((s) => s.id.startsWith("synthetic")).length} synthetic coverage segments.`
      );
    }
  }

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
