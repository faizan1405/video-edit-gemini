import path from "node:path";
import fs from "node:fs/promises";
import { getJob, updateJob } from "../../../../lib/server/job-store.js";
import { serializeJobForClient } from "../../../../lib/server/serialize-job.js";
import { writeCaptionFiles } from "../../../../lib/server/processors/captions.js";
import { burnCaptions } from "../../../../lib/server/processors/render.js";
import { getJobDir } from "../../../../lib/server/paths.js";

export default async function handler(request, response) {
  const { jobId } = request.query;

  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    response.status(405).json({ error: "Method not allowed." });
    return;
  }

  let body;
  try {
    body = JSON.parse(
      await new Promise((resolve, reject) => {
        let data = "";
        request.on("data", (chunk) => { data += chunk; });
        request.on("end", () => resolve(data));
        request.on("error", reject);
      })
    );
  } catch {
    response.status(400).json({ error: "Invalid JSON body." });
    return;
  }

  const { segments } = body;

  if (!Array.isArray(segments) || !segments.length) {
    response.status(400).json({ error: "segments array is required." });
    return;
  }

  try {
    const job = await getJob(jobId);

    if (job.status !== "completed") {
      response.status(409).json({ error: "Can only edit captions on a completed job." });
      return;
    }

    if (job.captionLanguage === "none" || job.captions?.mode === "none") {
      response.status(409).json({ error: "Captions are disabled for this job." });
      return;
    }

    const jobDir = getJobDir(jobId);

    // Validate segment shape minimally
    const cleanSegments = segments.map((seg, index) => ({
      id: seg.id || `caption-${index}`,
      startSeconds: Number(seg.startSeconds),
      endSeconds: Number(seg.endSeconds),
      text: String(seg.text || "")
    }));

    const assPath = job.captions?.assPath || path.join(jobDir, "captions.ass");
    const srtPath = job.captions?.srtPath || path.join(jobDir, "captions.srt");
    const language = job.captions?.language || job.captionLanguage || job.transcript?.language || "en";

    // Re-write ASS and SRT files with the edited captions
    await writeCaptionFiles(cleanSegments, assPath, srtPath, job.aspectRatio, language);

    // Determine input for caption burn — prefer broll composite, fall back to edited base
    const brollCompositePath = path.join(jobDir, "edited-with-broll.mp4");
    const baseVideoPath = path.join(jobDir, "edited-base.mp4");

    let burnInputPath;
    try {
      await fs.access(brollCompositePath);
      burnInputPath = brollCompositePath;
    } catch {
      burnInputPath = baseVideoPath;
    }

    // Rename old final output before re-rendering
    const finalPath = path.join(jobDir, "final-output.mp4");
    try {
      await fs.rename(finalPath, path.join(jobDir, "final-output-prev.mp4"));
    } catch {
      // If rename fails, that's fine — burnCaptions uses -y to overwrite
    }

    // Re-burn captions onto the composite video
    await burnCaptions({ inputPath: burnInputPath, jobDir, assPath });

    // Save updated caption segments to job
    const updatedJob = await updateJob(jobId, (currentJob) => ({
      ...currentJob,
      captions: {
        ...currentJob.captions,
        segments: cleanSegments,
        assPath,
        srtPath,
        language
      }
    }));

    response.status(200).json(serializeJobForClient(updatedJob));
  } catch (error) {
    response.status(500).json({
      error: error instanceof Error ? error.message : "Failed to re-render captions."
    });
  }
}
