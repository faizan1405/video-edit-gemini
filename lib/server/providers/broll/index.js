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
          // GPT-provided rephrased backup query using different keywords
          alternativeQuery: segment.alternativeQuery,
          // Topic-map generic fallback when both GPT queries return 0 results
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
    } catch (err) {
      console.warn(
        `[broll] Asset fetch failed for "${segment.query}":`,
        err?.message || err
      );
    }

    if (asset) {
      enrichedSegments.push({ ...segment, asset });
    }
  }

  console.log(`[broll] Fetched ${enrichedSegments.length}/${segments.length} assets from ${provider}`);

  return {
    provider,
    segments: enrichedSegments
  };
}
