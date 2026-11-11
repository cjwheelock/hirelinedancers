export const MAX_VIDEO_BYTES = 50 * 1024 * 1024;
export const VIDEO_ACCEPT = '.mov,.mp4,.webm,video/quicktime,video/mp4,video/webm';
const mimeTypes = ['video/quicktime', 'video/mp4', 'video/webm'];

export function isVideoFile(file: Pick<File, 'name' | 'type'>) {
  return mimeTypes.includes(file.type) || ((!file.type || file.type === 'application/octet-stream') && /\.(mov|mp4|webm)$/i.test(file.name));
}

export function videoSizeError(name: string) {
  return `${name} is larger than 50 MB. Quickly edit and shorten it on your phone, then try again.`;
}

export type VideoStream = { codec_type?: string; color_transfer?: string; duration?: string };
export type VideoProbe = { streams?: VideoStream[]; format?: { duration?: string } };
export type VideoProgress = { stage: 'loading' | 'converting'; percent: number | null };

export function conversionArguments(probe: VideoProbe, inputBytes: number) {
  const stream = probe.streams?.find((item) => item.codec_type === 'video');
  const duration = Number(probe.format?.duration || stream?.duration);
  if (!stream) throw new Error('This video could not be read. Try exporting another copy from your phone.');
  const hdr = stream.color_transfer === 'smpte2084' || stream.color_transfer === 'arib-std-b67';
  const toneMap = hdr ? 'zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv,' : '';
  // Leave room for audio and the MP4 container. Preserve the complete clip.
  const budget = Math.min(inputBytes * 0.9, 45 * 1024 * 1024);
  const bitrate = Number.isFinite(duration) && duration > 0
    ? Math.min(2_500_000, Math.max(64_000, Math.floor(budget * 8 / duration) - 96_000))
    : 2_500_000;
  return ['-i', 'input', '-map', '0:v:0', '-map', '0:a:0?', '-sn', '-dn',
    '-vf', `scale=w='min(1280,iw)':h='min(1280,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2,${toneMap}setsar=1,fps=30,format=yuv420p`,
    '-c:v', 'libx264', '-preset', 'veryfast', '-b:v', String(bitrate), '-maxrate', String(bitrate), '-bufsize', String(bitrate * 2),
    '-c:a', 'aac', '-b:a', '96k', '-ac', '2', '-movflags', '+faststart', '-map_metadata', '-1', 'output.mp4'];
}

export async function prepareVideo(file: File, signal: AbortSignal, onProgress: (progress: VideoProgress) => void): Promise<File> {
  if (file.size > MAX_VIDEO_BYTES) throw new Error(videoSizeError(file.name));
  if (!isVideoFile(file)) throw new Error('Choose a MOV, MP4, or WebM video.');
  if (signal.aborted) throw new DOMException('Canceled', 'AbortError');
  const { FFmpeg } = await new Promise<typeof import('@ffmpeg/ffmpeg')>((resolve, reject) => {
    const canceled = () => { cleanup(); reject(new DOMException('Canceled', 'AbortError')); };
    const timer = setTimeout(() => { cleanup(); reject(new Error('The video processor could not load. Check your connection and try again.')); }, 60_000);
    const cleanup = () => { clearTimeout(timer); signal.removeEventListener('abort', canceled); };
    signal.addEventListener('abort', canceled, { once: true });
    import('@ffmpeg/ffmpeg').then((module) => { cleanup(); resolve(module); }, () => {
      cleanup(); reject(new Error('The video processor could not load. Check your connection and try again.'));
    });
  });
  if (signal.aborted) throw new DOMException('Canceled', 'AbortError');
  const ffmpeg = new FFmpeg();
  const abort = () => ffmpeg.terminate();
  signal.addEventListener('abort', abort, { once: true });
  // A stalled worker or asset load must not leave the editor locked indefinitely.
  let timedOut = false;
  let processorReady = false;
  const timeout = setTimeout(() => { timedOut = true; ffmpeg.terminate(); }, 10 * 60 * 1000);
  try {
    onProgress({ stage: 'loading', percent: null });
    const base = new URL('/video-processor/0.12.15/', window.location.origin);
    await ffmpeg.load({
      classWorkerURL: new URL('worker.js', base).href,
      coreURL: 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm/ffmpeg-core.js',
      wasmURL: 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm/ffmpeg-core.wasm'
    });
    processorReady = true;
    if (signal.aborted) throw new DOMException('Canceled', 'AbortError');
    await ffmpeg.writeFile('input', new Uint8Array(await file.arrayBuffer()));
    await ffmpeg.ffprobe(['-v', 'error', '-show_streams', '-show_format', '-of', 'json', '-o', 'probe.json', 'input']);
    // This core can return -1 after a successful probe. Validate its JSON instead.
    const probeText = await ffmpeg.readFile('probe.json', 'utf8');
    const probe = JSON.parse(String(probeText)) as VideoProbe;
    onProgress({ stage: 'converting', percent: 0 });
    ffmpeg.on('progress', ({ progress }) => {
      if (!signal.aborted && Number.isFinite(progress)) onProgress({ stage: 'converting', percent: Math.max(0, Math.min(99, Math.floor(progress * 100))) });
    });
    const result = await ffmpeg.exec(conversionArguments(probe, file.size), 9 * 60 * 1000);
    if (signal.aborted) throw new DOMException('Canceled', 'AbortError');
    if (result !== 0) throw new Error('Conversion failed');
    const data = await ffmpeg.readFile('output.mp4');
    if (!(data instanceof Uint8Array) || !data.byteLength) throw new Error('Empty output');
    if (data.byteLength > MAX_VIDEO_BYTES) throw new Error(videoSizeError(file.name));
    const bytes = new Uint8Array(data.byteLength);
    bytes.set(data);
    return new File([bytes.buffer], `${file.name.replace(/\.[^.]+$/, '')}.mp4`, { type: 'video/mp4' });
  } catch (error) {
    if (signal.aborted) throw new DOMException('Canceled', 'AbortError');
    if (error instanceof Error && error.message.includes('larger than 50 MB')) throw error;
    if (!processorReady) throw new Error('The video processor could not load. Check your connection and try again.');
    throw new Error(timedOut
      ? 'Video processing took too long. Shorten the video on your phone, then try again.'
      : 'This video could not be prepared. Try a shorter copy, or paste an Instagram, TikTok, or YouTube link instead.');
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener('abort', abort);
    ffmpeg.terminate();
  }
}
