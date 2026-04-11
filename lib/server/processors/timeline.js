const fillerWords = new Set([
  "um",
  "uh",
  "erm",
  "ah",
  "like",
  "hmm",
  "mm",
  "actually",
  "basically",
  "literally"
]);

function cleanToken(token) {
  return String(token || "")
    .replace(/[“”"']/g, "")
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

function trimEdgeFillers(words) {
  let startIndex = 0;
  let endIndex = words.length - 1;

  while (startIndex < words.length && isFillerWord(words[startIndex].token)) {
    startIndex += 1;
  }

  while (endIndex >= startIndex && isFillerWord(words[endIndex].token)) {
    endIndex -= 1;
  }

  return words.slice(startIndex, endIndex + 1);
}

function isMostlyFiller(words) {
  const meaningfulCount = words.filter((word) => !isFillerWord(word.token)).length;
  return meaningfulCount <= 1;
}

function hasLongSilenceBetween(startSeconds, endSeconds, silenceEvents) {
  return silenceEvents.some(
    (event) =>
      event.durationSeconds >= 0.45 &&
      event.startSeconds >= startSeconds - 0.08 &&
      event.endSeconds <= endSeconds + 0.08
  );
}

function buildRuns(words, silenceEvents) {
  const runs = [];
  let currentRun = [];

  for (const word of words) {
    if (!currentRun.length) {
      currentRun.push(word);
      continue;
    }

    const previousWord = currentRun[currentRun.length - 1];
    const gap = word.startSeconds - previousWord.endSeconds;
    const sentenceBreak = /[.!?]$/.test(previousWord.token);
    const silenceBreak = hasLongSilenceBetween(
      previousWord.endSeconds,
      word.startSeconds,
      silenceEvents
    );

    if (gap > 0.78 || sentenceBreak || silenceBreak || currentRun.length >= 16) {
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

export function buildTimeline({ transcription, silenceEvents, sourceDurationSeconds }) {
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
      startSeconds: Number(word.startSeconds || word.start || 0),
      endSeconds: Number(word.endSeconds || word.end || 0)
    }))
    .filter((word) => word.token && word.endSeconds > word.startSeconds);

  const rawRuns = buildRuns(words, silenceEvents);
  const filteredRuns = rawRuns
    .map(trimEdgeFillers)
    .filter((run) => run.length > 0)
    .filter(
      (run) =>
        !(
          isMostlyFiller(run) &&
          run[run.length - 1].endSeconds - run[0].startSeconds < 1.3
        )
    );

  const segments = [];

  for (const run of filteredRuns) {
    const sourceStartSeconds = Math.max(0, run[0].startSeconds - 0.08);
    const sourceEndSeconds = run[run.length - 1].endSeconds + 0.14;
    const text = joinTokens(run);

    if (!text) {
      continue;
    }

    const previousSegment = segments[segments.length - 1];
    if (
      previousSegment &&
      sourceStartSeconds - previousSegment.sourceEndSeconds <= 0.22
    ) {
      previousSegment.sourceEndSeconds = sourceEndSeconds;
      previousSegment.words.push(...run);
      previousSegment.text = joinTokens(previousSegment.words);
      continue;
    }

    segments.push({
      id: `cut-${segments.length}`,
      sourceStartSeconds,
      sourceEndSeconds,
      editedStartSeconds: 0,
      editedEndSeconds: 0,
      words: [...run],
      text
    });
  }

  for (let index = 1; index < segments.length; index += 1) {
    const previousSegment = segments[index - 1];
    const currentSegment = segments[index];
    const currentDuration =
      currentSegment.sourceEndSeconds - currentSegment.sourceStartSeconds;

    if (currentDuration < 0.45) {
      previousSegment.sourceEndSeconds = currentSegment.sourceEndSeconds;
      previousSegment.words.push(...currentSegment.words);
      previousSegment.text = joinTokens(previousSegment.words);
      segments.splice(index, 1);
      index -= 1;
    }
  }

  let cursorSeconds = 0;
  const mappedWords = [];

  segments.forEach((segment) => {
    const segmentDuration =
      segment.sourceEndSeconds - segment.sourceStartSeconds;

    segment.editedStartSeconds = cursorSeconds;
    segment.editedEndSeconds = cursorSeconds + segmentDuration;

    for (const word of segment.words) {
      mappedWords.push({
        ...word,
        editedStartSeconds:
          segment.editedStartSeconds +
          (word.startSeconds - segment.sourceStartSeconds),
        editedEndSeconds:
          segment.editedStartSeconds +
          (word.endSeconds - segment.sourceStartSeconds)
      });
    }

    cursorSeconds = segment.editedEndSeconds;
    delete segment.words;
  });

  const finalDurationSeconds = cursorSeconds;
  const removedDurationSeconds = Math.max(
    0,
    sourceDurationSeconds - finalDurationSeconds
  );

  return {
    segments,
    mappedWords,
    sourceDurationSeconds,
    finalDurationSeconds,
    removedDurationSeconds
  };
}
