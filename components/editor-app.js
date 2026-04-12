"use client";

import { useEffect, useMemo, useRef, useState } from "react";

// Format elapsed seconds as "MM:SS"
function formatElapsedTime(totalSeconds) {
  if (typeof totalSeconds !== "number" || Number.isNaN(totalSeconds) || totalSeconds < 0) {
    return "00:00";
  }
  const mins = Math.floor(totalSeconds / 60);
  const secs = Math.floor(totalSeconds % 60);
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

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

function formatTimestamp(seconds) {
  if (typeof seconds !== "number" || Number.isNaN(seconds)) return "0.00";
  return seconds.toFixed(2);
}

export default function EditorApp() {
  const [file, setFile] = useState(null);
  const [aspectRatio, setAspectRatio] = useState("9:16");
  const [captionLanguage, setCaptionLanguage] = useState("auto");
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [jobId, setJobId] = useState("");
  const [job, setJob] = useState(emptyJob);
  const [error, setError] = useState("");
  const pollRef = useRef(null);

  // Caption editing state
  const [editedCaptions, setEditedCaptions] = useState(null);
  const [captionsDirty, setCaptionsDirty] = useState(false);
  const [rerendering, setRerendering] = useState(false);
  const [rerenderError, setRerenderError] = useState("");

  // Timer — tracks current wall-clock time so elapsed can be recomputed every second
  const [now, setNow] = useState(() => Date.now());

  // Drive the live countdown while the job is actively processing
  useEffect(() => {
    const isActive = job?.status === "processing" && job?.processingStartedAt;
    if (!isActive) return undefined;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [job?.status, job?.processingStartedAt]);

  // Elapsed seconds — derived from reliable server timestamps.
  // While processing: distance from processingStartedAt to current wall-clock time.
  // When completed: distance from processingStartedAt to completedAt (exact, no drift).
  const elapsedSeconds = useMemo(() => {
    const startTs = job?.processingStartedAt
      ? new Date(job.processingStartedAt).getTime()
      : null;
    if (!startTs) return null;

    if (job?.status === "completed" && job?.completedAt) {
      return Math.max(0, (new Date(job.completedAt).getTime() - startTs) / 1000);
    }
    if (job?.status === "processing") {
      return Math.max(0, (now - startTs) / 1000);
    }
    return null;
  }, [job?.processingStartedAt, job?.completedAt, job?.status, now]);

  // Sync editedCaptions when job captions arrive or change
  useEffect(() => {
    if (job?.captions?.segments?.length && !captionsDirty) {
      setEditedCaptions(job.captions.segments.map((seg) => ({ ...seg })));
    }
  }, [job?.captions?.segments, captionsDirty]);

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
    setEditedCaptions(null);
    setCaptionsDirty(false);
    setRerenderError("");
    if (pollRef.current) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }
    setJobId("");

    const payload = new FormData();
    payload.append("video", file);
    payload.append("aspectRatio", aspectRatio);
    payload.append("captionLanguage", captionLanguage);

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
    setCaptionLanguage("auto");
    setUploadProgress(0);
    setUploading(false);
    setJobId("");
    setJob(emptyJob);
    setError("");
    setEditedCaptions(null);
    setCaptionsDirty(false);
    setRerenderError("");
  }

  function handleCaptionTextChange(index, newText) {
    setEditedCaptions((prev) => {
      const next = prev.map((seg, i) =>
        i === index ? { ...seg, text: newText } : seg
      );
      return next;
    });
    setCaptionsDirty(true);
  }

  async function handleApplyCaptionEdits() {
    if (!jobId || !editedCaptions) return;

    setRerendering(true);
    setRerenderError("");

    try {
      const response = await fetch(`/api/jobs/${jobId}/captions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ segments: editedCaptions })
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Re-render failed.");
      }

      const updatedJob = await response.json();
      setJob(updatedJob);
      setCaptionsDirty(false);
      // Force video to reload by briefly clearing jobId then restoring it
      // The video src uses jobId so we just force a re-fetch
      setJob((prev) => ({ ...prev, _reloadToken: Date.now() }));
    } catch (err) {
      setRerenderError(err.message);
    } finally {
      setRerendering(false);
    }
  }

  function handleDiscardCaptionEdits() {
    if (job?.captions?.segments) {
      setEditedCaptions(job.captions.segments.map((seg) => ({ ...seg })));
    }
    setCaptionsDirty(false);
    setRerenderError("");
  }

  // Include a cache-busting token so the browser re-fetches the file after
  // every caption re-render (the server always overwrites final-output.mp4).
  const reloadToken = job?._reloadToken || 1;
  const downloadUrl =
    jobId && job?.status === "completed"
      ? `/api/jobs/${jobId}/download?v=${reloadToken}`
      : null;

  const captionsToShow = editedCaptions || job?.captions?.segments || [];
  const isCompleted = job?.status === "completed";
  // True when the user explicitly disabled captions for this job
  const captionsDisabled =
    captionLanguage === "none" ||
    job?.captionLanguage === "none" ||
    job?.captions?.mode === "none";

  return (
    <section className="workspace">
      <form className="panel controls" onSubmit={handleSubmit}>
        <h2>Upload and process</h2>
        <p>
          Upload a video and the system will transcribe it, generate synced
          captions across the full duration, add context-aware B-roll, and
          produce a ready-to-download file. The original video length is always
          preserved.
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
          <label htmlFor="captionLanguage">Caption language</label>
          <select
            id="captionLanguage"
            value={captionLanguage}
            onChange={(event) => setCaptionLanguage(event.target.value)}
          >
            <option value="auto">Auto-detect</option>
            <option value="en">English</option>
            <option value="hi">Hindi (हिंदी)</option>
            <option value="hinglish">Hinglish (Hindi + English mix)</option>
            <option value="none">No Caption</option>
          </select>
          <p className="hint">
            {captionLanguage === "none"
              ? "No captions will be burned into the video."
              : "Selecting a language improves transcription accuracy and caption style."}
          </p>
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
              <video
                key={downloadUrl}
                src={downloadUrl}
                controls
                playsInline
                preload="metadata"
              />
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
              <p className="stat-label">Video Duration</p>
              <p className="stat-value">
                {formatSeconds(job?.analysis?.finalDurationSeconds || job?.analysis?.sourceDurationSeconds)}
              </p>
            </article>

            <article className="stat-card">
              <p className="stat-label">Captions</p>
              <p className="stat-value">
                {job?.captions?.mode === "none" || job?.captionLanguage === "none"
                  ? "Off"
                  : job?.captions?.segments?.length
                    ? `${job.captions.segments.length} lines`
                    : "—"}
              </p>
            </article>

            {elapsedSeconds !== null ? (
              <article className="stat-card">
                <p className="stat-label">
                  {job?.status === "completed" ? "Edit Duration" : "Editing Time"}
                </p>
                <p className="stat-value">{formatElapsedTime(elapsedSeconds)}</p>
              </article>
            ) : null}
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

          <article className="detail-card caption-editor-card">
            <div className="caption-card-header">
              <h3>Captions {captionsDirty ? <span className="dirty-badge">edited</span> : null}</h3>
              {isCompleted && captionsDirty && !captionsDisabled ? (
                <div className="caption-action-row">
                  <button
                    className="button button-primary caption-action-btn"
                    type="button"
                    onClick={handleApplyCaptionEdits}
                    disabled={rerendering}
                  >
                    {rerendering ? "Re-rendering..." : "Apply edits"}
                  </button>
                  <button
                    className="button button-secondary caption-action-btn"
                    type="button"
                    onClick={handleDiscardCaptionEdits}
                    disabled={rerendering}
                  >
                    Discard
                  </button>
                </div>
              ) : null}
            </div>

            {rerenderError ? (
              <div className="error-box" style={{ marginBottom: 10 }}>{rerenderError}</div>
            ) : null}

            {captionsDisabled ? (
              <ul className="segment-list">
                <li className="segment-item">
                  <p className="segment-text">Captions are disabled for this video.</p>
                </li>
              </ul>
            ) : (
              <>
                {isCompleted && captionsToShow.length ? (
                  <p className="hint" style={{ marginBottom: 8 }}>
                    Click any caption text to edit it. Changes apply after you click &ldquo;Apply edits&rdquo;.
                  </p>
                ) : null}

                <ul className="segment-list">
                  {captionsToShow.slice(0, 20).map((caption, index) => (
                    <li className="segment-item" key={`${caption.id || index}`}>
                      <p className="segment-meta">
                        {formatTimestamp(caption.startSeconds)}s &ndash;{" "}
                        {formatTimestamp(caption.endSeconds)}s
                      </p>
                      {isCompleted ? (
                        <textarea
                          className="caption-edit-input"
                          value={caption.text.replace(/\\N/g, "\n")}
                          onChange={(e) =>
                            handleCaptionTextChange(index, e.target.value.replace(/\n/g, "\\N"))
                          }
                          rows={caption.text.includes("\\N") ? 2 : 1}
                        />
                      ) : (
                        <p className="segment-text">{caption.text}</p>
                      )}
                    </li>
                  ))}
                  {captionsToShow.length > 20 ? (
                    <li className="segment-item">
                      <p className="segment-meta">
                        +{captionsToShow.length - 20} more captions (all included in final video)
                      </p>
                    </li>
                  ) : null}
                  {!captionsToShow.length ? (
                    <li className="segment-item">
                      <p className="segment-text">Caption chunks will appear after transcription.</p>
                    </li>
                  ) : null}
                </ul>
              </>
            )}
          </article>

          <article className="detail-card">
            <h3>B-roll plan</h3>
            <ul className="segment-list">
              {(job?.broll?.segments || []).slice(0, 10).map((segment) => (
                <li className="segment-item" key={segment.id}>
                  <p className="segment-meta">
                    {formatTimestamp(segment.startSeconds)}s &ndash;{" "}
                    {formatTimestamp(segment.endSeconds)}s
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
