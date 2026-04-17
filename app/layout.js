import { Inter, Space_Grotesk, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-sans",
  weight: ["400", "500", "600", "700", "800"]
});

const display = Space_Grotesk({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-display",
  weight: ["500", "600", "700"]
});

const mono = JetBrains_Mono({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-mono",
  weight: ["400", "500"]
});

export const metadata = {
  title: "AI Video Editor",
  description:
    "Upload a talking-head video, cut silence, add captions, place contextual B-roll, and render a finished short-form edit."
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={`${inter.variable} ${display.variable} ${mono.variable}`}>
      <body>
        <div className="aurora" aria-hidden="true">
          <span className="aurora-orb aurora-orb-1" />
          <span className="aurora-orb aurora-orb-2" />
          <span className="aurora-orb aurora-orb-3" />
          <span className="aurora-grid" />
        </div>
        {children}
      </body>
    </html>
  );
}
