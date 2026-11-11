import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";

test("a renamed internal test account is omitted while a real published instructor is exported", async () => {
  const dir = await mkdtemp(join(tmpdir(), "hld-profile-sync-"));
  try {
    await mkdir(join(dir, "public"));
    const script = pathToFileURL(resolve("scripts/sync-public-profiles.mjs")).href;
    const program = `
      process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.test';
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'public-test-key';
      globalThis.fetch = async input => {
        const name = new URL(input).pathname.split('/').at(-1);
        const rows = name === 'instructor_directory_profiles' ? [
          { id: 'a674e67d-f057-40a5-be1a-d4f63b4e8af8', slug: 'renamed-test-account', status: 'published', display_name: 'Test' },
          { id: 'f1122334-5555-4666-8777-88889999aaaa', slug: 'real-instructor', status: 'published', display_name: 'Instructor' }
        ] : [];
        return { ok: true, json: async () => rows };
      };
      await import(${JSON.stringify(script)});
    `;
    execFileSync(process.execPath, ["--input-type=module", "-e", program], { cwd: dir, stdio: "pipe" });
    const routes = JSON.parse(await readFile(join(dir, "public/profile-routes.json"), "utf8"));
    assert.deepEqual(routes, ["real-instructor"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("public package allowlist removes price and private fields without mutating stored input", async () => {
  const { publicProfilePackages } = await import('../src/lib/publicProfilePackages.mjs');
  const original = [{ name: 'Line dance pop-up', description: 'Teaching for your event', durationHours: 1, priceCents: 17500, privateNote: 'secret' }];
  assert.deepEqual(publicProfilePackages(original), [{ name: 'Line dance pop-up', description: 'Teaching for your event', durationHours: 1 }]);
  assert.equal(original[0].priceCents, 17500);
  assert.deepEqual(publicProfilePackages(null), []);
  assert.deepEqual(publicProfilePackages([null, {}, { name: 'Custom' }]), [{ name: 'Custom' }]);
});

test("public profile UI does not render package prices and retains inquiry CTA", async () => {
  const source = await readFile('src/app/profile/PublicProfile.tsx', 'utf8');
  assert.doesNotMatch(source, /priceCents|function money/);
  assert.match(source, /Custom quote/);
  assert.match(source, /Ask about this package/);
  assert.match(source, /hoursLabel\(item.durationHours\)/);
});

test("static export strips prices even if an upstream response includes them", async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hld-private-package-'));
  try {
    await mkdir(join(dir, 'public'));
    const script = pathToFileURL(resolve('scripts/sync-public-profiles.mjs')).href;
    execFileSync(process.execPath, ['--input-type=module', '-e', `
      process.env.NEXT_PUBLIC_SUPABASE_URL='https://example.test';
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY='test-public';
      globalThis.fetch=async input=>({ok:true,json:async()=>new URL(input).pathname.endsWith('instructor_directory_profiles')
        ? [{id:'abc',slug:'instructor',status:'published',display_name:'Instructor'}]
        : new URL(input).pathname.endsWith('instructor_directory_profile_extras')
          ? [{id:'abc',packages:[{name:'Pop-up',durationHours:1,priceCents:17891,privateNote:'private-sentinel'}]}] : []});
      await import(${JSON.stringify(script)});
    `], {cwd:dir,stdio:'pipe'});
    const content=await readFile(join(dir,'tmp/published-profiles.json'),'utf8');
    assert.doesNotMatch(content,/priceCents|17891|private-sentinel/);
    assert.deepEqual(JSON.parse(content)[0].profile.packages,[{name:'Pop-up',durationHours:1}]);
  } finally { await rm(dir,{recursive:true,force:true}); }
});
