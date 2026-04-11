import fs from "node:fs/promises";
import path from "node:path";
import formidable from "formidable";
import { appConfig } from "../config.js";
import { createJobRecord, updateJob } from "./job-store.js";
import { getJobDir } from "./paths.js";

const allowedExtensions = new Set([".mp4", ".mov", ".webm"]);
const allowedMimeTypes = new Set([
  "video/mp4",
  "video/quicktime",
  "video/webm"
]);

function parseForm(request, uploadDir) {
  const form = formidable({
    uploadDir,
    keepExtensions: true,
    multiples: false,
    maxFiles: 1,
    maxFileSize: appConfig.maxUploadBytes,
    filter(part) {
      if (!part.originalFilename) {
        return false;
      }

      const extension = path.extname(part.originalFilename).toLowerCase();
      return (
        allowedExtensions.has(extension) &&
        (!part.mimetype || allowedMimeTypes.has(part.mimetype))
      );
    }
  });

  return new Promise((resolve, reject) => {
    form.parse(request, (error, fields, files) => {
      if (error) {
        reject(error);
        return;
      }

      resolve({ fields, files });
    });
  });
}

function unwrapFile(files) {
  const value = files.video || files.file;

  if (!value) {
    return null;
  }

  return Array.isArray(value) ? value[0] : value;
}

export async function acceptUpload(request) {
  const job = await createJobRecord({
    originalFilename: "pending",
    storedFilename: "pending",
    fileSize: 0,
    mimeType: "",
    aspectRatio: "9:16"
  });

  const jobDir = getJobDir(job.id);
  const { fields, files } = await parseForm(request, jobDir);
  const uploadedFile = unwrapFile(files);

  if (!uploadedFile) {
    throw new Error("No video file was attached to the request.");
  }

  const originalFilename = uploadedFile.originalFilename || "upload.mp4";
  const extension = path.extname(originalFilename).toLowerCase();

  if (!allowedExtensions.has(extension)) {
    throw new Error("Only MP4, MOV, and WEBM uploads are allowed.");
  }

  const storedFilename = `input${extension}`;
  const destinationPath = path.join(jobDir, storedFilename);

  await fs.rename(uploadedFile.filepath, destinationPath);

  const aspectRatio = Array.isArray(fields.aspectRatio)
    ? fields.aspectRatio[0]
    : fields.aspectRatio || "9:16";

  return updateJob(job.id, (currentJob) => ({
    ...currentJob,
    stage: "queued",
    progress: 10,
    aspectRatio,
    input: {
      originalFilename,
      storedFilename,
      path: destinationPath,
      sizeBytes: uploadedFile.size || 0,
      mimeType: uploadedFile.mimetype || ""
    }
  }));
}
