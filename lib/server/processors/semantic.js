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

// Each entry maps a regex pattern to topic-specific Pexels search queries.
// indiaQueries are tried first (preferred for Indian-context content).
// queries are the generic fallback when Pexels returns 0 results for the India-specific term.
const TOPICAL_MAP = [
  {
    pattern:
      /(court|lawyer|judge|legal|trial|police|complaint|evidence|verdict|law|justice|FIR|bail|custody|कानून|कोर्ट|पुलिस|शिकायत|एविडेंस|सबूत|वकील|न्याय|अदालत|ज़मानत)/iu,
    indiaQueries: [
      "indian courtroom legal hearing",
      "india high court judge bench",
      "indian lawyer legal document",
      "india police station complaint",
      "india supreme court building"
    ],
    queries: [
      "courtroom legal hearing",
      "judge bench gavel",
      "lawyer legal document signing",
      "police station complaint filing"
    ]
  },
  {
    pattern:
      /(money|cash|finance|investment|bank|salary|budget|loan|debt|income|profit|loss|rupee|EMI|SIP|mutual fund|stock|share market|पैसा|बैंक|फाइनेंस|निवेश|कमाई|कर्ज|लोन|मुनाफा|रुपया|शेयर बाजार)/iu,
    indiaQueries: [
      "india bank finance rupee notes",
      "indian stock market trading screen",
      "india startup investment growth chart",
      "indian cash payment transaction",
      "indian businessman financial planning"
    ],
    queries: [
      "money finance investment growth",
      "bank transaction cash payment",
      "stock market trading chart",
      "financial planning budget"
    ]
  },
  {
    pattern:
      /(hospital|doctor|nurse|patient|medical|health|medicine|treatment|surgery|clinic|pharma|ambulance|ICU|अस्पताल|डॉक्टर|मरीज|दवा|स्वास्थ्य|इलाज|नर्स|क्लिनिक)/iu,
    indiaQueries: [
      "indian hospital doctor consultation",
      "india healthcare clinic patient",
      "indian medical treatment ward",
      "india pharmacy medicine counter",
      "indian doctor stethoscope examination"
    ],
    queries: [
      "hospital doctor patient consultation",
      "medical treatment healthcare",
      "clinic pharmacy medicine",
      "ambulance emergency medical"
    ]
  },
  {
    pattern:
      /(phone|app|software|platform|website|dashboard|computer|laptop|technology|internet|digital|AI|startup|coding|developer|programmer|फोन|ऐप|सॉफ्टवेयर|वेबसाइट|मोबाइल|इंटरनेट|कंप्यूटर|स्टार्टअप)/iu,
    indiaQueries: [
      "indian software developer laptop coding",
      "india tech startup office team",
      "south asian programmer computer screen",
      "india smartphone app developer",
      "indian IT office technology workspace"
    ],
    queries: [
      "software developer coding laptop",
      "tech startup office team",
      "smartphone app development",
      "digital technology internet"
    ]
  },
  {
    pattern:
      /(travel|airport|flight|hotel|vacation|trip|destination|tourism|train|यात्रा|होटल|एयरपोर्ट|फ्लाइट|सफर|छुट्टी|ट्रेन|पर्यटन)/iu,
    indiaQueries: [
      "india travel heritage monument tourism",
      "indian airport terminal departure",
      "india train railway journey",
      "indian hill station vacation travel",
      "india tourist landmark scenic"
    ],
    queries: [
      "travel airport departure terminal",
      "hotel vacation resort destination",
      "train journey travel scenic",
      "tourism landmark sightseeing"
    ]
  },
  {
    pattern:
      /(school|student|teacher|classroom|education|college|university|exam|degree|study|coaching|स्कूल|छात्र|शिक्षक|पढ़ाई|शिक्षा|कॉलेज|परीक्षा|यूनिवर्सिटी|कोचिंग)/iu,
    indiaQueries: [
      "indian classroom students education",
      "india college university campus students",
      "indian school children studying",
      "india exam preparation study desk",
      "indian teacher whiteboard lecture"
    ],
    queries: [
      "classroom students education learning",
      "university campus college students",
      "exam preparation study desk",
      "teacher whiteboard lecture"
    ]
  },
  {
    pattern:
      /(marriage|wedding|relationship|divorce|husband|wife|family|couple|engagement|शादी|रिश्ता|पति|पत्नी|तलाक|परिवार|जोड़ा|सगाई|ब्याह)/iu,
    indiaQueries: [
      "indian wedding ceremony celebration",
      "india wedding couple traditional",
      "indian family home together",
      "south asian couple relationship",
      "indian wedding reception guests"
    ],
    queries: [
      "wedding ceremony couple celebration",
      "family home together relationship",
      "couple engagement romantic"
    ]
  },
  {
    pattern:
      /(food|restaurant|cooking|eating|meal|recipe|chef|kitchen|street food|खाना|रेस्टोरेंट|खाना बनाना|भोजन|रेसिपी|शेफ|किचन|स्ट्रीट फूड)/iu,
    indiaQueries: [
      "indian food cuisine street market",
      "india kitchen cooking dal curry",
      "indian restaurant meal thali",
      "india street food vendor",
      "indian chef cooking traditional"
    ],
    queries: [
      "food restaurant meal cooking",
      "kitchen chef food preparation",
      "street food vendor market",
      "delicious dish meal recipe"
    ]
  },
  {
    pattern:
      /(business|startup|company|office|work|employee|boss|meeting|deal|entrepreneur|corporate|व्यापार|कंपनी|ऑफिस|काम|कर्मचारी|बॉस|मीटिंग|उद्यमी)/iu,
    indiaQueries: [
      "indian office business team meeting",
      "india startup company workspace",
      "south asian corporate professionals",
      "indian entrepreneur business deal",
      "india office building corporate"
    ],
    queries: [
      "business office meeting team",
      "startup company growth workspace",
      "corporate professionals deal handshake",
      "entrepreneur business planning"
    ]
  },
  {
    pattern:
      /(politics|government|election|minister|party|vote|parliament|नेता|सरकार|चुनाव|मंत्री|पार्टी|वोट|राजनीति|संसद)/iu,
    indiaQueries: [
      "india parliament government building",
      "indian election democracy voting",
      "india political rally crowd",
      "india government minister press conference",
      "india democratic election booth"
    ],
    queries: [
      "government parliament building",
      "election democracy voting booth",
      "political rally crowd speech",
      "minister press conference podium"
    ]
  },
  {
    pattern:
      /(sport|cricket|football|game|match|player|team|stadium|IPL|खेल|क्रिकेट|फुटबॉल|खिलाड़ी|टीम|मैच|स्टेडियम)/iu,
    indiaQueries: [
      "india cricket stadium IPL crowd",
      "indian cricket player batting",
      "india sports match stadium audience",
      "indian football player game",
      "india sports team celebration"
    ],
    queries: [
      "cricket stadium match crowd",
      "football game player action",
      "sports team match competition",
      "athlete player training"
    ]
  },
  {
    pattern:
      /(house|home|property|rent|flat|apartment|real estate|construction|घर|मकान|किराया|फ्लैट|प्रॉपर्टी|निर्माण)/iu,
    indiaQueries: [
      "indian home interior living room",
      "india apartment building mumbai",
      "indian real estate property construction",
      "india home modern interior design",
      "indian flat residential building"
    ],
    queries: [
      "house home interior living room",
      "apartment building real estate",
      "property construction housing",
      "modern home interior design"
    ]
  },
  {
    pattern:
      /(social media|YouTube|Instagram|influencer|content creator|viral|subscribers|followers|सोशल मीडिया|यूट्यूब|इंस्टाग्राम|इन्फ्लुएंसर)/iu,
    indiaQueries: [
      "indian content creator youtube filming",
      "india social media influencer phone",
      "indian youtuber recording studio",
      "south asian creator smartphone video"
    ],
    queries: [
      "content creator filming youtube",
      "social media influencer phone",
      "video creator studio recording"
    ]
  },
  {
    pattern:
      /(scam|fraud|cheat|fake|mislead|trap|trick|scammer|ठगी|धोखा|फ्रॉड|नकली|जाल|चीटिंग)/iu,
    indiaQueries: [
      "india online fraud scam warning",
      "india cyber crime computer fraud",
      "india financial scam police investigation"
    ],
    queries: [
      "online fraud scam warning",
      "cyber crime computer security",
      "financial fraud investigation"
    ]
  },
  {
    pattern:
      /(mental health|stress|anxiety|depression|therapy|counseling|wellness|mindfulness|मानसिक स्वास्थ्य|तनाव|चिंता|अवसाद|थेरेपी|कल्याण)/iu,
    indiaQueries: [
      "indian person stress mental health",
      "india meditation wellness mindfulness",
      "south asian therapy counseling session"
    ],
    queries: [
      "person stress mental health anxiety",
      "meditation wellness mindfulness calm",
      "therapy counseling session support"
    ]
  }
];

