import { mkdir, readFile, writeFile } from "node:fs/promises";
import { changedUrls, parseSitemap } from "./indexnow-sitemap.mjs";

const siteUrl = "https://hirelinedancers.com";
const key = "f8d0e756-ef7e-4063-b86f-6f729471e750";
const sitemapUrl = `${siteUrl}/sitemap.xml`;
const keyLocation = `${siteUrl}/${key}.txt`;

async function fetchSitemap() {
  const response = await fetch(sitemapUrl, { cache: "no-store" });
  if (!response.ok) throw new Error(`Sitemap request failed with ${response.status}`);
  return response.text();
}

const xml = await fetchSitemap();
const snapshot = "tmp/indexnow-previous-sitemap.xml";
if (process.argv.includes("--capture")) {
  await mkdir("tmp", { recursive: true });
  await writeFile(snapshot, xml);
  console.log("Captured the current sitemap for IndexNow comparison.");
  process.exit(0);
}

const entries = parseSitemap(xml);
let previous;
try { previous = parseSitemap(await readFile(snapshot, "utf8")); } catch { /* First deployment or capture unavailable. */ }
const changed = changedUrls(entries, previous);
const urlList = changed.length ? changed : [siteUrl, `${siteUrl}/blog/`];

for (let offset = 0; offset < urlList.length; offset += 10000) {
  const batch = urlList.slice(offset, offset + 10000);
  const response = await fetch("https://api.indexnow.org/indexnow", {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({
      host: "hirelinedancers.com",
      key,
      keyLocation,
      urlList: batch
    })
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`IndexNow request failed with ${response.status}: ${detail}`);
  }
}

console.log(`IndexNow accepted ${urlList.length} URL${urlList.length === 1 ? "" : "s"}.`);
