const megabyte = 1024 * 1024;

export const appConfig = {
  maxUploadBytes: Number(process.env.MAX_UPLOAD_MB || 500) * megabyte,
  defaultBrollProvider: process.env.DEFAULT_BROLL_PROVIDER || "pexels",
  openAiApiKey: process.env.OPENAI_API_KEY || "",

  // ── Transcription models ────────────────────────────────────────────────────
  // Primary: gpt-4o-transcribe gives far better word accuracy than whisper-1.
  // TRANSCRIPTION_MODEL overrides the legacy OPENAI_TRANSCRIPTION_MODEL key.
  openAiTranscriptionModel:
    process.env.TRANSCRIPTION_MODEL ||
    process.env.OPENAI_TRANSCRIPTION_MODEL ||
    "gpt-4o-transcribe",
  // Automatic fallback if the primary model call fails.
  openAiTranscriptionFallbackModel:
    process.env.TRANSCRIPTION_FALLBACK_MODEL || "gpt-4o-mini-transcribe",

  // ── Text / planning models ──────────────────────────────────────────────────
  // openAiTextModel is used for transcript cleanup only (NOT for transcription).
  openAiTextModel: process.env.OPENAI_TEXT_MODEL || "gpt-4o",
  // Dedicated model for B-roll planning (semantic selection + query generation).
  brollPlanningModel: process.env.BROLL_PLANNING_MODEL || "gpt-4.1",

  pexelsApiKey: process.env.PEXELS_API_KEY || "",

  // ── Caption settings ────────────────────────────────────────────────────────
  enableCaptionChunking: process.env.ENABLE_CAPTION_CHUNKING !== "false",
  // Maximum number of words per caption segment (hard cap).
  maxWordsPerCaption: Number(process.env.MAX_WORDS_PER_CAPTION || 6),
  // Minimum time a caption stays visible (ms) — prevents flash-and-vanish.
  minCaptionDurationMs: Number(process.env.MIN_CAPTION_DURATION_MS || 1200),
  // Maximum time a single caption may linger (ms) — prevents frozen captions.
  maxCaptionDurationMs: Number(process.env.MAX_CAPTION_DURATION_MS || 4000),

  // ── B-roll count & confidence ───────────────────────────────────────────────
  // Hard ceiling on how many B-roll slots may be inserted. Supports both key names.
  maxBrollSlots: Number(process.env.MAX_BROLL_COUNT || process.env.MAX_BROLL_SLOTS || 14),
  // Hard floor — must have at least this many relevant moments before inserting any.
  minBrollCount: Number(process.env.MIN_BROLL_COUNT || 7),
  // Only keep GPT B-roll selections whose importance score meets this threshold.
  // Prevents low-confidence / random visuals from ending up in the final video.
  brollConfidenceThreshold: parseFloat(process.env.BROLL_CONFIDENCE_THRESHOLD || "0.75"),
  enableBrollAnimation: process.env.ENABLE_BROLL_ANIMATION !== "false",

  // ── B-roll transition animation ─────────────────────────────────────────────
  brollTransitionType: process.env.BROLL_TRANSITION_TYPE || "fade", // "fade" | "none"
  brollFadeInMs: Number(process.env.BROLL_FADE_IN_MS || 300),
  brollFadeOutMs: Number(process.env.BROLL_FADE_OUT_MS || 300),
  brollZoomStrength: parseFloat(process.env.BROLL_ZOOM_STRENGTH || "1.04"),

  // ── B-roll animation preset system ─────────────────────────────────────────
  brollAnimationRandomize: process.env.BROLL_ANIMATION_RANDOMIZE !== "false",
  brollAnimationMaxRepeat: Number(process.env.BROLL_ANIMATION_MAX_REPEAT || 1),
  brollScaleFadeStrength: parseFloat(process.env.BROLL_SCALE_FADE_STRENGTH || "1.06"),
  brollKenburnsStrength: parseFloat(process.env.BROLL_KENBURNS_STRENGTH || "1.08"),
  brollSlideEntryDuration: parseFloat(process.env.BROLL_SLIDE_ENTRY_DURATION || "0.35")
};

export function requireEnv(key, value = process.env[key]) {
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }

  return value;
}
