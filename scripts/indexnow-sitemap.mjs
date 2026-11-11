export function parseSitemap(xml) {
  return [...xml.matchAll(/<url>\s*<loc>([^<]+)<\/loc>(?:\s*<lastmod>([^<]+)<\/lastmod>)?/g)]
    .map((match) => ({ url: match[1].replaceAll("&amp;", "&"), lastModified: match[2] }));
}

export function changedUrls(entries, previous, now = Date.now()) {
  if (!previous) {
    const cutoff = now - (48 * 60 * 60 * 1000);
    return entries.filter(entry => entry.lastModified && new Date(entry.lastModified).getTime() >= cutoff).map(entry => entry.url);
  }
  const before = new Map(previous.map(entry => [entry.url, entry.lastModified]));
  const after = new Map(entries.map(entry => [entry.url, entry.lastModified]));
  return [...new Set([
    ...entries.filter(entry => !before.has(entry.url) || before.get(entry.url) !== entry.lastModified).map(entry => entry.url),
    ...previous.filter(entry => !after.has(entry.url)).map(entry => entry.url)
  ])];
}
