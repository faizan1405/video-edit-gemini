# AI Video Editor

A real Next.js web app for short-form AI video editing. It accepts a talking-head upload, transcribes the spoken audio, removes dead space, builds readable burned-in captions, fetches context-aware B-roll, and renders a final downloadable MP4.

## What version 1 does

- Upload MP4, MOV, or WEBM files with real progress reporting
- Save jobs locally and process them asynchronously in a detached worker
- Extract audio with FFmpeg
- Transcribe speech with timestamped words through OpenAI transcription
- Detect silence and long pauses
- Build a smart-cut timeline that removes awkward dead space while keeping natural timing
- Generate short caption chunks and burn them into the output video
- Choose a handful of useful B-roll moments from the transcript
- Fetch matching stock images from Pexels
- Render a final video with:
  - cleaned cuts
  - burned captions
  - contextual B-roll overlays
  - speaker picture-in-picture during B-roll moments

## Stack

- Frontend: Next.js App Router + React
- Upload API: Next.js API routes using `formidable`
- Background jobs: detached Node worker process
- Media processing: `ffmpeg-static` and `ffprobe-static`
- Transcription and semantic analysis: OpenAI API
- B-roll provider: Pexels API
- Storage: local filesystem in `data/jobs`

## Installation

PowerShell on this machine blocks `npm.ps1`, so use `npm.cmd`.

```powershell
copy .env.example .env
npm.cmd install
npm.cmd run dev
```

Open `http://localhost:3000`.

## Required environment variables

```env
OPENAI_API_KEY=your_openai_key
OPENAI_TRANSCRIPTION_MODEL=whisper-1
OPENAI_TEXT_MODEL=gpt-4o-mini
PEXELS_API_KEY=your_pexels_key
MAX_UPLOAD_MB=500
MAX_BROLL_SLOTS=5
DEFAULT_BROLL_PROVIDER=pexels
```

## Processing pipeline

1. User uploads a raw video to `POST /api/jobs`.
2. The API stores the file under `data/jobs/<jobId>/input.*`.
3. A detached worker starts `scripts/process-job.mjs <jobId>`.
4. The worker:
   - inspects the source video
   - extracts mono speech audio
   - transcribes it with word timestamps
   - detects silence with FFmpeg `silencedetect`
   - builds a smart-cut timeline
   - generates caption chunks and writes `captions.ass` and `captions.srt`
   - selects B-roll moments from transcript meaning
   - downloads matching stock assets
   - renders cut segments
   - overlays B-roll
   - burns captions
   - stores the final MP4 path in the job record
5. The UI polls `GET /api/jobs/:jobId` until completion.
6. The final video streams from `GET /api/jobs/:jobId/download`.

## B-roll architecture

Version 1 uses images, but the provider and renderer are already structured to support video later:

- Provider contract lives in `lib/server/providers/broll/index.js`
- Pexels implementation supports both `image` and `video` asset lookup
- The renderer already branches on `asset.type`

To move to video B-roll later, change the fetch call inside `process-job.js` from `kind: "image"` to `kind: "video"` after testing the source clips you want to use.

## Output behavior

- Vertical output defaults to `1080x1920`
- Landscape output is available as `1920x1080`
- Main speaker stays visible most of the time
- During B-roll moments, the B-roll fills the frame and the speaker stays visible as picture-in-picture
- Captions are burned into the video using ASS subtitles for readable styling

## Important operational notes

- This app is built for self-hosted local or VM/server use, not serverless deployment.
- OpenAI and Pexels keys are required for a full successful run.
- `ffmpeg-static` packages the binary, so no separate FFmpeg install is required once dependencies are installed.
- If your FFmpeg build lacks subtitle support, the final caption burn step will fail. The bundled static build usually includes it.
- Very long videos will take longer because the worker renders each keep segment before concatenation.

## File layout

- `app/` UI shell
- `components/editor-app.js` upload, polling, preview, and job detail UI
- `pages/api/jobs/` upload, status, and download endpoints
- `lib/server/process-job.js` end-to-end processing orchestrator
- `lib/server/processors/` transcription, silence analysis, timeline, captions, and rendering logic
- `lib/server/providers/broll/` stock media integration
- `scripts/process-job.mjs` worker entry point

## Next upgrades

- Add user-uploaded custom B-roll and brand assets
- Add real timeline review and manual overrides before render
- Add background queue persistence with Redis or a DB
- Add waveform preview and cut approval
- Switch image B-roll to stock video on selected segments
- Add multi-language caption styling and templates
