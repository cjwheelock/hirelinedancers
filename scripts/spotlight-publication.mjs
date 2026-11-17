import { createHash } from "node:crypto";

export async function releasedSpotlights({ base, apikey, fetchImpl = fetch, now = Date.now() }) {
  if (!base || !apikey) throw new Error("Spotlight database configuration is incomplete.");
  const rows = [];
  for (;;) {
    const url = new URL("/rest/v1/instructor_spotlights", base);
    url.search = new URLSearchParams({
      select: "profile_id,slug,revision,status,released_at,content",
      status: "eq.released", order: "profile_id", limit: "200",
      ...(rows.length ? { profile_id: `gt.${rows.at(-1).profile_id}` } : {})
    }).toString();
    const response = await fetchImpl(url, { headers: { apikey }, signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error(`Reading released spotlights failed (${response.status}).`);
    const batch = await response.json();
    if (!Array.isArray(batch) || batch.some(row => row.status !== "released"
      || !row.revision || !row.profile_id || !/^[a-z0-9-]+$/.test(row.slug)
      || !Number.isFinite(Date.parse(row.released_at)) || Date.parse(row.released_at) > now
      || !row.content?.name || !row.content?.city)) {
      throw new Error("Invalid released spotlight response.");
    }
    for (const row of batch) {
      if (rows.length && row.profile_id <= rows.at(-1).profile_id) throw new Error("Spotlight pagination did not advance.");
      rows.push(row);
    }
    if (batch.length < 200) return rows;
  }
}

export function spotlightVersion(rows) {
  return createHash("sha256").update(JSON.stringify(rows.map(r => [r.profile_id, r.revision]))).digest("hex");
}

function normalize(value) {
  return value.trim().replace(/\s*\u2014\s*/g, ", ").replace(/\s+/g, " ");
}

export function visibleText(html) {
  return normalize(html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "").replace(/<[^>]+>/g, " ")
    .replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (_, entity) => {
      if (entity[0] === "#") return String.fromCodePoint(entity[1].toLowerCase() === "x"
        ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10));
      return { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " }[entity.toLowerCase()];
    }));
}

export function articleProblems(row, html) {
  const problems = [];
  const c = row.content;
  const heading = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1] || "";
  const city = c.city === "San Francisco Bay Area" ? `the ${c.city}` : c.city;
  if (visibleText(heading) !== normalize(`Meet ${c.name} in ${city}`)) problems.push("wrong article heading");
  const text = visibleText(html);
  const expected = [c.headline, ...(c.bio || "").split(/\n\s*\n/), c.favoriteDance, c.favoriteSong,
    ...(c.highlights || []).flatMap(h => [h.title, h.detail])].filter(Boolean);
  if (c.years > 0) expected.push(`${c.name} has ${c.years} ${c.years === 1 ? "year" : "years"} of teaching experience.`);
  if (expected.some(value => !text.includes(normalize(value)))) problems.push("missing article content");
  if (!html.includes(`/blog/${row.slug}/`)) problems.push("missing canonical article URL");
  return problems;
}

export async function publicationProblems(rows, { site = "https://hirelinedancers.com", fetchImpl = fetch } = {}) {
  const problems = [];
  const read = path => {
    const url = new URL(path, site);
    url.searchParams.set("publication_check", String(Date.now()));
    return fetchImpl(url, { cache: "no-store", signal: AbortSignal.timeout(30000) });
  };
  const manifest = await read("/spotlights-version.json");
  if (!manifest.ok) problems.push(`spotlight manifest HTTP ${manifest.status}`);
  else if ((await manifest.json()).version !== spotlightVersion(rows)) problems.push("spotlight manifest is stale");
  const blog = await read("/blog/");
  if (!blog.ok) problems.push(`blog listing HTTP ${blog.status}`);
  const listing = blog.ok ? await blog.text() : "";
  for (const row of rows) {
    const path = `/blog/${row.slug}/`;
    if (!listing.includes(`href="${path}"`)) problems.push(`${row.slug}: missing from blog listing`);
    const page = await read(path);
    if (!page.ok) problems.push(`${row.slug}: HTTP ${page.status}`);
    else problems.push(...articleProblems(row, await page.text()).map(issue => `${row.slug}: ${issue}`));
  }
  return problems;
}