const MIN_SEGMENT_DURATION_SECONDS = 2.2;

// Build the primary Pexels search query for a segment.
// Cycles through India-specific queries first (index selects variety).
function buildFallbackQuery(text, index = 0) {
  for (const entry of TOPICAL_MAP) {
    if (entry.pattern.test(text)) {
      const all = [...(entry.indiaQueries || []), ...entry.queries];
      return all[index % all.length];
    }
  }

  // No topic match — extract the most meaningful words from the sentence.
  // Prefer longer words (tend to be more specific nouns/verbs) and skip
  // short connective words that produce useless queries.
  const words = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((word) => word.length > 4);

  const unique = [...new Set(words)].slice(0, 4);
  // Build a descriptive query rather than a generic fallback.
  // Adding "person" gives Pexels a concrete subject to anchor the search.
  if (unique.length >= 2) return unique.join(" ");
  if (unique.length === 1) return `${unique[0]} person scene`;
  return "person talking professional setting";
}

// Generic (non-India-specific) fallback — used by Pexels as a retry when the
// India-specific primary query returns zero results.
function buildGenericQuery(text, index = 0) {
  for (const entry of TOPICAL_MAP) {
    if (entry.pattern.test(text)) {
      return entry.queries[index % entry.queries.length];
    }
  }

  const words = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((word) => word.length > 4);

  const unique = [...new Set(words)].slice(0, 3);
  if (unique.length >= 2) return unique.join(" ");
  if (unique.length === 1) return `${unique[0]} scene`;
  return "professional person office scene";
}

