export function serializeJobForClient(job) {
  return {
    id: job.id,
    status: job.status,
    stage: job.stage,
    progress: job.progress,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    aspectRatio: job.aspectRatio,
    error: job.error,
    input: {
      originalFilename: job.input?.originalFilename || "",
      sizeBytes: job.input?.sizeBytes || 0,
      mimeType: job.input?.mimeType || ""
    },
    analysis: job.analysis,
    transcript: job.transcript,
    timeline: job.timeline,
    captions: {
      segments: job.captions?.segments || []
    },
    broll: {
      provider: job.broll?.provider || "",
      segments: (job.broll?.segments || []).map((segment) => ({
        id: segment.id,
        sourceSegmentId: segment.sourceSegmentId,
        query: segment.query,
        reason: segment.reason,
        startSeconds: segment.startSeconds,
        endSeconds: segment.endSeconds,
        asset: segment.asset
          ? {
              type: segment.asset.type,
              previewUrl: segment.asset.previewUrl,
              credit: segment.asset.credit
            }
          : null
      }))
    },
    output: {
      hasFinal: Boolean(job.output?.finalPath)
    }
  };
}
