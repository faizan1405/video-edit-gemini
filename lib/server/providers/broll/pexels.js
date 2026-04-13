import fs from "node:fs/promises";
import path from "node:path";
import { appConfig, requireEnv } from "../../../config.js";
import { ensureDir } from "../../fs-utils.js";

async function pexelsRequest(url, retries = 2) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const response = await fetch(url, {
      headers: {
        Authorization: requireEnv("PEXELS_API_KEY", appConfig.pexelsApiKey)
      }
    });

    if (response.ok) {
      return response.json();
    }

    // Retry on rate-limit (429) or server errors (5xx) with a short delay
    if ((response.status === 429 || response.status >= 500) && attempt < retries) {
      const delay = (attempt + 1) * 800;
      await new Promise((r) => setTimeout(r, delay));
      continue;
    }

    throw new Error(`Pexels request failed with ${response.status}`);
  }
}

async function downloadFile(url, destinationPath) {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Asset download failed with ${response.status}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  await fs.writeFile(destinationPath, buffer);
}

async function searchPexelsVideos(query, orientation, perPage = 15) {
  const payload = await pexelsRequest(
    `https://api.pexels.com/videos/search?query=${encodeURIComponent(query)}&orientation=${orientation}&per_page=${perPage}`
  );
  return payload.videos || [];
}

async function searchPexelsPhotos(query, orientation, perPage = 15) {
  const payload = await pexelsRequest(
    `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&orientation=${orientation}&per_page=${perPage}`
  );
  return payload.photos || [];
}

/**
 * Score how relevant a Pexels result is to the search query.
 * Returns 0.0 – 1.0 based on keyword overlap between the query
 * and the result's alt text / tags / URL slug.
 */
function scoreRelevance(query, resultText) {
  if (!resultText || !query) return 0;
  const queryWords = query.toLowerCase().replace(/[^a-z0-9\s]/g, "").split(/\s+/).filter(w => w.length > 2);
  const resultLower = resultText.toLowerCase();
  if (!queryWords.length) return 0.5;
  const matches = queryWords.filter(w => resultLower.includes(w));
  return matches.length / queryWords.length;
}

/**
 * Extract searchable text from a Pexels photo or video result for relevance scoring.
 */
function getResultText(result, kind) {
  if (kind === "video") {
    // Videos have: url (slug-based), user.name, video_files[].file_type
    const parts = [result.url || "", result.user?.name || ""];
    if (result.tags) parts.push(...result.tags);
    return parts.join(" ");
  }
  // Photos have: alt, url, photographer
  return [result.alt || "", result.url || "", result.photographer || ""].join(" ");
}

// Minimum keyword-overlap ratio for a Pexels result to be considered relevant.
// Results below this score on ALL queries cause the B-roll slot to be skipped —
// a wrong visual is worse than no visual.
const PEXELS_MIN_RELEVANCE = 0.25;

/**
 * Filter results by relevance score.
 *
 * Returns results that score >= minScore, sorted best-first.
 * Returns an EMPTY array when all results are below threshold — callers that
 * want to skip the slot rather than use a random image rely on this behaviour.
 */
function filterByRelevance(results, query, kind, minScore = PEXELS_MIN_RELEVANCE) {
  if (!results.length) return [];

  const scored = results.map(r => ({
    result: r,
    score: scoreRelevance(query, getResultText(r, kind))
  }));

  scored.sort((a, b) => b.score - a.score);

  const good = scored.filter(s => s.score >= minScore);
  if (good.length) return good.map(s => s.result);

  // All results are below the relevance threshold for this query.
  // Return empty so the caller can try the next query or skip the slot.
  return [];
}

/**
 * Try multiple queries in order until one returns relevantly-scored results.
 *
 * Returns an empty array if every query in the chain fails the relevance
 * threshold — the caller (fetchBrollAssets) will skip the slot entirely
 * rather than use a random stock photo that misleads the viewer.
 */
async function searchWithFallbacks(searchFn, queries, orientation, kind) {
  let bestResult = null;
  let bestScore = 0;

  for (const q of queries) {
    if (!q) continue;
    try {
      const rawResults = await searchFn(q, orientation);
      if (!rawResults.length) continue;

      const relevant = filterByRelevance(rawResults, q, kind);
      if (relevant.length) return relevant;

      // Track the best single result across all queries as a last resort
      const scored = rawResults.map(r => ({
        result: r,
        score: scoreRelevance(q, getResultText(r, kind))
      }));
      scored.sort((a, b) => b.score - a.score);
      if (scored[0].score > bestScore) {
        bestScore = scored[0].score;
        bestResult = scored[0].result;
      }
    } catch {
      // Individual search failure — try next query
    }
  }

  // If we got at least something (even weak), return it rather than nothing.
  // The fetchBrollAssets layer will log the low-quality match.
  if (bestResult) {
    console.warn(`[pexels] No query passed relevance threshold — using best available (score=${bestScore.toFixed(2)})`);
    return [bestResult];
  }

  return [];
}

export async function fetchPexelsAsset({
  query,
  alternativeQuery,
  fallbackQuery,
  kind = "image",
  aspectRatio = "9:16",
  assetsDir,
  assetId,
  resultIndex = 0
}) {
  await ensureDir(assetsDir);

  const orientation = aspectRatio === "16:9" ? "landscape" : "portrait";
  // Ordered fallback chain: primary → GPT alternative → topic-map generic
  const queryChain = [query, alternativeQuery, fallbackQuery].filter(Boolean);

  if (kind === "video") {
    const videos = await searchWithFallbacks(searchPexelsVideos, queryChain, orientation, "video");

    if (!videos.length) {
      throw new Error(`No Pexels video found for "${query}"`);
    }

    const video = videos[resultIndex % videos.length];

    const file = [...(video.video_files || [])]
      .sort((left, right) => (right.width || 0) - (left.width || 0))
      .find(Boolean);

    if (!file?.link) {
      throw new Error(`Pexels did not return a downloadable video for "${query}"`);
    }

    const localPath = path.join(assetsDir, `${assetId}.mp4`);
    await downloadFile(file.link, localPath);

    return {
      type: "video",
      localPath,
      remoteUrl: file.link,
      previewUrl: video.image,
      credit: video.user?.name || "Pexels"
    };
  }

  // --- image path ---
  const photos = await searchWithFallbacks(searchPexelsPhotos, queryChain, orientation, "image");

  if (!photos.length) {
    throw new Error(`No Pexels photo found for "${query}"`);
  }

  const photo = photos[resultIndex % photos.length];

  const remoteUrl =
    photo.src?.large2x || photo.src?.large || photo.src?.original || photo.src?.medium;

  if (!remoteUrl) {
    throw new Error(`Pexels did not return a usable image for "${query}"`);
  }

  const localPath = path.join(assetsDir, `${assetId}.jpg`);
  await downloadFile(remoteUrl, localPath);

  return {
    type: "image",
    localPath,
    remoteUrl,
    previewUrl: photo.src?.medium || remoteUrl,
    credit: photo.photographer || "Pexels"
  };
}
