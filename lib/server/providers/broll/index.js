import path from "node:path";
import { appConfig } from "../../../config.js";
import { fetchPexelsAsset } from "./pexels.js";

export async function fetchBrollAssets({
  jobDir,
  segments,
  aspectRatio,
  kind = "image"
}) {
  const assetsDir = path.join(jobDir, "assets");
  const provider = appConfig.defaultBrollProvider;

  const enrichedSegments = [];

  for (const segment of segments) {
    const asset =
      provider === "pexels"
        ? await fetchPexelsAsset({
            query: segment.query,
            kind,
            aspectRatio,
            assetsDir,
            assetId: segment.id
          })
        : null;

    enrichedSegments.push({
      ...segment,
      asset
    });
  }

  return {
    provider,
    segments: enrichedSegments
  };
}
