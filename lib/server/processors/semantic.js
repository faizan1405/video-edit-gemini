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
      if (accepted.some((item) => item.id === candidate.id)) continue;
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

/**
 * When transcription is sparse (e.g. whisper returned only 4 words for a
 * 58-second video), real timeline candidates cluster at the edges of the video
 * and leave the middle empty.  This helper creates evenly-spaced synthetic
 * candidate slots that cover the uncovered regions so that B-roll can be
 * distributed across the full video duration.
 *
 * Synthetic candidates reuse the full transcript text (passed as `contextText`)
 * so the GPT planner still has meaningful query context.
 */
function createSyntheticCandidates(totalDuration, existingCandidates, contextText, targetCount) {
  const spacing = totalDuration / (targetCount + 1);
  const synth = [];

  for (let i = 1; i <= targetCount; i++) {
    const mid = spacing * i;
    const start = Math.max(0, mid - 2.5);
    const end = Math.min(totalDuration, mid + 2.5);

    if (end - start < 2) continue;

    // Skip if too close to an existing candidate (within 3 s)
    const tooClose = existingCandidates.some(
      (c) => Math.abs(c.startSeconds - start) < 3
    );
    if (tooClose) continue;

    synth.push({
      id: `synth-cov-${i}`,
      startSeconds: start,
      endSeconds: end,
      duration: Number((end - start).toFixed(2)),
      text: contextText
    });
  }

  return synth;
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

  // ── Sparse-coverage safety net ──────────────────────────────────────────────
  // If real candidates cover < 40 % of the total video duration, supplement
  // with evenly-spaced synthetic candidates so B-roll is distributed across
  // the full video.  Without this, sparse transcription causes B-roll to be
  // placed only at the very beginning and end of the video.
  if (totalDuration > 10) {
    const coveredSeconds = candidates.reduce(
      (sum, c) => sum + (c.endSeconds - c.startSeconds),
      0
    );
    const coverageRatio = coveredSeconds / totalDuration;

    if (coverageRatio < 0.40) {
      const contextText = candidates.map((c) => c.text).join(" ").slice(0, 300);
      const targetSlots = Math.max(6, Math.floor(totalDuration / 5));
      const synthetic = createSyntheticCandidates(totalDuration, candidates, contextText, targetSlots);

      if (synthetic.length > 0) {
        candidates.push(...synthetic);
        candidates.sort((a, b) => a.startSeconds - b.startSeconds);
        console.log(
          `[broll] Sparse candidate coverage (${(coverageRatio * 100).toFixed(0)}% of ${totalDuration.toFixed(1)}s). ` +
          `Added ${synthetic.length} synthetic slots for full-video B-roll distribution.`
        );
      }
    }
  }

  // Target one B-roll slot every ~5 seconds for natural Reels/Shorts pacing.
  // Hard floor = appConfig.minBrollCount (default 7).
  // Hard ceiling = appConfig.maxBrollSlots (default 14).
  const rawTarget = Math.floor(totalDuration / 5);
  const targetBrollCount = Math.min(
    appConfig.maxBrollSlots,
    Math.max(appConfig.minBrollCount, rawTarget)
  );
  const minimumBrollCount = Math.max(
    appConfig.minBrollCount,
    Math.min(targetBrollCount, Math.floor(totalDuration / 10) + 3)
  );

  const fallbackSelections = enforceSpacing(
    fallbackBrollSelection(candidates, targetBrollCount),
    appConfig.maxBrollSlots,
    3.5
  );

  // Full transcript text for broader context in the GPT prompt
  const fullTranscriptText = candidates.map((c) => c.text).join(" ");

  try {
    const client = getClient();
    const completion = await client.chat.completions.create({
      model: appConfig.brollPlanningModel,
      temperature: 0.3,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `You are a senior visual researcher and stock footage director for a premium short-form video editor (Instagram Reels / YouTube Shorts). Your task: select B-roll cutaway moments and write highly descriptive Pexels search queries that return RELEVANT, visually compelling results.

═══ PHASE 1: UNDERSTAND THE VIDEO ═══

Before selecting moments, read the ENTIRE transcript and identify:
- The main topic/theme of the video
- Key entities mentioned (people, places, organisations, products)
- The emotional arc (informative, dramatic, humorous, motivational)
- Whether the context is Indian — if yes, prefer India-specific imagery

═══ PHASE 2: SELECT VISUAL MOMENTS ═══

Pick ${targetBrollCount} moments (minimum ${minimumBrollCount}) where a stock photo/video cutaway would STRENGTHEN the viewer's understanding.

IDEAL B-roll moments show:
- A person/profession the speaker mentions (doctor, lawyer, teacher, entrepreneur)
- A physical place being discussed (courtroom, hospital, office, market, kitchen)
- A tangible object central to the point (money, phone, documents, laptop, food)
- A visible action being described (cooking, studying, coding, driving, protesting)
- An event or situation (wedding, meeting, election, graduation, surgery)
- Data/charts/screens when discussing numbers, growth, or statistics

SKIP these — the speaker's face should stay visible:
- Pure emotional statements with no visual anchor ("I feel strongly about this")
- Meta-commentary ("as I was saying", "let me explain")
- Abstract concepts with no photographable form ("truth", "potential", "karma")
- Punchlines, reveals, or dramatic peaks where speaker expression matters

═══ PHASE 3: WRITE SEARCH QUERIES (CRITICAL) ═══

For each moment, imagine you are describing a PHOTOGRAPH to a blind person.
Your query goes directly to Pexels stock photo search. Write it as if you are describing what the camera sees.

QUERY FORMULA: [Subject] + [Action/State] + [Setting/Context] + [Optional: cultural modifier]

✓ EXCELLENT queries (specific, descriptive, searchable):
  "indian doctor examining patient stethoscope hospital ward"
  "stack of indian rupee banknotes wooden table close-up"
  "young woman studying late night desk lamp books exam"
  "traditional indian kitchen woman cooking gas stove spices"
  "wooden judge bench gavel courtroom empty serious"
  "aerial view busy indian city street traffic rickshaws"
  "software developer typing code dark screen multiple monitors"
  "indian farmer standing wheat field sunrise rural"
  "business meeting conference room whiteboard presentation team"
  "person scrolling smartphone social media bed night"

✗ TERRIBLE queries (will return irrelevant or random results):
  "healthcare" / "money" / "education" / "technology"
  "success growth opportunity" / "family values"
  "important meeting" / "indian people" / "professional scene"
  "abstract concept" / "emotional moment"

RULES:
- Every query MUST be 4-8 descriptive words
- Describe what the CAMERA SEES, not what the speaker MEANS
- Add "indian" or "india" when the video discusses Indian context
- NEVER repeat the same visual scene across queries — each must be unique
- NEVER use single abstract words as queries
- Prefer nouns and adjectives over verbs

═══ PHASE 4: ALTERNATIVE QUERY ═══

For EACH selection, write an alternativeQuery using COMPLETELY DIFFERENT keywords that describe the SAME visual concept. This is the fallback if the primary query returns zero results.

Example:
  query: "indian software developer coding laptop modern office"
  alternativeQuery: "programmer typing keyboard computer screen workspace night"

═══ PHASE 5: DISTRIBUTION ═══

CRITICAL: Spread selections EVENLY across the full video duration.
- The first B-roll should appear within the first 8 seconds
- The last B-roll should appear in the final 20% of the video
- Maintain roughly equal spacing (every 4-7 seconds)
- For long segments (>10s), place MULTIPLE B-rolls at different startOffset values
- NEVER cluster 3+ B-rolls in one section while leaving another section empty

═══ OUTPUT SCHEMA ═══

Each item in "selections":
{
  "segmentId": "<id from segments list>",
  "startOffset": <seconds into the segment — minimum 0.3>,
  "durationSeconds": <2.5–4.5>,
  "query": "<4-8 word descriptive stock photo search query>",
  "alternativeQuery": "<completely rephrased backup query, different keywords>",
  "reason": "<one sentence: what specific visual this reinforces>",
  "importance": <0.0–1.0, higher = more critical to the narrative>
}

Return JSON: { "selections": [...] }`
        },
        {
          role: "user",
          content: JSON.stringify({
            fullTranscriptContext: fullTranscriptText.slice(0, 4000),
            instructions: {
              targetSelections: targetBrollCount,
              minimumSelections: minimumBrollCount,
              totalVideoDurationSeconds: Number(totalDuration.toFixed(1)),
              spreadAcrossEntireVideo: true,
              firstBrollBeforeSecond: 8,
              lastBrollInFinalPercent: 20,
              minGapBetweenSelectionsSeconds: 3.5,
              durationRangeSeconds: [2.5, 4.5],
              preferConcreteVisualScenes: true,
              everyQueryMustBeVisuallyUnique: true,
              useDifferentStartOffsetsForLongSegments: true,
              queryMinWords: 4,
              queryMaxWords: 8
            },
            segments: candidates
          })
        }
      ]
    });

    const parsed = parseJsonBlock(completion.choices[0]?.message?.content);
    const selections = Array.isArray(parsed?.selections) ? parsed.selections : [];

    // Filter out selections with weak/vague queries (less than 3 words) or below
    // the configured confidence threshold (BROLL_CONFIDENCE_THRESHOLD, default 0.75).
    // Low-confidence selections are worse than no B-roll — skip them.
    const confidenceThreshold = appConfig.brollConfidenceThreshold;

    console.log(
      `[broll] ${appConfig.brollPlanningModel} returned ${selections.length} selections ` +
      `(target: ${targetBrollCount}, min: ${minimumBrollCount}, threshold: ${confidenceThreshold})`
    );

    const mappedSelections = selections
      .map((selection, index) => {
        const segment = candidates.find((c) => c.id === selection.segmentId);
        if (!segment || !selection.query) return null;

        const queryWords = String(selection.query).trim().split(/\s+/);
        if (queryWords.length < 3) {
          console.warn(`[broll] Rejecting weak query: "${selection.query}" (only ${queryWords.length} words)`);
          return null;
        }

        const importance = Number(selection.importance ?? 0.5);
        if (importance < confidenceThreshold) {
          console.warn(
            `[broll] Skipping low-confidence selection (${importance.toFixed(2)} < ${confidenceThreshold}): "${selection.query}"`
          );
          return null;
        }

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
          alternativeQuery: selection.alternativeQuery
            ? String(selection.alternativeQuery).trim()
            : undefined,
          fallbackQuery: buildGenericQuery(segment.text || "", index),
          reason: String(selection.reason || "Contextual visual reinforcement."),
          importance
        };
      })
      .filter(Boolean)
      .sort((a, b) => a.startSeconds - b.startSeconds);

    if (!mappedSelections.length) {
      return fallbackSelections;
    }

    // Apply spacing enforcement while respecting the target count
    let finalSelections = enforceSpacing(mappedSelections, appConfig.maxBrollSlots, 3.5);

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
        3
      );
      finalSelections = enforceSpacing(supplemented, appConfig.maxBrollSlots, 3);
    }

    // Final safety net: if we still don't have enough coverage, merge all
    if (
      finalSelections.length < minimumBrollCount ||
      !hasMiddleCoverage(finalSelections, totalDuration)
    ) {
      const merged = mergeUniqueSelections(
        finalSelections,
        fallbackSelections,
        appConfig.maxBrollSlots,
        2.5
      );
      return enforceSpacing(merged, appConfig.maxBrollSlots, 2.5);
    }

    return finalSelections;
  } catch (err) {
    console.warn(`[broll] GPT selection failed, using fallback:`, err?.message || err);
    return fallbackSelections;
  }
}