function getBounds(segment) {
  return {
    start: segment.editedStartSeconds ?? segment.startSeconds ?? 0,
    end: segment.editedEndSeconds ?? segment.endSeconds ?? 0
  };
}

function pickDistributed(candidates, count) {
  const sorted = [...candidates].sort((a, b) => a.startSeconds - b.startSeconds);

  if (count >= sorted.length) {
    return sorted;
  }

  const firstStart = sorted[0].startSeconds;
  const lastStart = sorted[sorted.length - 1].startSeconds;
  const used = new Set();
  const picked = [];

  for (let index = 0; index < count; index += 1) {
    const anchor =
      count === 1
        ? (firstStart + lastStart) / 2
        : firstStart + ((lastStart - firstStart) * index) / (count - 1);

    let bestCandidateIndex = -1;
    let bestDistance = Number.POSITIVE_INFINITY;

    for (let candidateIndex = 0; candidateIndex < sorted.length; candidateIndex += 1) {
      if (used.has(candidateIndex)) {
        continue;
      }

      const distance = Math.abs(sorted[candidateIndex].startSeconds - anchor);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestCandidateIndex = candidateIndex;
      }
    }

    if (bestCandidateIndex >= 0) {
      used.add(bestCandidateIndex);
      picked.push(sorted[bestCandidateIndex]);
    }
  }

  return picked.sort((a, b) => a.startSeconds - b.startSeconds);
}

