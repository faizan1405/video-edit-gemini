import EditorApp from "@/components/editor-app";

export default function HomePage() {
  return (
    <main className="page-shell">
      <header className="top-bar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 3l14 9-14 9V3z" />
            </svg>
          </span>
          <div className="brand-text">
            <span className="brand-name">Lumen</span>
            <span className="brand-sub">AI Video Studio</span>
          </div>
        </div>
        <div className="top-meta">
          <span className="status-dot" aria-hidden="true" />
          <span>Pipeline online</span>
        </div>
      </header>

      <section className="hero">
        <span className="eyebrow">
          <span className="eyebrow-dot" aria-hidden="true" />
          Real pipeline · local jobs · rendered output
        </span>
        <h1>
          AI video editing,
          <br />
          <span className="hero-gradient">engineered for short-form.</span>
        </h1>
        <p className="hero-copy">
          Upload a raw clip and let the studio transcribe it, generate synced
          captions, place context-aware B-roll, and render a polished,
          downloadable export — without trimming a single frame.
        </p>
        <ul className="hero-chips" aria-label="Capabilities">
          <li className="hero-chip">Whisper-grade transcription</li>
          <li className="hero-chip">Frame-accurate captions</li>
          <li className="hero-chip">Context-aware B-roll</li>
          <li className="hero-chip">One-click render</li>
        </ul>
      </section>

      <EditorApp />

      <footer className="page-footer">
        <span>Crafted for creators · Full duration preserved · Local render</span>
      </footer>
    </main>
  );
}
