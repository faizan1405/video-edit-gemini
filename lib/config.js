const megabyte = 1024 * 1024;

export const appConfig = {
  maxUploadBytes: Number(process.env.MAX_UPLOAD_MB || 500) * megabyte,
  defaultBrollProvider: process.env.DEFAULT_BROLL_PROVIDER || "pexels",
  // Default raised to 10 for better coverage on typical Reels/Shorts length videos.
  // Override via MAX_BROLL_SLOTS env variable.
  maxBrollSlots: Number(process.env.MAX_BROLL_SLOTS || 10),
  openAiApiKey: process.env.OPENAI_API_KEY || "",
  openAiTranscriptionModel:
    process.env.OPENAI_TRANSCRIPTION_MODEL || "whisper-1",
  openAiTextModel: process.env.OPENAI_TEXT_MODEL || "gpt-4o-mini",
  pexelsApiKey: process.env.PEXELS_API_KEY || "",

  // B-roll transition animation
  brollTransitionType: process.env.BROLL_TRANSITION_TYPE || "fade", // "fade" | "none"
  brollFadeInMs: Number(process.env.BROLL_FADE_IN_MS || 300),
  brollFadeOutMs: Number(process.env.BROLL_FADE_OUT_MS || 300),
  // Subtle static zoom applied to image B-roll (1.0 = no zoom, 1.04 = 4% zoom-in crop)
  brollZoomStrength: parseFloat(process.env.BROLL_ZOOM_STRENGTH || "1.04"),

  // B-roll animation preset system
  // Whether to cycle through varied animation presets (true) or use a fixed default (false)
  brollAnimationRandomize: process.env.BROLL_ANIMATION_RANDOMIZE !== "false",
  // How many consecutive segments must pass before the same preset may reappear.
  // 1 = never two in a row; 2 = at least two other segments between repeats.
  brollAnimationMaxRepeat: Number(process.env.BROLL_ANIMATION_MAX_REPEAT || 1),
  // Zoom scale for "scale-fade" preset (slightly more pronounced than zoom-fade)
  brollScaleFadeStrength: parseFloat(process.env.BROLL_SCALE_FADE_STRENGTH || "1.06"),
  // Zoom scale for "kenburns-r" / "kenburns-l" directional-crop presets
  brollKenburnsStrength: parseFloat(process.env.BROLL_KENBURNS_STRENGTH || "1.08"),
  // Duration of slide-in animation for slide-* presets (seconds)
  brollSlideEntryDuration: parseFloat(process.env.BROLL_SLIDE_ENTRY_DURATION || "0.35")
};

export function requireEnv(key, value = process.env[key]) {
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }

  return value;
}
