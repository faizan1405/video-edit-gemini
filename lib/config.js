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
  brollZoomStrength: parseFloat(process.env.BROLL_ZOOM_STRENGTH || "1.04")
};

export function requireEnv(key, value = process.env[key]) {
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }

  return value;
}
