import fs from "node:fs/promises";

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

function formatCaptionLines(tokens) {
  const midpoint = Math.ceil(tokens.length / 2);
  const firstLine = tokens.slice(0, midpoint).join(" ");
  const secondLine = tokens.slice(midpoint).join(" ");

  if (tokens.length <= 3 || firstLine.length < 16) {
    return tokens.join(" ");
  }

  return `${firstLine}\\N${secondLine}`;
}

function isCaptionFiller(token) {
  return ["um", "uh", "erm", "ah", "hmm"].includes(
    String(token).toLowerCase().replace(/[^a-z0-9]/g, "")
  );
}

export function buildCaptionSegments(mappedWords) {
  const displayWords = mappedWords.filter((word) => !isCaptionFiller(word.token));
  const segments = [];
  let current = [];

  for (const word of displayWords) {
    if (!current.length) {
      current.push(word);
      continue;
    }

    const previous = current[current.length - 1];
    const gap = word.editedStartSeconds - previous.editedEndSeconds;
    const currentText = current.map((entry) => entry.token).join(" ");

    if (
      gap > 0.62 ||
      current.length >= 6 ||
      currentText.length >= 28 ||
      previous.token.endsWith(".") ||
      previous.token.endsWith("!") ||
      previous.token.endsWith("?")
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

  return segments.map((words, index) => ({
    id: `caption-${index}`,
    startSeconds: words[0].editedStartSeconds,
    endSeconds: words[words.length - 1].editedEndSeconds + 0.08,
    text: formatCaptionLines(words.map((word) => word.token))
  }));
}

function getCaptionFontFamily(language) {
  if (String(language || "").toLowerCase() === "hindi") {
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
  const assFontSize = aspectRatio === "16:9" ? 52 : 68;
  const assMarginV = aspectRatio === "16:9" ? 90 : 150;
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
    `Style: Default,${fontFamily},${assFontSize},&H00FFFFFF,&H000000FF,&H00111111,&H64000000,-1,0,0,0,100,100,0,0,1,3.2,0,2,64,64,${assMarginV},1`,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    ...captionSegments.map(
      (segment) =>
        `Dialogue: 0,${secondsToAss(segment.startSeconds)},${secondsToAss(segment.endSeconds)},Default,,0,0,0,,${escapeAss(segment.text)}`
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
