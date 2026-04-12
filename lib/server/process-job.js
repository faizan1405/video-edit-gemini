import path from "node:path";
import { getJob, setJobCompleted, setJobFailed, updateJob } from "./job-store.js";
import { getJobDir } from "./paths.js";
import { inspectMedia } from "./ffmpeg.js";
import { extractTranscriptionAudio } from "./processors/media.js";
import { transcribeAudio } from "./processors/transcribe.js";
import { buildTimeline } from "./processors/timeline.js";
import { buildCaptionSegments, writeCaptionFiles } from "./processors/captions.js";
import { selectBrollSegments } from "./processors/semantic.js";
import { fetchBrollAssets } from "./providers/broll/index.js";
import {
  burnCaptions,
  renderBrollComposite,
  renderEditedBaseVideo
} from "./processors/render.js";

// "none" means user explicitly disabled captions — skip all caption work.
const CAPTION_MODE_NONE = "none";

function publicTranscript(transcription) {
  return {
    language: transcription.language,
    text: transcription.text,
    segments: transcription.segments
  };
}

export async function processJob(jobId) {
  try {
    const job = await getJob(jobId);
    const jobDir = getJobDir(jobId);
    const inputPath = job.input.path;

    // Record when real processing begins — used by the UI timer.
    await updateJob(jobId, (currentJob) => ({
      ...currentJob,
      processingStartedAt: new Date().toISOString()
    }));

    // Determine caption mode up front.
    // "none" = user explicitly disabled captions; skip all caption work.
    const captionMode = job.captionLanguage === CAPTION_MODE_NONE
      ? CAPTION_MODE_NONE
      : "captions";

    const mediaInfo = await inspectMedia(inputPath);

    await updateJob(jobId, (currentJob) => ({
      ...currentJob,
      status: "processing",
      stage: "transcribing",
      progress: 18,
      analysis: {
        ...currentJob.analysis,
        sourceDurationSeconds: mediaInfo.durationSeconds
      }
    }));

    // Always transcribe — needed for timeline and B-roll selection regardless of caption mode.
    // When captionMode is "none", transcribeAudio receives "none" which falls through to
    // auto-detection (no Whisper language hint sent).
    const audioPath = await extractTranscriptionAudio(jobDir, inputPath);
    const transcription = await transcribeAudio(audioPath, job.captionLanguage || "auto");

    await updateJob(jobId, (currentJob) => ({
      ...currentJob,
      status: "processing",
      stage: "analyzing_speech",
      progress: 38,
      transcript: publicTranscript(transcription)
    }));

    const timeline = buildTimeline({
      transcription,
      sourceDurationSeconds: mediaInfo.durationSeconds
    });

    await updateJob(jobId, (currentJob) => ({
      ...currentJob,
      status: "processing",
      // Skip the "generating_captions" stage label when captions are disabled.
      stage: captionMode === CAPTION_MODE_NONE ? "selecting_broll" : "generating_captions",
      progress: captionMode === CAPTION_MODE_NONE ? 60 : 56,
      analysis: {
        ...currentJob.analysis,
        sourceDurationSeconds: timeline.sourceDurationSeconds,
        finalDurationSeconds: timeline.finalDurationSeconds,
        removedDurationSeconds: timeline.removedDurationSeconds
      },
      timeline: {
        segments: timeline.segments
      }
    }));

    // Caption generation — skipped entirely when captionMode is "none".
    let captionSegments = [];
    let assPath = null;
    let srtPath = null;
    let effectiveLanguage = null;

    if (captionMode !== CAPTION_MODE_NONE) {
      // Prefer the user's explicit language selection; fall back to Whisper's detection.
      // This must be resolved before buildCaptionSegments so the correct word-grouping
      // thresholds (Hindi vs English) are applied, not just the font/style.
      effectiveLanguage = job.captionLanguage && job.captionLanguage !== "auto"
        ? job.captionLanguage
        : transcription.language;

      captionSegments = buildCaptionSegments(timeline.mappedWords, effectiveLanguage);
      assPath = path.join(jobDir, "captions.ass");
      srtPath = path.join(jobDir, "captions.srt");

      await writeCaptionFiles(
        captionSegments,
        assPath,
        srtPath,
        job.aspectRatio,
        effectiveLanguage
      );
    }

    await updateJob(jobId, (currentJob) => ({
      ...currentJob,
      status: "processing",
      stage: "selecting_broll",
      progress: 66,
      captions: captionMode === CAPTION_MODE_NONE
        ? { segments: [], assPath: "", srtPath: "", language: "none", mode: "none" }
        : { segments: captionSegments, assPath, srtPath, language: effectiveLanguage }
    }));

    const brollSelections = await selectBrollSegments(timeline.segments);

    await updateJob(jobId, (currentJob) => ({
      ...currentJob,
      status: "processing",
      stage: "fetching_broll",
      progress: 74,
      broll: {
        ...currentJob.broll,
        segments: brollSelections
      }
    }));

    const broll = await fetchBrollAssets({
      jobDir,
      segments: brollSelections,
      aspectRatio: job.aspectRatio,
      kind: "image"
    });

    await updateJob(jobId, (currentJob) => ({
      ...currentJob,
      status: "processing",
      stage: "rendering",
      progress: 86,
      broll
    }));

    // Render the FULL original video — no trimming.
    // sourceDurationSeconds is passed so FFmpeg can cap to the known duration.
    const baseVideoPath = await renderEditedBaseVideo({
      inputPath,
      jobDir,
      sourceDurationSeconds: mediaInfo.durationSeconds,
      aspectRatio: job.aspectRatio
    });
    const compositePath = await renderBrollComposite({
      baseVideoPath,
      jobDir,
      brollSegments: broll.segments,
      aspectRatio: job.aspectRatio
    });

    // Caption burn — skipped entirely when captionMode is "none".
    // In that case the composite (or base) video IS the final output.
    let finalPath;
    if (captionMode !== CAPTION_MODE_NONE) {
      finalPath = await burnCaptions({
        inputPath: compositePath,
        jobDir,
        assPath
      });
    } else {
      // No captions — point the final output directly at the composite/base video.
      finalPath = compositePath;
    }

    await setJobCompleted(jobId, {
      analysis: {
        sourceDurationSeconds: timeline.sourceDurationSeconds,
        finalDurationSeconds: timeline.finalDurationSeconds,
        removedDurationSeconds: timeline.removedDurationSeconds
      },
      transcript: publicTranscript(transcription),
      timeline: {
        segments: timeline.segments
      },
      captions: captionMode === CAPTION_MODE_NONE
        ? { segments: [], assPath: "", srtPath: "", language: "none", mode: "none" }
        : { segments: captionSegments, assPath, srtPath, language: effectiveLanguage },
      broll,
      output: {
        finalPath,
        relativeFinalPath: path.relative(process.cwd(), finalPath).replace(/\\/g, "/")
      }
    });
  } catch (error) {
    await setJobFailed(jobId, error);
    throw error;
  }
}
