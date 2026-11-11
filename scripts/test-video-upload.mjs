import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
const source = readFileSync(new URL('../src/lib/videoUpload.ts', import.meta.url), 'utf8');
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
function subject(options = {}) {
  const calls = [];
  class FFmpeg {
    load = async () => { calls.push('load'); if(options.loadError) throw new Error('load failed'); };
    writeFile = async () => { calls.push('write'); };
    ffprobe = async () => 0;
    on = () => {};
    exec = async args => { calls.push(args); options.abort?.(); return options.exit ?? 0; };
    readFile = async path => path === 'probe.json' ? JSON.stringify({ streams: [{ codec_type: 'video' }], format: { duration: '1' } }) : new Uint8Array(options.outputSize ?? 10);
    terminate = () => { calls.push('terminate'); };
  }
  const exports = {};
  new Function('require', 'exports', 'window', js)(() => ({ FFmpeg }), exports, { location: { origin: 'https://hirelinedancers.test' } });
  return { ...exports, calls };
}

test('accepts iPhone MOV, MP4, WebM, uppercase extensions and empty MIME fallback', () => {
  const s = subject();
  for (const [name,type] of [['IMG_123.MOV','video/quicktime'],['clip.mp4','video/mp4'],['clip.webm','video/webm'],['IMG_123.MOV',''],['clip.mp4','application/octet-stream']]) assert.equal(s.isVideoFile({name,type}),true);
  for (const [name,type] of [['image.jpg','image/jpeg'],['movie.avi','video/avi'],['clip.mov','text/plain']]) assert.equal(s.isVideoFile({name,type}),false);
});

test('exact 50 MiB is allowed; one byte over rejects before processor loads', async () => {
  const s=subject(); assert.equal(s.MAX_VIDEO_BYTES,52_428_800);
  await assert.rejects(s.prepareVideo({name:'large.MOV',type:'video/quicktime',size:s.MAX_VIDEO_BYTES+1},new AbortController().signal,()=>{}), /shorten it on your phone/);
  assert.deepEqual(s.calls,[]);
  const f={name:'limit.MOV',type:'video/quicktime',size:s.MAX_VIDEO_BYTES,arrayBuffer:async()=>new ArrayBuffer(0)};
  assert.equal((await s.prepareVideo(f,new AbortController().signal,()=>{})).type,'video/mp4');
});

test('output is MP4 and processor always terminates', async () => {
  const s=subject(), progress=[];
  const f=await s.prepareVideo(new File(['movie'],'hello.MOV',{type:'video/quicktime'}),new AbortController().signal,p=>progress.push(p));
  assert.equal(f.name,'hello.mp4'); assert.equal(f.type,'video/mp4'); assert.equal(s.calls.at(-1),'terminate'); assert.equal(progress[0].stage,'loading');
});

test('cancellation and processor errors produce recoverable results and cleanup', async () => {
  const c=new AbortController(); const s=subject({abort:()=>c.abort()});
  await assert.rejects(s.prepareVideo(new File(['movie'],'x.mov',{type:'video/quicktime'}),c.signal,()=>{}),{name:'AbortError'});
  assert.equal(s.calls.at(-1),'terminate');
  const failure=subject({loadError:true});
  await assert.rejects(failure.prepareVideo(new File(['movie'],'x.mov',{type:'video/quicktime'}),new AbortController().signal,()=>{}),/Check your connection/);
  assert.equal(failure.calls.at(-1),'terminate');
});

test('oversize or failed conversion cannot be uploaded as successful output', async () => {
  const f=new File(['movie'],'x.mov',{type:'video/quicktime'});
  await assert.rejects(subject({exit:1}).prepareVideo(f,new AbortController().signal,()=>{}),/could not be prepared/);
  await assert.rejects(subject({outputSize:52_428_801}).prepareVideo(f,new AbortController().signal,()=>{}),/larger than 50 MB/);
});

test('conversion normalizes HDR, audio, dimensions and progressive playback without truncation',()=>{
  const s=subject();
  const args=s.conversionArguments({streams:[{codec_type:'video',color_transfer:'arib-std-b67'}],format:{duration:'60'}},50_000_000);
  assert.ok(args.includes('libx264'));assert.ok(args.includes('aac'));assert.ok(args.includes('+faststart'));
  assert.match(args[args.indexOf('-vf')+1],/1280.*tonemap=.*yuv420p/);
  assert.ok(!args.includes('-t'));assert.ok(!args.includes('-fs'));
  assert.throws(()=>s.conversionArguments({streams:[]},100),/could not be read/);
});

test('component converts before upload and replaces existing welcome metadata after upload',()=>{
  const ui=readFileSync(new URL('../src/components/ProfileMediaManager.tsx',import.meta.url),'utf8');
  assert.match(ui,/const prepared = await prepareVideo/);
  assert.match(ui,/await uploadFile\(prepared, mediaType, sortOrder, replace\)/);
  assert.match(ui,/await uploadVideo\(file, "welcome_video", 0, welcome\)/);
  assert.doesNotMatch(ui,/if \(welcome\) await removeItem\(welcome/);
  assert.match(ui,/if \(!canEdit \|\| !files.length \|\| operation.current \|\| busy !== null\) return/);
});

test('durationless WebM still converts without imposing a duration cap', () => {
  const args = subject().conversionArguments({ streams: [{ codec_type: 'video' }] }, 100_000);
  assert.ok(args.includes('libx264'));
  assert.ok(!args.includes('-t'));
});
