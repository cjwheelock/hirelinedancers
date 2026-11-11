import { copyFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
const require = createRequire(import.meta.url);
const target = new URL('../public/video-processor/0.12.15/', import.meta.url);
await mkdir(target, { recursive: true });

const wrapper = dirname(require.resolve('@ffmpeg/ffmpeg')).replace(/umd$/, 'esm');
for (const file of ['worker.js', 'const.js', 'errors.js']) await copyFile(join(wrapper, file), new URL(file, target));
