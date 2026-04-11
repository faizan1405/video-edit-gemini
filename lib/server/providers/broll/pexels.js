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

export async function fetchPexelsAsset({
  query,
  kind = "image",
  aspectRatio = "9:16",
  assetsDir,
  assetId
}) {
  await ensureDir(assetsDir);

  if (kind === "video") {
    const orientation = aspectRatio === "16:9" ? "landscape" : "portrait";
    const payload = await pexelsRequest(
      `https://api.pexels.com/videos/search?query=${encodeURIComponent(
        query
      )}&orientation=${orientation}&per_page=1`
    );
    const video = payload.videos?.[0];

    if (!video) {
      throw new Error(`No Pexels video found for "${query}"`);
    }

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

  const orientation = aspectRatio === "16:9" ? "landscape" : "portrait";
  const payload = await pexelsRequest(
    `https://api.pexels.com/v1/search?query=${encodeURIComponent(
      query
    )}&orientation=${orientation}&per_page=1`
  );
  const photo = payload.photos?.[0];

  if (!photo) {
    throw new Error(`No Pexels photo found for "${query}"`);
  }

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
