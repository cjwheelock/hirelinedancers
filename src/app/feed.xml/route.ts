import { publishedPosts } from "@/data/blog";
import { site } from "@/data/site";

export const dynamic = "force-static";

function escapeXml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

export function GET() {
  const posts = publishedPosts();
  const latestDate = posts[0]?.updatedDate ?? posts[0]?.publishDate ?? "2026-08-01";
  const items = posts.map((post) => `
    <item>
      <title>${escapeXml(post.title)}</title>
      <link>${site.url}/blog/${post.slug}/</link>
      <guid isPermaLink="true">${site.url}/blog/${post.slug}/</guid>
      <pubDate>${new Date(`${post.publishDate}T12:00:00Z`).toUTCString()}</pubDate>
      <description>${escapeXml(post.description)}</description>
      <author>${escapeXml(post.author ?? site.name)}</author>
    </item>`).join("");

  const xml = `<?xml version="1.0" encoding="UTF-8" ?>
<rss version="2.0">
  <channel>
    <title>${escapeXml(site.name)} Blog</title>
    <link>${site.url}/blog/</link>
    <description>${escapeXml("City guides and practical ideas for planning events with line dancing.")}</description>
    <language>en-us</language>
    <lastBuildDate>${new Date(`${latestDate}T12:00:00Z`).toUTCString()}</lastBuildDate>${items}
  </channel>
</rss>`;

  return new Response(xml, {
    headers: { "Content-Type": "application/rss+xml; charset=utf-8" }
  });
}