// Enforce minimum spacing between B-roll slots while keeping selections
// distributed across the entire timeline.
function enforceSpacing(candidates, maxSlots, minGapSeconds = 4) {
  if (!Array.isArray(candidates) || !candidates.length || maxSlots <= 0) {
    return [];
  }

  const targetCount = Math.min(maxSlots, candidates.length);
  const sorted = [...candidates].sort((a, b) => a.startSeconds - b.startSeconds);
  const distributed = pickDistributed(sorted, targetCount);
  const accepted = [];

  // Relax the gap requirement in progressive passes if we still need more slots.
  const gapPasses = [minGapSeconds, minGapSeconds * 0.75, 0];

  for (const gap of gapPasses) {
    for (const candidate of distributed) {
      if (accepted.length >= targetCount) break;
      const isTooClose = accepted.some(
        (item) => Math.abs(item.startSeconds - candidate.startSeconds) < gap
      );
      if (!isTooClose) accepted.push(candidate);
    }

    for (const candidate of sorted) {
      if (accepted.length >= targetCount) break;
      if (accepted.some((item) => item.id === candidate.id)) continue;
      const isTooClose = accepted.some(
        (item) => Math.abs(item.startSeconds - candidate.startSeconds) < gap
      );
      if (!isTooClose) accepted.push(candidate);
    }
  }

  return accepted.sort((a, b) => a.startSeconds - b.startSeconds);
}

function hasMiddleCoverage(selections, totalDuration) {
  if (!totalDuration || totalDuration <= 0 || !selections.length) return false;
  const middleStart = totalDuration * 0.2;
  const middleEnd = totalDuration * 0.8;
  return selections.some(
    (s) => s.startSeconds < middleEnd && s.endSeconds > middleStart
  );
}

function mergeUniqueSelections(primary, fallback, maxSlots, minGapSeconds = 3.5) {
  const merged = [...primary].sort((a, b) => a.startSeconds - b.startSeconds);

  for (const candidate of fallback) {
    if (merged.length >= maxSlots) break;
    // Deduplicate by time proximity, not by sourceSegmentId, so that long segments
    // can contribute multiple distinct B-roll slots at different timestamps.
    const isTooClose = merged.some(
      (item) => Math.abs(item.startSeconds - candidate.startSeconds) < minGapSeconds
    );
    if (!isTooClose) merged.push(candidate);
  }

  return merged.sort((a, b) => a.startSeconds - b.startSeconds);
}

// Build fallback B-roll by spreading selections across the full timeline.
// Long segments are subdivided so continuous-speech videos still get good coverage.
function fallbackBrollSelection(timelineSegments, targetCount) {
  const rawQualifying = timelineSegments
    .filter((segment) => {
      const { start, end } = getBounds(segment);
      return end - start >= MIN_SEGMENT_DURATION_SECONDS;
    })
    .map((segment) => {
      const { start, end } = getBounds(segment);
      return { ...segment, startSeconds: start, endSeconds: end, duration: end - start };
    })
    .sort((a, b) => a.startSeconds - b.startSeconds);

  if (!rawQualifying.length) return [];

  // Subdivide long segments into ~7-second sub-candidates for multiple B-roll slots.
  const SLOT_SPACING = 7;
  const qualifying = [];

  for (const seg of rawQualifying) {
    const numSubs = Math.max(1, Math.round(seg.duration / SLOT_SPACING));
    if (numSubs === 1) {
      qualifying.push(seg);
    } else {
      const subDur = seg.duration / numSubs;
      for (let i = 0; i < numSubs; i++) {
        qualifying.push({
          ...seg,
          id: `${seg.id}-sub${i}`,
          startSeconds: seg.startSeconds + subDur * i,
          endSeconds: seg.startSeconds + subDur * (i + 1),
          duration: subDur
        });
      }
    }
  }

  const distributed = pickDistributed(
    qualifying,
    Math.min(Math.max(1, targetCount), qualifying.length)
  );

  return distributed
    .map((segment, index) => {
      const availableDuration = segment.endSeconds - segment.startSeconds;
      if (availableDuration < 2.05) return null;

      const maxDuration = Math.max(2, availableDuration - 0.05);
      const duration = Math.min(3.5, maxDuration);
      const maxStart = segment.endSeconds - duration - 0.05;
      const startSeconds = Math.max(
        segment.startSeconds + 0.1,
        Math.min(segment.startSeconds + 0.2, maxStart)
      );

      const sourceSegmentId = String(segment.id).replace(/-sub\d+$/, "");

      return {
        id: `broll-fallback-${index}`,
        sourceSegmentId,
        startSeconds,
        endSeconds: startSeconds + duration,
        query: buildFallbackQuery(segment.text, index),
        fallbackQuery: buildGenericQuery(segment.text, index),
        reason: `Supports the topic: "${segment.text.slice(0, 60)}"`,
        importance: 0.5
      };
    })
    .filter(Boolean);
}

