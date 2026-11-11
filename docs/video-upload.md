# Video preparation

Instructor videos are prepared in a dedicated browser worker before upload. The
input cap remains 52,428,800 bytes. The accepted inputs are MOV, MP4 and WebM.
The upload/storage path receives MP4, not the source MOV, so production storage
MIME settings and limits do not need to change.

The processor is loaded only when a video is selected. FFmpeg 0.12.15 and the
single-thread core 0.12.10 are pinned. `prepare-video-processor.mjs` copies
the versioned MIT wrapper during development/build. The core is loaded directly
from the pinned jsDelivr npm package, following the upstream loading pattern.
No user video is sent to the CDN. Its availability is required on first load; a
network failure leaves the current profile unchanged and offers a retry. Single-thread processing avoids a
SharedArrayBuffer or cross-origin-isolation requirement on GitHub Pages.

Output uses H.264 video, optional AAC stereo audio, 8-bit YUV420, at most 1280
pixels on either side, 30 fps, and MP4 fast-start. HDR HLG/PQ is tone-mapped to
SDR after downscaling. Encoding uses a size-aware bitrate budget; output is
checked again against the unchanged cap. Duration is never truncated. Videos
without duration metadata are allowed and checked after conversion.

Cancellation terminates the worker and avoids starting an upload. Navigating
away stops later files in a batch. An upload already in flight finishes its
metadata bookkeeping. Replacing a welcome video uploads/prepares the new file
and verifies its row update before removing the old stored file.

## Validation

- `npm run test:video` covers input types, size boundary, abort/error cleanup,
  output type/cap, HDR parameters, durationless WebM, and replacement ordering.
- Actual WebAssembly codec tests use synthetic MOV/HEVC, HDR MOV, and VP9 WebM.
- Chrome on Mac Mini verified real worker loading, conversion/playback,
  cancellation, invalid input, size rejection and retry with synthetic videos.
  Physical iPhone performance remains unverified. Node codec tests alone are
  not browser tests.
- The MIT wrapper license is retained in `public/notices`. The GPL-licensed
  core is obtained directly from its package CDN, not copied into the site's
  release artifact. Upstream source: https://github.com/ffmpegwasm/ffmpeg.wasm.
