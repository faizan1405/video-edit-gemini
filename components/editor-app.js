"use client";

import { useEffect, useMemo, useRef, useState } from "react";

const emptyJob = null;

function formatStage(stage) {
  if (!stage) {
    return "Waiting for upload";
  }

  return stage
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatSeconds(seconds) {
  if (typeof seconds !== "number" || Number.isNaN(seconds)) {
    return "0:00";
  }

  const minutes = Math.floor(seconds / 60);
  const remaining = Math.round(seconds % 60)
    .toString()
    .padStart(2, "0");

  return `${minutes}:${remaining}`;
}

export default function EditorApp() {
  const [file, setFile] = useState(null);
  const [aspectRatio, setAspectRatio] = useState("9:16");
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [jobId, setJobId] = useState("");
  const [job, setJob] = useState(emptyJob);
  const [error, setError] = useState("");
  const pollRef = useRef(null);

  useEffect(() => {
    if (!jobId) {
      return undefined;
    }

    async function poll() {
      try {
        const response = await fetch(`/api/jobs/${jobId}`);

        if (!response.ok) {
          throw new Error("Could not read job status.");
        }

        const nextJob = await response.json();
        setJob(nextJob);

        if (nextJob.status === "completed" || nextJob.status === "failed") {
          window.clearInterval(pollRef.current);
          pollRef.current = null;
        }
      } catch (pollError) {
        setError(pollError.message);
      }
    }

    poll();
    pollRef.current = window.setInterval(poll, 2500);

    return () => {
      if (pollRef.current) {
        window.clearInterval(pollRef.current);
      }
    };
  }, [jobId]);

  const mergedProgress = useMemo(() => {
    if (uploading) {
      return uploadProgress;
    }

    return job?.progress ?? 0;
  }, [job?.progress, uploadProgress, uploading]);

  async function handleSubmit(event) {
    event.preventDefault();

    if (!file) {
      setError("Choose a video file first.");
      return;
    }

    setUploading(true);
    setUploadProgress(0);
    setError("");
    setJob(null);
    if (pollRef.current) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }
    setJobId("");

    const payload = new FormData();
    payload.append("video", file);
    payload.append("aspectRatio", aspectRatio);

    await new Promise((resolve) => {
      const request = new XMLHttpRequest();
      request.open("POST", "/api/jobs");
      request.responseType = "json";

      request.upload.onprogress = (progressEvent) => {
        if (!progressEvent.lengthComputable) {
          return;
        }

        const nextProgress = Math.round(
          (progressEvent.loaded / progressEvent.total) * 100
        );

        setUploadProgress(nextProgress);
      };

      request.onload = () => {
        setUploading(false);

        if (request.status >= 200 && request.status < 300) {
          setUploadProgress(100);
          setJobId(request.response.jobId);
          resolve();
          return;
        }

        const message =
          request.response?.error ||
          "The upload could not be processed. Check the file and try again.";
        setError(message);
        resolve();
      };

      request.onerror = () => {
        setUploading(false);
        setError("The upload failed before the server could accept the file.");
        resolve();
      };

      request.send(payload);
    });
  }

  function resetState() {
    if (pollRef.current) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }
    setFile(null);
    setAspectRatio("9:16");
    setUploadProgress(0);
    setUploading(false);
    setJobId("");
    setJob(emptyJob);
    setError("");
  }

  const downloadUrl =
    jobId && job?.status === "completed"
      ? `/api/jobs/${jobId}/download`
      : null;

  return (
    <section className="workspace">
      <form className="panel controls" onSubmit={handleSubmit}>
        <h2>Upload and process</h2>
        <p>
          This flow accepts real video files, pushes the upload to the backend,
          and starts an async editing job that runs through transcription,
          cut-detection, captions, B-roll fetch, and final render.
        </p>

        <div className="field">
          <label htmlFor="video">Raw video</label>
          <input
            id="video"
            type="file"
            accept=".mp4,.mov,.webm,video/mp4,video/quicktime,video/webm"
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          />
          <p className="hint">Accepted: MP4, MOV, WEBM. Large local files are supported.</p>
        </div>

        <div className="field">
          <label htmlFor="aspectRatio">Output aspect ratio</label>
          <select
            id="aspectRatio"
            value={aspectRatio}
            onChange={(event) => setAspectRatio(event.target.value)}
          >
            <option value="9:16">9:16 for Reels and Shorts</option>
            <option value="16:9">16:9 for landscape export</option>
          </select>
        </div>

        <div className="field">
          <label>Progress</label>
          <div className="progress-shell">
            <div
              className="progress-bar"
              style={{ width: `${Math.min(100, Math.max(0, mergedProgress))}%` }}
            />
          </div>
          <p className="hint">
            {uploading
              ? `Uploading file: ${uploadProgress}%`
              : `${formatStage(job?.stage)}${job ? `: ${job.progress}%` : ""}`}
          </p>
        </div>

        <div className="button-row">
          <button className="button button-primary" disabled={!file || uploading}>
            {uploading ? "Uploading..." : "Start edit"}
          </button>
          <button
            className="button button-secondary"
            type="button"
            onClick={resetState}
          >
            Reset
          </button>
        </div>

        {error ? <div className="error-box">{error}</div> : null}

        <div className="note-box">
          Add your keys in <code>.env</code> before processing:
          <code>OPENAI_API_KEY</code> for transcription and semantic analysis,
          plus <code>PEXELS_API_KEY</code> for image-based B-roll.
        </div>
      </form>

      <div className="panel results">
        <div>
          <h2>Job output</h2>
          <p className="section-copy">
            The right panel shows the current processing stage, the selected
            timeline segments, captions, chosen B-roll, and the rendered video
            once the backend finishes.
          </p>
        </div>

        <div className="results-grid">
          <div className="video-frame">
            {downloadUrl ? (
              <video src={downloadUrl} controls playsInline preload="metadata" />
            ) : (
              <div className="video-placeholder">
                <p>
                  Final preview appears here after rendering completes. Until
                  then you can monitor the live job state and editing decisions.
                </p>
              </div>
            )}
          </div>

          <div className="card-row">
            <article className="stat-card">
              <p className="stat-label">Status</p>
              <p className="stat-value">
                <span
                  className={[
                    "stage-pill",
                    job?.status === "completed"
                      ? "success"
                      : job?.status === "failed"
                        ? "failed"
                        : ""
                  ].join(" ")}
                >
                  {formatStage(job?.stage || job?.status)}
                </span>
              </p>
            </article>

            <article className="stat-card">
              <p className="stat-label">Source Duration</p>
              <p className="stat-value">
                {formatSeconds(job?.analysis?.sourceDurationSeconds)}
              </p>
            </article>

            <article className="stat-card">
              <p className="stat-label">Final Duration</p>
              <p className="stat-value">
                {formatSeconds(job?.analysis?.finalDurationSeconds)}
              </p>
            </article>

            <article className="stat-card">
              <p className="stat-label">Removed Pause Time</p>
              <p className="stat-value">
                {formatSeconds(job?.analysis?.removedDurationSeconds)}
              </p>
            </article>
          </div>
        </div>

        <div className="detail-grid">
          <article className="detail-card">
            <h3>Cut timeline</h3>
            <ul className="segment-list">
              {(job?.timeline?.segments || []).slice(0, 8).map((segment) => (
                <li className="segment-item" key={segment.id}>
                  <p className="segment-meta">
                    {formatSeconds(segment.sourceStartSeconds)} to{" "}
                    {formatSeconds(segment.sourceEndSeconds)}
                  </p>
                  <p className="segment-text">{segment.text}</p>
                </li>
              ))}
              {!job?.timeline?.segments?.length ? (
                <li className="segment-item">
                  <p className="segment-text">No timeline data yet.</p>
                </li>
              ) : null}
            </ul>
          </article>

          <article className="detail-card">
            <h3>Captions</h3>
            <ul className="segment-list">
              {(job?.captions?.segments || []).slice(0, 8).map((caption, index) => (
                <li className="segment-item" key={`${caption.startSeconds}-${index}`}>
                  <p className="segment-meta">
                    {formatSeconds(caption.startSeconds)} to{" "}
                    {formatSeconds(caption.endSeconds)}
                  </p>
                  <p className="segment-text">{caption.text}</p>
                </li>
              ))}
              {!job?.captions?.segments?.length ? (
                <li className="segment-item">
                  <p className="segment-text">Caption chunks will appear after transcription.</p>
                </li>
              ) : null}
            </ul>
          </article>

          <article className="detail-card">
            <h3>B-roll plan</h3>
            <ul className="segment-list">
              {(job?.broll?.segments || []).slice(0, 8).map((segment) => (
                <li className="segment-item" key={segment.id}>
                  <p className="segment-meta">
                    {formatSeconds(segment.startSeconds)} to{" "}
                    {formatSeconds(segment.endSeconds)}
                  </p>
                  <p className="segment-text">
                    <strong>{segment.query}</strong>
                  </p>
                  <p className="segment-text">{segment.reason}</p>
                </li>
              ))}
              {!job?.broll?.segments?.length ? (
                <li className="segment-item">
                  <p className="segment-text">
                    Context-aware B-roll suggestions appear after transcript analysis.
                  </p>
                </li>
              ) : null}
            </ul>
          </article>
        </div>

        {downloadUrl ? (
          <div className="button-row">
            <a
              className="button button-primary download-link"
              href={downloadUrl}
              download
            >
              Download final video
            </a>
          </div>
        ) : null}
      </div>
    </section>
  );
}
