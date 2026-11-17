import test from "node:test";
import assert from "node:assert/strict";
import { articleProblems, publicationProblems, releasedSpotlights, spotlightVersion, visibleText } from "./spotlight-publication.mjs";
import { SpotlightEvents, verifyArticleOnce } from "./spotlight-events.mjs";

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

const event = { id: 'event-1', profile_id: row.profile_id, revision: row.revision, action: 'release', due_at: new Date(now).toISOString(), occurred_at: new Date(now + 60000).toISOString() };
function fixture(options = {}) {
  let clock = now + 60000;
  const state = { jobs: {} }, calls = { dispatch: 0, verify: 0, alerts: 0 };
  const publisher = new SpotlightEvents({ state, now: () => clock, save: async () => {}, readArticle: async () => row,
    dispatch: async () => { calls.dispatch++; }, findDispatch: async () => false,
    verify: async () => { calls.verify++; return []; }, notify: async () => { calls.alerts++; }, ...options });
  return { publisher, state, calls, time: value => { clock = value; } };
}

test('release dispatches immediately, and verifies once at scheduled time plus five minutes', async () => {
  const f = fixture();
  await f.publisher.accept(event);
  await f.publisher.accept(event);
  assert.equal(f.calls.dispatch, 1);
  assert.equal(f.calls.verify, 0);
  assert.equal(f.state.jobs[event.id].verification.at, new Date(now + 5 * 60000).toISOString());
  f.time(now + 5 * 60000 - 1); await f.publisher.verifyDue(event.id);
  assert.equal(f.calls.verify, 0);
  f.time(now + 5 * 60000); await f.publisher.verifyDue(event.id);
  await f.publisher.verifyDue(event.id); await f.publisher.accept(event);
  assert.equal(f.calls.verify, 1);
  assert.equal(f.calls.dispatch, 1);
  assert.equal(f.state.jobs[event.id].verification.status, 'passed');
});

test('failed public check alerts once and never retries or dispatches another build', async () => {
  let checks = 0;
  const f = fixture({ verify: async () => { checks++; return ['article HTTP 404']; } });
  await f.publisher.accept(event); f.time(now + 300000);
  await f.publisher.verifyDue(event.id); await f.publisher.verifyDue(event.id);
  assert.equal(checks, 1); assert.equal(f.calls.alerts, 1); assert.equal(f.calls.dispatch, 1);
  assert.equal(f.state.jobs[event.id].verification.status, 'failed');
});

test('restart preserves completed checks and marks interrupted checks uncertain without repeating', async () => {
  const f = fixture(); await f.publisher.accept(event);
  f.state.jobs[event.id].verification.status = 'started';
  await f.publisher.recover(); f.time(now + 300000); await f.publisher.verifyDue(event.id);
  assert.equal(f.state.jobs[event.id].verification.status, 'uncertain'); assert.equal(f.calls.verify, 0); assert.equal(f.calls.alerts, 1);
});

test('lost dispatch response is reconciled against its event id without duplicate deployment', async () => {
  let requests = 0;
  const f = fixture({ dispatch: async () => { requests++; throw new Error('response lost'); }, findDispatch: async () => true });
  await f.publisher.accept(event); f.time(now + 120000); await f.publisher.publish(event.id);
  assert.equal(requests, 1); assert.equal(f.state.jobs[event.id].dispatch.status, 'accepted');
});

test('delivery failure retries are bounded and do not check public pages', async () => {
  const f = fixture({ dispatch: async () => { throw new Error('unavailable'); } });
  await f.publisher.accept(event);
  f.time(now + 120000); await f.publisher.publish(event.id);
  f.time(now + 180000); await f.publisher.publish(event.id);
  f.time(now + 240000); await f.publisher.publish(event.id);
  assert.equal(f.state.jobs[event.id].dispatch.attempts, 3);
  assert.equal(f.state.jobs[event.id].dispatch.status, 'failed'); assert.equal(f.calls.verify, 0);
});

test('superseded releases are skipped, and withdrawals deploy without scheduling a public check', async () => {
  const f = fixture({ readArticle: async () => null }); await f.publisher.accept(event);
  assert.equal(f.state.jobs[event.id].verification.status, 'superseded'); assert.equal(f.calls.dispatch, 0);
  await f.publisher.accept({ ...event, id: 'withdrawal', action: 'withdraw', due_at: null });
  assert.equal(f.calls.dispatch, 1); assert.equal(f.state.jobs.withdrawal.verification.status, 'not-required');
});

test('one targeted verification reads only the listing and the due article', async () => {
  const urls = [];
  const problems = await verifyArticleOnce(row, { fetchImpl: async url => {
    urls.push(new URL(url).pathname);
    return response(urls.length === 1 ? '<a href="/blog/spotlight-example/">Article</a>' : html);
  } });
  assert.deepEqual(problems, []); assert.deepEqual(urls, ['/blog/', '/blog/spotlight-example/']);
});
