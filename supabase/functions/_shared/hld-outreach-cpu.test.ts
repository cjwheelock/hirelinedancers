import { boundedPageText, crawlPlannerSite } from './hld-outreach.ts';
function htmlResponse(url: string, body: string) { const r=new Response(body,{headers:{'content-type':'text/html'}}); Object.defineProperty(r,'url',{value:url}); return r; }
function assert(ok: unknown, message: string) { if (!ok) throw Error(message); }
Deno.test('stream read capped and cancelled', async () => {
 let cancelled=false;
 const body=new ReadableStream({pull(c){c.enqueue(new Uint8Array(100000).fill(65));}, cancel(){cancelled=true;}});
 const text=await boundedPageText(new Response(body));
 assert(text.length===300000, 'limit'); assert(cancelled,'cancelled');
});
Deno.test('large script blob cannot exhaust CPU; email and name retained', async () => {
 const real=globalThis.fetch;
 const start=performance.now();
 globalThis.fetch=async(input)=> {
  const url=String(input);
  return htmlResponse(url,url.endsWith('sitemap.xml')?'':`<script>${'A'.repeat(200000)}</script><p>hi, i'm Alice</p><a href="mailto:alice@planner.test">Email</a>`);
 };
 try { const r=await crawlPlannerSite('https://planner.test'); assert(r.email==='alice@planner.test','email'); assert(r.firstName==='Alice','name'); assert(performance.now()-start<1000,'bounded runtime'); }
 finally {globalThis.fetch=real;}
});
Deno.test('encoded and obfuscated email extraction retained', async () => {
 const real=globalThis.fetch;
 globalThis.fetch=async(input)=>htmlResponse(String(input),String(input).endsWith('sitemap.xml')?'':'<p>alice [at] planner [dot] com</p>');
 try {const r=await crawlPlannerSite('https://planner.test'); assert(r.email==='alice@planner.com','obfuscated email');}
 finally {globalThis.fetch=real;}
});