function parseJsonBlock(content) {
  if (!content) return null;
  const normalized = content.trim().replace(/^```json\s*/i, "").replace(/```$/, "");
  return JSON.parse(normalized);
}

export async function selectBrollSegments(timelineSegments) {
  const candidates = timelineSegments
    .filter((segment) => {
      const dur = segment.editedEndSeconds - segment.editedStartSeconds;
      return dur >= MIN_SEGMENT_DURATION_SECONDS;
    })
    .map((segment) => ({
      id: segment.id,
      startSeconds: segment.editedStartSeconds,
      endSeconds: segment.editedEndSeconds,
      duration: Number((segment.editedEndSeconds - segment.editedStartSeconds).toFixed(2)),
      text: segment.text
    }));

  if (!candidates.length) return [];

  const totalDuration = timelineSegments.length
    ? (timelineSegments[timelineSegments.length - 1].editedEndSeconds ?? 0)
    : 0;

  // Target one B-roll slot every ~6 seconds for natural Reels/Shorts pacing.
  // Capped at maxBrollSlots; minimum of 3 for any video with enough content.
  const targetBrollCount = Math.min(
    appConfig.maxBrollSlots,
    Math.max(3, Math.floor(totalDuration / 6))
  );
  const minimumBrollCount = Math.min(
    targetBrollCount,
    Math.max(2, Math.floor(totalDuration / 14) + 1)
  );

  const fallbackSelections = enforceSpacing(
    fallbackBrollSelection(candidates, targetBrollCount),
    appConfig.maxBrollSlots,
    4
  );

  // Full transcript text for broader context in the GPT prompt
  const fullTranscriptText = candidates.map((c) => c.text).join(" ");

  try {
    const client = getClient();
    const completion = await client.chat.completions.create({
      model: appConfig.openAiTextModel,
      temperature: 0.25,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `You are a visual researcher for a professional short-form video editor (Reels/Shorts). You select B-roll moments where a stock photo cutaway visually reinforces what the speaker is saying.

STEP 1 — SELECT VISUAL MOMENTS
Pick transcript moments where the speaker references something that can be PHOTOGRAPHED:
- People or professions: doctor, teacher, entrepreneur, police officer, chef
- Physical places: courtroom, hospital, office, kitchen, school, market
- Tangible objects: money, phone, documents, car, food, laptop
- Visible actions: cooking, studying, typing, driving, speaking at podium
- Events or situations: wedding, meeting, election, surgery, graduation

SKIP moments that are:
- Pure opinion/emotion with no visual referent ("I believe this is wrong")
- Meta-commentary ("as I mentioned", "let me explain")
- Abstract concepts with no natural image ("truth", "potential", "honesty")
- Dramatic reveals or emotional peaks where the speaker's face should stay visible

STEP 2 — WRITE SEARCH QUERIES
For each moment, think: "What would I literally see in the photograph?"

Rules:
- Use 3-7 concrete, descriptive words per query
- Describe SUBJECT + ACTION/STATE + SETTING when possible
- Add "indian" or "india" when the content discusses Indian context
- Every query must be visually DIFFERENT — never repeat the same scene
- Avoid single-word or abstract queries

✓ GOOD (specific scenes):
  "indian doctor examining patient hospital ward"
  "pile of indian rupee currency notes table"
  "stressed student studying late night desk books"
  "woman cooking traditional indian kitchen stove"
  "courtroom wooden judge bench gavel law"
  "busy indian city street traffic aerial"
  "software developer typing code laptop screen"

✗ BAD (too vague or abstract):
  "healthcare" / "money" / "education" / "technology" / "law"
  "success" / "growth" / "opportunity" / "family"
  "indian people" / "important meeting"

STEP 3 — ALTERNATIVE QUERY
For EACH selection, also write an alternativeQuery using completely different keywords that describe the SAME visual scene. This is a backup if the primary query returns no results.

Example:
  query: "indian software developer coding laptop office"
  alternativeQuery: "programmer typing computer screen workspace"

DIVERSITY: Never select two B-roll moments with the same visual theme. If you pick a courtroom, don't pick another courtroom — find a different visual.

COVERAGE: Spread B-roll evenly across the ENTIRE video duration — beginning, middle, and end. Target one B-roll every 6-8 seconds. For segments >10s, use multiple selections with different startOffset values.

TIMING: Each B-roll = 2.5–4.5 seconds. Use startOffset to place B-roll at different points within a segment.

SCHEMA for each item in "selections":
{
  "segmentId": "<id from segments list>",
  "startOffset": <seconds into the segment, 0.3 minimum>,
  "durationSeconds": <2.5–4.5>,
  "query": "<3-7 word stock photo search query>",
  "alternativeQuery": "<rephrased backup query using different keywords>",
  "reason": "<one sentence: why this visual reinforces the speech>",
  "importance": <0.0–1.0>
}

Return JSON: { "selections": [...] }`
        },
        {
          role: "user",
          content: JSON.stringify({
            fullTranscriptContext: fullTranscriptText.slice(0, 3000),
            instructions: {
              targetSelections: targetBrollCount,
              totalVideoDurationSeconds: Number(totalDuration.toFixed(1)),
              spreadAcrossEntireVideo: true,
              minGapBetweenSelectionsSeconds: 4,
              durationRangeSeconds: [2.5, 4.5],
              preferConcreteVisualScenes: true,
              everyQueryMustBeUnique: true,
              useDifferentStartOffsetsForLongSegments: true
            },
            segments: candidates
          })
        }
      ]
    });

    const parsed = parseJsonBlock(completion.choices[0]?.message?.content);
    const selections = Array.isArray(parsed?.selections) ? parsed.selections : [];

    console.log(`[broll] GPT returned ${selections.length} B-roll selections (target: ${targetBrollCount})`);

    const mappedSelections = selections
      .map((selection, index) => {
        const segment = candidates.find((c) => c.id === selection.segmentId);
        if (!segment || !selection.query) return null;

        const rawDuration = Number(selection.durationSeconds || 3.2);
        const maxAllowed = segment.endSeconds - segment.startSeconds - 0.3;
        if (maxAllowed < 2) return null;

        const duration = Math.min(Math.max(rawDuration, 2), 4.5, maxAllowed);
        const offset = Number(selection.startOffset || 0.2);
        const brollStart = Math.min(
          segment.startSeconds + Math.max(0.2, offset),
          segment.endSeconds - duration - 0.1
        );

        return {
          id: `broll-${index}`,
          sourceSegmentId: segment.id,
          startSeconds: brollStart,
          endSeconds: brollStart + duration,
          query: String(selection.query).trim(),
          // GPT-provided rephrased backup query using different keywords
          alternativeQuery: selection.alternativeQuery
            ? String(selection.alternativeQuery).trim()
            : undefined,
          // Topic-map generic fallback used when both GPT queries return 0 results
          fallbackQuery: buildGenericQuery(segment.text || "", index),
          reason: String(selection.reason || "Contextual visual reinforcement."),
          importance: Number(selection.importance || 0.5)
        };
      })
      .filter(Boolean)
      .sort((a, b) => a.startSeconds - b.startSeconds);

    if (!mappedSelections.length) {
      return fallbackSelections;
    }

    // Apply spacing enforcement while respecting the target count
    let finalSelections = enforceSpacing(mappedSelections, appConfig.maxBrollSlots, 4);

    // Backfill with timeline-distributed fallback if model output is sparse
    // or missing middle coverage
    if (
      finalSelections.length < minimumBrollCount ||
      !hasMiddleCoverage(finalSelections, totalDuration)
    ) {
      const supplemented = mergeUniqueSelections(
        finalSelections,
        fallbackSelections,
        appConfig.maxBrollSlots,
        3.5
      );
      finalSelections = enforceSpacing(supplemented, appConfig.maxBrollSlots, 3.5);
    }

    // Final safety net: if we still don't have enough coverage, use pure fallback
    if (
      finalSelections.length < minimumBrollCount ||
      !hasMiddleCoverage(finalSelections, totalDuration)
    ) {
      return fallbackSelections;
    }

    return finalSelections;
  } catch (err) {
    console.warn(`[broll] GPT selection failed, using fallback:`, err?.message || err);
    return fallbackSelections;
  }
}
