// lib/server/processors/broll-animations.js
//
// B-roll animation preset library for FFmpeg-based rendering.
//
// Provides varied, premium-feeling entry animations for image and video
// B-roll assets in Instagram Reels / YouTube Shorts output.
//
// All animation is composed from two techniques:
//
//   1. ASSET STREAM FILTER — scale, crop, fade, colorchannelmixer
//      Applied to the looped/static asset input before it reaches the
//      overlay filter.  Controls zoom level, crop position, and alpha fade.
//
//   2. OVERLAY POSITION EXPRESSION — dynamic x/y on the overlay filter
//      Enables slide-in motion (up / left / right) using FFmpeg's built-in
//      expression evaluator.  Expressions reference `t`, which is the
//      absolute presentation timestamp shared across all filtergraph streams,
//      so slide timing aligns precisely with the B-roll enable window.
//
// No zoompan is used.  zoompan requires a fixed frame-count (d=) parameter
// that interacts poorly with long looped inputs and causes render stalls
// when the asset stream runs out of frames before the main video ends.

import { appConfig } from "../../config.js";

// Round up to the nearest even integer (required by libx264 for width/height).
function toEvenCeil(n) {
  const v = Math.ceil(n);
  return v % 2 === 0 ? v : v + 1;
}

function fmt(v) {
  return Number(v).toFixed(3);
}

// ── Preset catalogue ──────────────────────────────────────────────────────────
//
// Each entry defines the visual treatment for one B-roll segment.
//
//   zoom      — scale multiplier for overcrop
//               number  → literal value (1.0 = no zoom)
//               string  → key that resolves to an appConfig property at render time
//   cropDir   — which portion of the zoomed image to keep
//               "center" (default)  |  "left"  |  "right"
//   slide     — false  |  "up"  |  "left"  |  "right"
//   imageOnly — when true, the preset is excluded from the video asset pool
//
// ─────────────────────────────────────────────────────────────────────────────

const PRESETS = {
  // Pure fade — safe for any content, used as a tasteful fallback
  "fade": {
    zoom: 1.0, cropDir: "center", slide: false, imageOnly: false,
  },

  // Subtle zoom-in crop + fade — current default, clean and modern
  "zoom-fade": {
    zoom: "zoomStrength", cropDir: "center", slide: false, imageOnly: false,
  },

  // Slightly more pronounced zoom + fade — adds a soft "punch-in" feel
  "scale-fade": {
    zoom: "scaleFade", cropDir: "center", slide: false, imageOnly: false,
  },

  // Slide entries — the overlay position animates from off-screen to 0 over
  // brollSlideEntryDuration seconds; alpha fade fires simultaneously
  "slide-up": {
    zoom: 1.0, cropDir: "center", slide: "up", imageOnly: false,
  },
  "slide-left": {
    zoom: 1.0, cropDir: "center", slide: "left", imageOnly: false,
  },
  "slide-right": {
    zoom: 1.0, cropDir: "center", slide: "right", imageOnly: false,
  },

  // Ken Burns variants — wider zoom crop from a directional offset so the
  // composition feels intentionally framed, not just center-zoomed
  "kenburns-r": {
    zoom: "kenburns", cropDir: "left",  slide: false, imageOnly: true,
  },
  "kenburns-l": {
    zoom: "kenburns", cropDir: "right", slide: false, imageOnly: true,
  },
};

// Rotation pools — order determines how presets cycle across segments.
// High-impact presets are placed first to appear more frequently.
const IMAGE_POOL = [
  "zoom-fade",
  "slide-up",
  "slide-left",
  "kenburns-r",
  "scale-fade",
  "slide-right",
  "kenburns-l",
  "fade",
];

const VIDEO_POOL = [
  "fade",
  "zoom-fade",
  "slide-up",
  "slide-left",
];

// ── Preset selection ──────────────────────────────────────────────────────────

