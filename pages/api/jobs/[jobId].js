import { getJob } from "../../../lib/server/job-store.js";
import { serializeJobForClient } from "../../../lib/server/serialize-job.js";

export default async function handler(request, response) {
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    response.status(405).json({ error: "Method not allowed." });
    return;
  }

  try {
    const { jobId } = request.query;
    const job = await getJob(jobId);
    response.status(200).json(serializeJobForClient(job));
  } catch {
    response.status(404).json({ error: "Job not found." });
  }
}
