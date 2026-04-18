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
 * Append a single contextually relevant emoji to each caption segment's text.
 * Runs one gpt-4o-mini call for the whole list so cost stays bounded.
 *
 * Text stays otherwise identical — only a trailing " <emoji>" is added.  If the
 * model output is malformed in any way, the original segments are returned
 * unchanged so captions still ship.
 */
export async function addEmojisToCaptions(segments, language = "en") {
  if (!segments || !segments.length) return segments;

  const client = getClient();

  try {
    const completion = await client.chat.completions.create({
      model: appConfig.openAiCleanupModel,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `You add ONE short relevant emoji to each short caption line for a social-media video.

RULES:
- Choose exactly ONE emoji per line that best matches the meaning or emotion.
- Do NOT change, translate, or rewrite the caption text in any way.
- Do NOT add more than one emoji per line.
- Skip emojis (use empty string "") only for generic filler lines where no emoji fits.
- The text may be Hindi (Devanagari), Hinglish, or English — the emoji choice should match the meaning regardless of script.

OUTPUT JSON: { "emojis": ["🔥", "💡", "", "😂", ...] }
Array length MUST equal the input line count exactly.`
        },
        {
          role: "user",
          content: JSON.stringify({
            language,
            count: segments.length,
            lines: segments.map((s) =>
              String(s.text || "").replace(/\\N/g, " ").slice(0, 120)
            )
          })
        }
      ]
    });

    const raw =
      completion.choices[0]?.message?.content
        ?.trim()
        .replace(/^```json\s*/i, "")
        .replace(/```$/, "") || "{}";

    const parsed = JSON.parse(raw);
    const emojis = parsed.emojis;

    if (!Array.isArray(emojis) || emojis.length !== segments.length) {
      console.warn(
        `[caption-emoji] Length mismatch (got ${emojis?.length}, expected ${segments.length}) — skipping emoji enrichment`
      );
      return segments;
    }

    return segments.map((seg, i) => {
      const emoji = String(emojis[i] || "").trim();
      if (!emoji) return seg;
      // Append on the last line (after the final \N break, or at the end if
      // the caption is a single line).  This keeps line balance intact.
      const text = seg.text;
      const lastBreak = text.lastIndexOf("\\N");
      const before = lastBreak >= 0 ? text.slice(0, lastBreak + 2) : "";
      const tail = lastBreak >= 0 ? text.slice(lastBreak + 2) : text;
      return { ...seg, text: `${before}${tail} ${emoji}` };
    });
  } catch (err) {
    console.warn(
      `[caption-emoji] Failed — keeping captions without emojis:`,
      err?.message || err
    );
    return segments;
  }
}
