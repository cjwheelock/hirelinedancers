import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const snapshot = JSON.parse(await readFile("tmp/published-profiles.json", "utf8"));
const routes = JSON.parse(await readFile("out/profile-routes.json", "utf8"));
const sitemap = await readFile("out/sitemap.xml", "utf8");

test("each public profile has an indexable page with its own metadata and visible content", async () => {
  assert.equal(routes.length, snapshot.length);
  for (const { profile, media } of snapshot) {
    const identifier = profile.slug || profile.id;
    const canonical = `https://hirelinedancers.com/profile/${encodeURIComponent(identifier)}/`;
    const html = await readFile(`out/profile/${identifier}/index.html`, "utf8");
    assert.ok(routes.includes(identifier));
    assert.ok(sitemap.includes(`<loc>${canonical}</loc>`));
    assert.ok(html.includes(`<link rel="canonical" href="${canonical}"`));
    assert.ok(html.includes(`<meta property="og:url" content="${canonical}"`));
    assert.match(html, /<title>(?!Line Dance Instructor Profile)/);
    assert.ok(html.includes(profile.display_name.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")));
    const headshot = media.find(item => item.media_type === "headshot");
    if (headshot?.storage_path) {
      const filename = encodeURIComponent(headshot.storage_path.split("/").at(-1));
      assert.ok((html.match(/<img\b[^>]*>/g) ?? []).some(tag => tag.includes(filename)));
    }
    assert.doesNotMatch(html, /<meta name="robots" content="noindex/);
  }
});

test("the internal booking-test account is not promoted to search", () => {
  assert.ok(!snapshot.some(({ profile }) => profile.id === "a674e67d-f057-40a5-be1a-d4f63b4e8af8"));
  assert.ok(!routes.includes("cj-wheelock-new-york-ny"));
  assert.ok(!sitemap.includes("/profile/cj-wheelock-new-york-ny/"));
});

test("the existing query-based profile remains present", async () => {
  const html = await readFile("out/profile/index.html", "utf8");
  assert.match(html, /Line Dance Instructor Profile/);
});
