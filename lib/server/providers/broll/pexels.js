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

async function searchPexelsVideos(query, orientation, perPage = 12) {
  const payload = await pexelsRequest(
    `https://api.pexels.com/videos/search?query=${encodeURIComponent(query)}&orientation=${orientation}&per_page=${perPage}`
  );
  return payload.videos || [];
}

async function searchPexelsPhotos(query, orientation, perPage = 12) {
  const payload = await pexelsRequest(
    `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&orientation=${orientation}&per_page=${perPage}`
  );
  return payload.photos || [];
}

// Try multiple queries in order until one returns results.
// Returns the first non-empty result array, or an empty array if all fail.
async function searchWithFallbacks(searchFn, queries, orientation) {
  for (const q of queries) {
    if (!q) continue;
    try {
      const results = await searchFn(q, orientation);
      if (results.length) return results;
    } catch {
      // Individual search failure — try next query
    }
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
    const videos = await searchWithFallbacks(searchPexelsVideos, queryChain, orientation);

    if (!videos.length) {
      throw new Error(`No Pexels video found for "${query}"`);
    }

    // Rotate through available results so multiple B-roll slots with the same
    // query receive visually distinct clips rather than all reusing the first.
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
  const photos = await searchWithFallbacks(searchPexelsPhotos, queryChain, orientation);

  if (!photos.length) {
    throw new Error(`No Pexels photo found for "${query}"`);
  }

  // Rotate through available results for visual variety across B-roll slots.
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
