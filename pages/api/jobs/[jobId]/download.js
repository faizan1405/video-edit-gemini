import fs from "node:fs";
import path from "node:path";
import { getJob } from "../../../../lib/server/job-store.js";

export default async function handler(request, response) {
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    response.status(405).json({ error: "Method not allowed." });
    return;
  }

  try {
    const { jobId } = request.query;
    const job = await getJob(jobId);
    const finalPath = job.output?.finalPath;

    if (!finalPath) {
      response.status(409).json({ error: "The final render is not ready yet." });
      return;
    }

    response.setHeader("Content-Type", "video/mp4");
    // Never cache — the file is overwritten on every caption re-render, so
    // stale cached responses would show the old video after edits are applied.
    response.setHeader("Cache-Control", "no-store");
    response.setHeader(
      "Content-Disposition",
      `inline; filename="${path.parse(job.input.originalFilename || "edited").name}-edited.mp4"`
    );

    fs.createReadStream(finalPath).pipe(response);
  } catch {
    response.status(404).json({ error: "Rendered video not found." });
  }
}
