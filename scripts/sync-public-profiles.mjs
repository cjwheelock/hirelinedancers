import { createHash } from "node:crypto";
import { appendFile, mkdir, writeFile } from "node:fs/promises";

// Read only the same public directory, extras, and ready media used by the site.
const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
const apikey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const check = process.argv.includes("--check");
// This published account explicitly identifies itself as an internal booking test.
// Keep its existing directory URL working, but do not create a search landing page.
const excludedIdentifiers = new Set(["cj-wheelock-new-york-ny"]);
const fields = "id,slug,status,display_name,business_name,headline,bio,city,region,travel_radius_miles,years_teaching,max_group_size,styles,event_types,age_groups,languages,favorite_song_name,favorite_song_spotify_url,provides_speakers,provides_microphone,provides_music_playback,liability_insurance_status,preferred_response_hours,published_at,created_at,updated_at";
const mediaFields = "id,instructor_profile_id,media_type,storage_path,external_url,mime_type,caption,alt_text,sort_order,embed_provider,embed_id";

async function readRows(table, select, filters = {}) {
  const rows = [];
  for (;;) {
    const url = new URL(`/rest/v1/${table}`, base);
    url.search = new URLSearchParams({ select, ...filters, order: "id.asc", limit: "200", ...(rows.length ? { id: `gt.${rows.at(-1).id}` } : {}) }).toString();
    const response = await fetch(url, { headers: { apikey }, signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error(`Reading public ${table} failed (${response.status}).`);
    const batch = await response.json();
    if (!Array.isArray(batch) || batch.some(row => !row.id)) throw new Error(`Invalid public ${table} response.`);
    rows.push(...batch);
    if (batch.length < 200) return rows;
  }
}

let profiles = [];
if (!base || !apikey) {
  if (check || process.env.GITHUB_ACTIONS || base || apikey) throw new Error("Public profile database configuration is incomplete.");
} else {
  const [directory, extras, media] = await Promise.all([
    readRows("instructor_directory_profiles", fields, { status: "eq.published" }),
    readRows("instructor_directory_profile_extras", "id,highlights,packages"),
    readRows("profile_media", mediaFields, { status: "eq.ready" })
  ]);
  const used = new Set();
  profiles = directory.filter(row => !excludedIdentifiers.has(row.slug || row.id)).map(row => {
    const identifier = row.slug || row.id;
    if (row.status !== "published" || !row.display_name || !/^[a-z0-9-]+$/.test(identifier) || used.has(identifier)) {
      throw new Error("Invalid or duplicate published profile identifier.");
    }
    used.add(identifier);
    const extra = extras.find(item => item.id === row.id);
    return {
      profile: { ...row, highlights: extra?.highlights ?? [], packages: extra?.packages ?? [] },
      media: media.filter(item => item.instructor_profile_id === row.id).sort((a, b) => a.sort_order - b.sort_order || a.id.localeCompare(b.id))
    };
  });
}

const version = createHash("sha256").update(JSON.stringify(profiles)).digest("hex");
if (check) {
  const live = await fetch("https://hirelinedancers.com/profiles-version.json", { cache: "no-store", signal: AbortSignal.timeout(30000) });
  if (!live.ok && live.status !== 404) throw new Error(`Reading the deployed profile version failed (${live.status}).`);
  const changed = live.status === 404 || (await live.json()).version !== version;
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `changed=${changed}\n`);
  console.log(changed ? "Public profile changes are ready." : "Public profiles are current.");
} else {
  await mkdir("tmp", { recursive: true });
  await writeFile("tmp/published-profiles.json", JSON.stringify(profiles) + "\n");
  await writeFile("public/profile-routes.json", JSON.stringify(profiles.map(({ profile }) => profile.slug || profile.id)) + "\n");
  await writeFile("public/profiles-version.json", JSON.stringify({ version }) + "\n");
  console.log(`Included ${profiles.length} published profile(s).`);
}
