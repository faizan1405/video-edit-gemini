import path from "node:path";

export const projectRoot = process.cwd();
export const dataRoot = path.join(projectRoot, "data");
export const jobsRoot = path.join(dataRoot, "jobs");

export function getJobDir(jobId) {
  return path.join(jobsRoot, jobId);
}

export function getJobJsonPath(jobId) {
  return path.join(getJobDir(jobId), "job.json");
}
