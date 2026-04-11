import path from "node:path";
import { getJob, setJobCompleted, setJobFailed, updateJob } from "./job-store.js";
import { getJobDir } from "./paths.js";
import { inspectMedia } from "./ffmpeg.js";
import { extractTranscriptionAudio } from "./processors/media.js";
import { transcribeAudio } from "./processors/transcribe.js";
import { detectSilences } from "./processors/silence.js";
import { buildTimeline } from "./processors/timeline.js";
import { buildCaptionSegments, writeCaptionFiles } from "./processors/captions.js";
import { selectBrollSegments } from "./processors/semantic.js";
import { fetchBrollAssets } from "./providers/broll/index.js";
import {
  burnCaptions,
  renderBrollComposite,
  renderEditedBaseVideo
} from "./processors/render.js";

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

    const audioPath = await extractTranscriptionAudio(jobDir, inputPath);
    const transcription = await transcribeAudio(audioPath);

    await updateJob(jobId, (currentJob) => ({
      ...currentJob,
      status: "processing",
      stage: "detecting_cuts",
      progress: 38,
      transcript: publicTranscript(transcription)
    }));

    const silenceEvents = await detectSilences(audioPath);
    const timeline = buildTimeline({
      transcription,
      silenceEvents,
      sourceDurationSeconds: mediaInfo.durationSeconds
    });

    await updateJob(jobId, (currentJob) => ({
      ...currentJob,
      status: "processing",
      stage: "generating_captions",
      progress: 56,
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

    const captionSegments = buildCaptionSegments(timeline.mappedWords);
    const assPath = path.join(jobDir, "captions.ass");
    const srtPath = path.join(jobDir, "captions.srt");

    await writeCaptionFiles(
      captionSegments,
      assPath,
      srtPath,
      job.aspectRatio,
      transcription.language
    );

    await updateJob(jobId, (currentJob) => ({
      ...currentJob,
      status: "processing",
      stage: "selecting_broll",
      progress: 66,
      captions: {
        segments: captionSegments,
        assPath,
        srtPath
      }
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

    const baseVideoPath = await renderEditedBaseVideo({
      inputPath,
      jobDir,
      segments: timeline.segments,
      aspectRatio: job.aspectRatio
    });
    const compositePath = await renderBrollComposite({
      baseVideoPath,
      jobDir,
      brollSegments: broll.segments,
      aspectRatio: job.aspectRatio
    });
    const finalPath = await burnCaptions({
      inputPath: compositePath,
      jobDir,
      assPath
    });

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
      captions: {
        segments: captionSegments,
        assPath,
        srtPath
      },
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
