import assert from "node:assert/strict";
import { test } from "node:test";
import { changedUrls, parseSitemap } from "./indexnow-sitemap.mjs";

test("notifies IndexNow about added, updated, and removed pages without repeating unchanged pages", () => {
  const old = parseSitemap("<urlset><url><loc>https://example.com/old/</loc></url><url><loc>https://example.com/updated/</loc><lastmod>2026-11-01</lastmod></url><url><loc>https://example.com/same/</loc></url></urlset>");
  const current = parseSitemap("<urlset><url><loc>https://example.com/new/</loc></url><url><loc>https://example.com/updated/</loc><lastmod>2026-11-10</lastmod></url><url><loc>https://example.com/same/</loc></url></urlset>");
  assert.deepEqual(changedUrls(current, old), ["https://example.com/new/", "https://example.com/updated/", "https://example.com/old/"]);
});

test("without a previous sitemap only recent dated URLs are selected", () => {
  const current = [{ url: "new", lastModified: "2026-11-10T00:00:00Z" }, { url: "old", lastModified: "2026-10-01" }, { url: "undated" }];
  assert.deepEqual(changedUrls(current, undefined, Date.parse("2026-11-11T00:00:00Z")), ["new"]);
});
