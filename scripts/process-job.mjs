import nextEnv from "@next/env";

const { loadEnvConfig } = nextEnv;

loadEnvConfig(process.cwd());

const jobId = process.argv[2];

if (!jobId) {
  throw new Error("A job ID is required.");
}

const { processJob } = await import("../lib/server/process-job.js");

await processJob(jobId);
