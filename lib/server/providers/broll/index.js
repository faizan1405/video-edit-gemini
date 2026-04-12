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

  for (const [segmentIndex, segment] of segments.entries()) {
    let asset = null;

    try {
      if (provider === "pexels") {
        asset = await fetchPexelsAsset({
          query: segment.query,
          // Generic fallback used when the India-specific query returns 0 results.
          fallbackQuery: segment.fallbackQuery,
          kind,
          aspectRatio,
          assetsDir,
          assetId: segment.id,
          // Rotate result offset per slot so the same query returns different
          // images for different B-roll moments rather than repeating the first.
          resultIndex: segmentIndex
        });
      }
    } catch {
      // Single segment fetch failure — skip this B-roll slot rather than
      // aborting the entire job.  The renderer already handles missing assets.
    }

    if (asset) {
      enrichedSegments.push({ ...segment, asset });
    }
  }

  return {
    provider,
    segments: enrichedSegments
  };
}
