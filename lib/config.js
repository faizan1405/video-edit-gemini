const megabyte = 1024 * 1024;

export const appConfig = {
  maxUploadBytes: Number(process.env.MAX_UPLOAD_MB || 500) * megabyte,
  defaultBrollProvider: process.env.DEFAULT_BROLL_PROVIDER || "pexels",
  maxBrollSlots: Number(process.env.MAX_BROLL_SLOTS || 5),
  openAiApiKey: process.env.OPENAI_API_KEY || "",
  openAiTranscriptionModel:
    process.env.OPENAI_TRANSCRIPTION_MODEL || "whisper-1",
  openAiTextModel: process.env.OPENAI_TEXT_MODEL || "gpt-4o-mini",
  pexelsApiKey: process.env.PEXELS_API_KEY || ""
};

export function requireEnv(key, value = process.env[key]) {
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }

  return value;
}
