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
