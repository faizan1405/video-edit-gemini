import path from "node:path";
import { spawn } from "node:child_process";

export function spawnJobWorker(jobId) {
  const scriptPath = path.join(process.cwd(), "scripts", "process-job.mjs");

  const child = spawn(process.execPath, [scriptPath, jobId], {
    detached: true,
    stdio: "ignore",
    env: process.env
  });

  child.unref();
}