/**
 * Choose an animation preset for a B-roll segment.
 *
 * When randomization is enabled (default), the function rotates through the
 * pool using the segment index as an offset, after filtering out any preset
 * that appeared in the last `brollAnimationMaxRepeat` segments.  Using the
 * index — rather than Math.random() — keeps the output reproducible: the same
 * video with the same B-roll plan always produces the same preset sequence.
 *
 * When randomization is disabled, a safe static default is returned.
 *
 * @param {string}   assetType   "image" | "video"
 * @param {string[]} usedPresets ordered list of presets already chosen this render
 * @param {number}   index       0-based segment index
 * @returns {string} preset name
 */
export function selectAnimationPreset(assetType, usedPresets, index) {
  if (!appConfig.brollAnimationRandomize) {
    return assetType === "image" ? "zoom-fade" : "fade";
  }

  const pool      = assetType === "image" ? IMAGE_POOL : VIDEO_POOL;
  const maxRepeat = Math.max(1, appConfig.brollAnimationMaxRepeat);

  // Exclude presets that appeared in the last maxRepeat positions
  const recentSet  = new Set(usedPresets.slice(-maxRepeat));
  const candidates = pool.filter((p) => !recentSet.has(p));

  // If every candidate was recently used (small pool), fall back to full pool
  const available = candidates.length > 0 ? candidates : pool;

  return available[index % available.length];
}

// ── Asset stream filter ───────────────────────────────────────────────────────

/**
 * Build the FFmpeg filter chain for the B-roll asset input stream.
 *
 * Returns the complete filter string that goes between `[inputN:v]` and
 * the output label `[assetN]` — ready to be inserted into a filter_complex.
 *
 * The returned string handles:
 *   - Scaling to the canvas (with optional zoom overcrop)
 *   - Directional or center crop back to canvas size
 *   - SAR normalisation + RGBA conversion
 *   - Image opacity tweak (colorchannelmixer)
 *   - Entry fade-in and exit fade-out (alpha channel, clamped for short clips)
 *
 * @param {{
 *   preset:         string,
 *   assetType:      "image" | "video",
 *   width:          number,   canvas pixel width
 *   height:         number,   canvas pixel height
 *   segment:        { startSeconds: number, endSeconds: number },
 *   fadeInSecs:     number,
 *   fadeOutSecs:    number,
 *   useTransitions: boolean,
 * }} params
 * @returns {string}
 */
