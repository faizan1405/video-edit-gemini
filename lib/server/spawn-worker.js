import path from "node:path";
import fs from "node:fs";
import { spawn } from "node:child_process";
import { getJobDir } from "./paths.js";

export function spawnJobWorker(jobId) {
  const scriptPath = path.join(process.cwd(), "scripts", "process-job.mjs");
  const jobDir = getJobDir(jobId);

  // Ensure the job directory exists before opening log files.
  fs.mkdirSync(jobDir, { recursive: true });

  const logPath = path.join(jobDir, "worker.log");
  const logFd = fs.openSync(logPath, "a");

  const child = spawn(process.execPath, [scriptPath, jobId], {
    detached: true,
    stdio: ["ignore", logFd, logFd],
    env: process.env
  });

  child.unref();
  fs.closeSync(logFd);

  console.log(`[worker] Spawned job ${jobId.slice(0, 8)} — log: ${logPath}`);
}
