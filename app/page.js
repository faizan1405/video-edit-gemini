import EditorApp from "@/components/editor-app";

export default function HomePage() {
  return (
    <main className="page-shell">
      <section className="hero">
        <div>
          <p className="eyebrow">Real pipeline, local jobs, rendered output</p>
          <h1>AI video editing for short-form talking videos</h1>
          <p className="hero-copy">
            Upload a raw clip, then let the app transcribe it, generate synced
            captions, add context-aware B-roll with smooth animations, and render
            a polished downloadable export.
          </p>
        </div>
      </section>
      <EditorApp />
    </main>
  );
}
