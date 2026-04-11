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

function buildFallbackQuery(text) {
  const topicalMap = [
    {
      pattern:
        /(court|lawyer|judge|legal|trial|police|complaint|evidence|कानून|कोर्ट|पुलिस|शिकायत|एविडेंस|सबूत|वकील)/iu,
      query: "courtroom legal case police complaint"
    },
    {
      pattern:
        /(money|cash|finance|investment|bank|salary|budget|पैसा|बैंक|फाइनेंस|निवेश|कमाई)/iu,
      query: "money finance business graph"
    },
    {
      pattern:
        /(hospital|doctor|nurse|patient|medical|health|अस्पताल|डॉक्टर|मरीज|दवा|स्वास्थ्य)/iu,
      query: "hospital doctor medical care"
    },
    {
      pattern:
        /(phone|app|software|platform|website|dashboard|फोन|ऐप|सॉफ्टवेयर|वेबसाइट|मोबाइल)/iu,
      query: "software dashboard technology phone"
    },
    {
      pattern:
        /(travel|airport|flight|hotel|vacation|यात्रा|होटल|एयरपोर्ट|फ्लाइट)/iu,
        query: "travel airport destination"
    },
    {
      pattern:
        /(school|student|teacher|classroom|education|स्कूल|छात्र|शिक्षक|पढ़ाई|शिक्षा)/iu,
      query: "classroom education students"
    },
    {
      pattern:
        /(marriage|wedding|relationship|divorce|husband|wife|married|शादी|रिश्ता|पति|पत्नी|तलाक)/iu,
      query: "wedding relationship couple legal dispute"
    }
  ];

  for (const entry of topicalMap) {
    if (entry.pattern.test(text)) {
      return entry.query;
    }
  }

  const keywords = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((word) => word.length > 4)
    .slice(0, 3);

  return keywords.length ? keywords.join(" ") : "business lifestyle scene";
}

function enforceSpacing(candidates, maxSlots) {
  const accepted = [];

  for (const candidate of candidates) {
    const isTooClose = accepted.some(
      (item) => Math.abs(item.startSeconds - candidate.startSeconds) < 4
    );

    if (!isTooClose) {
      accepted.push(candidate);
    }

    if (accepted.length >= maxSlots) {
      break;
    }
  }

  return accepted;
}

function fallbackBrollSelection(timelineSegments) {
  return timelineSegments
    .filter((segment) => {
      const start = segment.editedStartSeconds ?? segment.startSeconds ?? 0;
      const end = segment.editedEndSeconds ?? segment.endSeconds ?? 0;
      return end - start >= 2.6;
    })
    .map((segment, index) => ({
      id: `broll-${index}`,
      sourceSegmentId: segment.id,
      startSeconds:
        (segment.editedStartSeconds ?? segment.startSeconds ?? 0) + 0.2,
      endSeconds: Math.min(
        (segment.editedEndSeconds ?? segment.endSeconds ?? 0) - 0.15,
        (segment.editedStartSeconds ?? segment.startSeconds ?? 0) + 3.2
      ),
      query: buildFallbackQuery(segment.text),
      reason: `Supports the topic in: "${segment.text}"`,
      importance: 0.5
    }));
}

function parseJsonBlock(content) {
  if (!content) {
    return null;
  }

  const normalized = content.trim().replace(/^```json\s*/i, "").replace(/```$/, "");
  return JSON.parse(normalized);
}

export async function selectBrollSegments(timelineSegments) {
  const candidates = timelineSegments
    .filter((segment) => segment.editedEndSeconds - segment.editedStartSeconds >= 2.6)
    .slice(0, 18)
    .map((segment) => ({
      id: segment.id,
      startSeconds: segment.editedStartSeconds,
      endSeconds: segment.editedEndSeconds,
      text: segment.text
    }));

  if (!candidates.length) {
    return [];
  }

  try {
    const client = getClient();
    const completion = await client.chat.completions.create({
      model: appConfig.openAiTextModel,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You choose a few smart B-roll moments for short-form talking-head edits. Select only moments that deserve contextual visuals. Leave most segments without B-roll, but if there is one long informative segment with a concrete topic then still choose at least one useful B-roll moment. Return JSON with a selections array."
        },
        {
          role: "user",
          content: JSON.stringify({
            instructions: {
              maxSelections: appConfig.maxBrollSlots,
              preferImageFriendlyQueries: true,
              keepSpeakerVisibleMostOfTheTime: true,
              durationRangeSeconds: [2.2, 4.2]
            },
            segments: candidates
          })
        }
      ]
    });

    const parsed = parseJsonBlock(completion.choices[0]?.message?.content);
    const selections = Array.isArray(parsed?.selections) ? parsed.selections : [];

    const mappedSelections = selections
      .map((selection, index) => {
        const segment = candidates.find((candidate) => candidate.id === selection.segmentId);
        if (!segment || !selection.query) {
          return null;
        }

        const duration = Math.min(
          Math.max(Number(selection.durationSeconds || 3.2), 2),
          segment.endSeconds - segment.startSeconds - 0.2
        );

        return {
          id: `broll-${index}`,
          sourceSegmentId: segment.id,
          startSeconds: segment.startSeconds + 0.2,
          endSeconds: segment.startSeconds + duration,
          query: String(selection.query).trim(),
          reason: String(selection.reason || "Contextual visual reinforcement."),
          importance: Number(selection.importance || 0.5)
        };
      })
      .filter(Boolean)
      .sort((left, right) => right.importance - left.importance);

    if (!mappedSelections.length) {
      return enforceSpacing(
        fallbackBrollSelection(candidates),
        appConfig.maxBrollSlots
      ).sort((left, right) => left.startSeconds - right.startSeconds);
    }

    return enforceSpacing(mappedSelections, appConfig.maxBrollSlots).sort(
      (left, right) => left.startSeconds - right.startSeconds
    );
  } catch {
    return enforceSpacing(
      fallbackBrollSelection(candidates),
      appConfig.maxBrollSlots
    );
  }
}
