import fs from "node:fs/promises";
import path from "node:path";
import { appConfig, requireEnv } from "../../../config.js";
import { ensureDir } from "../../fs-utils.js";

async function pexelsRequest(url) {
  const response = await fetch(url, {
    headers: {
      Authorization: requireEnv("PEXELS_API_KEY", appConfig.pexelsApiKey)
    }
  });

  if (!response.ok) {
    throw new Error(`Pexels request failed with ${response.status}`);
  }

  return response.json();
}

async function downloadFile(url, destinationPath) {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Asset download failed with ${response.status}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  await fs.writeFile(destinationPath, buffer);
}

async function searchPexelsVideos(query, orientation, perPage = 5) {
  const payload = await pexelsRequest(
    `https://api.pexels.com/videos/search?query=${encodeURIComponent(query)}&orientation=${orientation}&per_page=${perPage}`
  );
  return payload.videos || [];
}

async function searchPexelsPhotos(query, orientation, perPage = 5) {
  const payload = await pexelsRequest(
    `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&orientation=${orientation}&per_page=${perPage}`
  );
  return payload.photos || [];
}

export async function fetchPexelsAsset({
  query,
  fallbackQuery,
  kind = "image",
  aspectRatio = "9:16",
  assetsDir,
  assetId,
  resultIndex = 0
}) {
  await ensureDir(assetsDir);

  const orientation = aspectRatio === "16:9" ? "landscape" : "portrait";

  if (kind === "video") {
    let videos = await searchPexelsVideos(query, orientation);

    // If the India-specific query returned nothing, retry with the generic fallback.
    if (!videos.length && fallbackQuery && fallbackQuery !== query) {
      videos = await searchPexelsVideos(fallbackQuery, orientation);
    }

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
  let photos = await searchPexelsPhotos(query, orientation);

  // If the India-specific query returned nothing, retry with the generic fallback.
  if (!photos.length && fallbackQuery && fallbackQuery !== query) {
    photos = await searchPexelsPhotos(fallbackQuery, orientation);
  }

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
