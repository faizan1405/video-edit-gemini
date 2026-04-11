import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { ensureDir, readJson, writeJson } from "./fs-utils.js";
import { getJobDir, getJobJsonPath, jobsRoot } from "./paths.js";

function nowIso() {
  return new Date().toISOString();
}

export async function ensureJobRoots() {
  await ensureDir(jobsRoot);
}

export async function createJobRecord({
  originalFilename,
  storedFilename,
  fileSize,
  mimeType,
  aspectRatio
}) {
  await ensureJobRoots();

  const id = randomUUID();
  const jobDir = getJobDir(id);

  await ensureDir(jobDir);

  const job = {
    id,
    status: "queued",
    stage: "queued",
    progress: 5,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    aspectRatio,
    error: null,
    input: {
      originalFilename,
      storedFilename,
      path: path.join(jobDir, storedFilename),
      sizeBytes: fileSize,
      mimeType
    },
    analysis: {
      sourceDurationSeconds: 0,
      finalDurationSeconds: 0,
      removedDurationSeconds: 0
    },
    transcript: {
      language: "",
      text: "",
      segments: [],
      words: []
    },
    timeline: {
      segments: []
    },
    captions: {
      segments: [],
      assPath: "",
      srtPath: ""
    },
    broll: {
      provider: "",
      segments: []
    },
    output: {
      finalPath: "",
      relativeFinalPath: ""
    }
  };

  await writeJson(getJobJsonPath(id), job);
  return job;
}

export async function getJob(jobId) {
  return readJson(getJobJsonPath(jobId));
}

export async function updateJob(jobId, updater) {
  const current = await getJob(jobId);
  const next =
    typeof updater === "function" ? updater(structuredClone(current)) : updater;

  next.updatedAt = nowIso();
  await writeJson(getJobJsonPath(jobId), next);
  return next;
}

export async function setJobStage(jobId, stage, progress, extra = {}) {
  return updateJob(jobId, (job) => ({
    ...job,
    ...extra,
    status: extra.status || "processing",
    stage,
    progress
  }));
}

export async function setJobFailed(jobId, error) {
  return updateJob(jobId, (job) => ({
    ...job,
    status: "failed",
    stage: "failed",
    progress: job.progress,
    error: error instanceof Error ? error.message : String(error)
  }));
}

export async function setJobCompleted(jobId, payload) {
  return updateJob(jobId, (job) => ({
    ...job,
    ...payload,
    status: "completed",
    stage: "completed",
    progress: 100,
    error: null
  }));
}

export async function listJobs() {
  await ensureJobRoots();
  const jobIds = await fs.readdir(jobsRoot);
  const jobs = await Promise.all(
    jobIds.map(async (jobId) => {
      try {
        return await getJob(jobId);
      } catch {
        return null;
      }
    })
  );

  return jobs.filter(Boolean);
}
