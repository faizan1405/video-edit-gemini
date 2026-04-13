import path from "node:path";
import { appConfig } from "../../../config.js";
import { fetchPexelsAsset } from "./pexels.js";

/**
 * Build a simplified retry query from the original by extracting
 * the most concrete nouns/adjectives (longer words tend to be more specific).
 */
function buildRetryQuery(originalQuery) {
  const words = originalQuery
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(w => w.length > 3);
  const unique = [...new Set(words)];
  if (unique.length >= 3) return unique.slice(0, 3).join(" ") + " scene";
  if (unique.length >= 1) return unique.join(" ") + " person scene";
  return "professional person workplace";
}

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
          alternativeQuery: segment.alternativeQuery,
          fallbackQuery: segment.fallbackQuery,
          kind,
          aspectRatio,
          assetsDir,
          assetId: segment.id,
          resultIndex: segmentIndex
        });
      }
    } catch (err) {
      console.warn(
        `[broll] Asset fetch failed for "${segment.query}":`,
        err?.message || err
      );

      // Retry with a simplified query derived from the original
      if (provider === "pexels") {
        try {
          const retryQuery = buildRetryQuery(segment.query);
          console.log(`[broll] Retrying with simplified query: "${retryQuery}"`);
          asset = await fetchPexelsAsset({
            query: retryQuery,
            kind,
            aspectRatio,
            assetsDir,
            assetId: segment.id,
            resultIndex: segmentIndex + 1
          });
        } catch (retryErr) {
          console.warn(
            `[broll] Retry also failed for "${segment.query}":`,
            retryErr?.message || retryErr
          );
        }
      }
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
