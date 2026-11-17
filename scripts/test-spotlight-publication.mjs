import test from "node:test";
import assert from "node:assert/strict";
import { articleProblems, publicationProblems, releasedSpotlights, spotlightVersion, visibleText } from "./spotlight-publication.mjs";
import { dispatchDecision, watchdog } from "./spotlight-watchdog.mjs";

const now = Date.parse("2026-11-17T16:00:00Z");
const row = { profile_id: "001", slug: "spotlight-example", revision: "revision-1", status: "released",
  released_at: "2026-11-17T14:00:00Z", content: { name: "Example & Co", city: "Austin", bio: "First paragraph.\n\nSecond paragraph.", highlights: [] } };
const html = '<link rel="canonical" href="https://hirelinedancers.com/blog/spotlight-example/"/><h1>Meet Example &amp; Co in Austin</h1><p>First paragraph.</p><p>Second paragraph.</p>';
const response = (body, status = 200) => new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
const read = (batch, opts = {}) => releasedSpotlights({ base: "https://example.test", apikey: "public-test", now, fetchImpl: async () => response(batch), ...opts });

test("only released, complete, non-future snapshots are accepted", async () => {
  assert.deepEqual(await read([row]), [row]);
  for (const change of [{ status: "draft" }, { status: "declined" }, { released_at: null }, { released_at: "2026-11-18T14:00:00Z" }, { slug: "../private" }]) {
    await assert.rejects(read([{ ...row, ...change }]), /Invalid released/);
  }
  await assert.rejects(read([row, row]), /pagination/);
  await assert.rejects(read([], { apikey: undefined }), /configuration/);
  await assert.rejects(read([], { fetchImpl: async () => response("", 503) }), /503/);
});

test("pagination reads beyond the first batch and rejects repeated cursors", async () => {
  const batch = Array.from({ length: 200 }, (_, i) => ({ ...row, profile_id: String(i).padStart(3, "0") }));
  let calls = 0;
  const rows = await read([], { fetchImpl: async url => {
    calls++;
    if (calls === 1) return response(batch);
    assert.equal(url.searchParams.get("profile_id"), "gt.199");
    return response([{ ...row, profile_id: "200" }]);
  } });
  assert.equal(rows.length, 201);
  await assert.rejects(read([], { fetchImpl: async () => response(batch) }), /pagination/);
});

test("article verification ignores hidden script content and checks every paragraph", () => {
  assert.deepEqual(articleProblems(row, html), []);
  assert.ok(articleProblems(row, html.replace("<p>Second paragraph.</p>", '<script>Second paragraph.</script>')).includes("missing article content"));
  assert.ok(articleProblems(row, html.replace("Meet Example", "Meet Someone")).includes("wrong article heading"));
  assert.equal(visibleText("<p>Tay&#x27;s &amp; friends</p>"), "Tay's & friends");
});

test("matching manifest cannot hide missing listing, 404, or wrong content", async () => {
  const check = async (listing, page, manifest = spotlightVersion([row])) => publicationProblems([row], { fetchImpl: async url => {
    if (url.pathname === "/spotlights-version.json") return response({ version: manifest });
    if (url.pathname === "/blog/") return response(listing);
    return page();
  } });
  const listing = '<a href="/blog/spotlight-example/">Article</a>';
  assert.deepEqual(await check(listing, () => response(html)), []);
  assert.ok((await check("", () => response(html))).some(s => s.includes("missing from blog")));
  assert.ok((await check(listing, () => response("Not found", 404))).some(s => s.includes("404")));
  assert.ok((await check(listing, () => response("Wrong page"))).some(s => s.includes("heading")));
  assert.ok((await check(listing, () => response(html), "old")).some(s => s.includes("stale")));
});

test("dispatch guards active work, cooldown, stalled jobs, and retry storms", () => {
  const run = { status: "completed", createdAt: new Date(now - 15 * 60000).toISOString(), databaseId: 123 };
  assert.equal(dispatchDecision([], now), "dispatch");
  assert.equal(dispatchDecision([run], now), "dispatch");
  assert.equal(dispatchDecision([{ ...run, status: "queued" }], now), "deployment-active");
  assert.equal(dispatchDecision([{ ...run, createdAt: new Date(now - 60000).toISOString() }], now), "deployment-cooldown");
  assert.throws(() => dispatchDecision([{ ...run, status: "in_progress", createdAt: new Date(now - 31 * 60000).toISOString() }], now), /30 minutes/);
  assert.throws(() => dispatchDecision([run, run, run], now), /Three deployments/);
});

test("watchdog dispatches missing publication, records first detection, and clears on recovery", async () => {
  const calls = [];
  const options = { now, readRows: async () => [row], gh: args => { calls.push(args); return "[]"; }, verify: async () => ["missing article"] };
  const pending = await watchdog(options);
  assert.equal(pending.action, "dispatch");
  assert.equal(calls[1][0], "workflow");
  const again = await watchdog({ ...options, previous: pending, now: now + 1000 });
  assert.equal(again.firstDetectedAt, pending.firstDetectedAt);
  const recovered = await watchdog({ ...options, previous: pending, verify: async () => [] });
  assert.equal(recovered.action, "verified");
  assert.equal(recovered.firstDetectedAt, null);
});
