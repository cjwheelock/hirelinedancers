import { createHash } from "node:crypto";
import { appendFile, mkdir, writeFile } from "node:fs/promises";

const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
const apikey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const check = process.argv.includes("--check");
const rows = [];
if (!base || !apikey) {
  if (check || process.env.GITHUB_ACTIONS || base || apikey) throw new Error("Spotlight database configuration is incomplete.");
} else {
  for (;;) {
    const url = new URL("/rest/v1/instructor_spotlights", base);
    url.search = new URLSearchParams({
      select: "profile_id,slug,revision,status,released_at,content",
      status: "eq.released", order: "profile_id", limit: "200",
      ...(rows.length ? { profile_id: `gt.${rows.at(-1).profile_id}` } : {})
    }).toString();
    const response = await fetch(url, { headers: { apikey }, signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error(`Reading released spotlights failed (${response.status}).`);
    const batch = await response.json();
    if (!Array.isArray(batch) || batch.some(row => row.status !== "released" || !row.released_at)) {
      throw new Error("Invalid released spotlight response.");
    }
    rows.push(...batch);
    if (batch.length < 200) break;
  }
}
const version = createHash("sha256").update(JSON.stringify(rows.map(r => [r.profile_id, r.revision]))).digest("hex");
if (check) {
  const live = await fetch("https://hirelinedancers.com/spotlights-version.json", { cache: "no-store", signal: AbortSignal.timeout(30000) });
  if (!live.ok) throw new Error(`Reading the deployed spotlight version failed (${live.status}).`);
  const changed = (await live.json()).version !== version;
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `changed=${changed}\n`);
  console.log(changed ? "Spotlight changes are ready." : "Spotlights are current.");
} else {
  await mkdir("tmp", { recursive: true });
  await writeFile("tmp/released-spotlights.json", JSON.stringify(rows) + "\n");
  await writeFile("public/spotlights-version.json", JSON.stringify({ version }) + "\n");
  console.log(`Included ${rows.length} released spotlight(s).`);
}
