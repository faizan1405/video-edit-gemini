import { acceptUpload } from "../../../lib/server/uploads.js";
import { spawnJobWorker } from "../../../lib/server/spawn-worker.js";
import { listJobs } from "../../../lib/server/job-store.js";
import { serializeJobForClient } from "../../../lib/server/serialize-job.js";

export const config = {
  api: {
    bodyParser: false
  }
};

export default async function handler(request, response) {
  if (request.method === "GET") {
    const jobs = await listJobs();
    response.status(200).json(jobs.map(serializeJobForClient));
    return;
  }

  if (request.method !== "POST") {
    response.setHeader("Allow", "GET, POST");
    response.status(405).json({ error: "Method not allowed." });
    return;
  }

  try {
    const job = await acceptUpload(request);
    spawnJobWorker(job.id);
    response.status(201).json({ jobId: job.id });
  } catch (error) {
    response.status(400).json({
      error: error instanceof Error ? error.message : "Upload failed."
    });
  }
}
