const siteUrl = "https://hirelinedancers.com";
const key = "f8d0e756-ef7e-4063-b86f-6f729471e750";
const sitemapUrl = `${siteUrl}/sitemap.xml`;
const keyLocation = `${siteUrl}/${key}.txt`;

function parseSitemap(xml) {
  return [...xml.matchAll(/<url>\s*<loc>([^<]+)<\/loc>(?:\s*<lastmod>([^<]+)<\/lastmod>)?/g)]
    .map((match) => ({ url: match[1], lastModified: match[2] }));
}

async function fetchSitemap() {
  const response = await fetch(sitemapUrl, { cache: "no-store" });
  if (!response.ok) throw new Error(`Sitemap request failed with ${response.status}`);
  return response.text();
}

const xml = await fetchSitemap();
const entries = parseSitemap(xml);
const recentCutoff = Date.now() - (48 * 60 * 60 * 1000);
const recentlyChanged = entries
  .filter((entry) => entry.lastModified && new Date(entry.lastModified).getTime() >= recentCutoff)
  .map((entry) => entry.url);
const urlList = recentlyChanged.length > 0 ? recentlyChanged : [siteUrl, `${siteUrl}/blog/`];

const response = await fetch("https://api.indexnow.org/indexnow", {
  method: "POST",
  headers: { "Content-Type": "application/json; charset=utf-8" },
  body: JSON.stringify({
    host: "hirelinedancers.com",
    key,
    keyLocation,
    urlList
  })
});

if (!response.ok) {
  const detail = await response.text();
  throw new Error(`IndexNow request failed with ${response.status}: ${detail}`);
}

console.log(`IndexNow accepted ${urlList.length} URL${urlList.length === 1 ? "" : "s"}.`);