export function buildAssetFilter({
  preset,
  assetType,
  width,
  height,
  segment,
  fadeInSecs,
  fadeOutSecs,
  useTransitions,
}) {
  const def = PRESETS[preset] ?? PRESETS["zoom-fade"];

  // ── Zoom strength ──────────────────────────────────────────────────────────
  let zoomVal = def.zoom;
  if (typeof zoomVal === "string") {
    switch (zoomVal) {
      case "zoomStrength": zoomVal = appConfig.brollZoomStrength;      break;
      case "scaleFade":    zoomVal = appConfig.brollScaleFadeStrength; break;
      case "kenburns":     zoomVal = appConfig.brollKenburnsStrength;  break;
      default:             zoomVal = 1.0;
    }
  }

  const applyZoom = useTransitions && zoomVal > 1.0;
  const scaledW   = applyZoom ? toEvenCeil(width  * zoomVal) : width;
  const scaledH   = applyZoom ? toEvenCeil(height * zoomVal) : height;

  // ── Scale filter ───────────────────────────────────────────────────────────
  // force_original_aspect_ratio=increase ensures the image covers the canvas
  // even when the source aspect ratio differs from the target.
  const scaleStr = `scale=${scaledW}:${scaledH}:force_original_aspect_ratio=increase`;

  // ── Crop filter ────────────────────────────────────────────────────────────
  // iw / ih are the actual post-scale dimensions, which may exceed scaledW ×
  // scaledH when the source has a different aspect ratio.  Using iw/ih in the
  // crop x/y expressions keeps this correct regardless of source format.
  let cropStr;
  if (!applyZoom || def.cropDir === "center") {
    // Default FFmpeg centre-crop behaviour
    cropStr = `crop=${width}:${height}`;
  } else if (def.cropDir === "left") {
    // Keep the leftmost portion — different composition from the centre crop
    cropStr = `crop=${width}:${height}:0:(ih-${height})/2`;
  } else {
    // "right" — keep the rightmost portion
    cropStr = `crop=${width}:${height}:iw-${width}:(ih-${height})/2`;
  }

  // ── Fade timings ───────────────────────────────────────────────────────────
  const segDur      = segment.endSeconds - segment.startSeconds;
  const maxFadeEach = Math.max(0, (segDur - 0.1) / 2);
  const fi          = Math.min(fadeInSecs,  maxFadeEach);
  const fo          = Math.min(fadeOutSecs, maxFadeEach);
  const fadeInSt    = fmt(segment.startSeconds);
  const fadeOutSt   = fmt(Math.max(segment.startSeconds + fi, segment.endSeconds - fo - 0.05));

  const fadeStr =
    useTransitions && fi > 0
      ? `,fade=type=in:st=${fadeInSt}:d=${fi.toFixed(3)}:alpha=1` +
        `,fade=type=out:st=${fadeOutSt}:d=${fo.toFixed(3)}:alpha=1`
      : "";

  // Image-specific: 2% transparency gives a subtle overlay feel and signals
  // to the viewer that the original speaker video is underneath.
  const opacityStr = assetType === "image" ? ",colorchannelmixer=aa=0.98" : "";

  return `${scaleStr},${cropStr},setsar=1,format=rgba${opacityStr}${fadeStr}`;
}

// ── Overlay position expressions ──────────────────────────────────────────────

/**
 * Return { x, y } expression strings for the FFmpeg overlay filter.
 *
 * For slide presets the expressions animate the B-roll from off-screen into
 * position over `brollSlideEntryDuration` seconds.  They reference `t` (the
 * absolute video PTS) and use FFmpeg overlay variables `W` (main width) and
 * `H` (main height), so no hard-coded pixel values are needed.
 *
 * For non-slide presets both expressions are the static string "0".
 *
 * The `enable='between(t,start,end)'` guard on the overlay filter means that
 * evaluations of these expressions outside the active window are harmless —
 * the resulting frame is simply discarded.
 *
 * @param {{
 *   preset:         string,
 *   segment:        { startSeconds: number },
 *   useTransitions: boolean,
 * }} params
 * @returns {{ x: string, y: string }}
 */
export function buildOverlayPosition({ preset, segment, useTransitions }) {
  const def = PRESETS[preset] ?? PRESETS["zoom-fade"];

  if (!useTransitions || !def.slide) {
    return { x: "0", y: "0" };
  }

  const dur   = appConfig.brollSlideEntryDuration;
  const start = fmt(segment.startSeconds);

  // FFmpeg overlay variables used in expressions:
  //   t  — current output PTS in seconds (== absolute video time)
  //   W  — width  of the main (background) input
  //   H  — height of the main (background) input

  switch (def.slide) {
    case "up":
      // Enters from the bottom edge — y goes from H down to 0
      return {
        x: "0",
        y: `if(lt(t-${start},${dur}),H*(1-(t-${start})/${dur}),0)`,
      };

    case "left":
      // Enters from the right edge — x goes from W across to 0
      return {
        x: `if(lt(t-${start},${dur}),W*(1-(t-${start})/${dur}),0)`,
        y: "0",
      };

    case "right":
      // Enters from the left edge — x goes from −W across to 0
      return {
        x: `if(lt(t-${start},${dur}),-W*(1-(t-${start})/${dur}),0)`,
        y: "0",
      };

    default:
      return { x: "0", y: "0" };
  }
}
