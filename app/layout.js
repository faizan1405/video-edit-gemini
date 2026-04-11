import "./globals.css";

export const metadata = {
  title: "AI Video Editor",
  description: "Upload a talking-head video, cut silence, add captions, place contextual B-roll, and render a finished short-form edit."
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
