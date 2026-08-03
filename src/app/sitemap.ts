import type { MetadataRoute } from "next";
import { cities, eventTypes, site } from "@/data/site";
import { publishedPosts } from "@/data/blog";

export const dynamic = "force-static";

export default function sitemap(): MetadataRoute.Sitemap {
  const contentUpdatedAt = new Date("2026-08-02T00:00:00Z");
  const staticRoutes = ["", "/about/", "/instructors/", "/instructors/join/", "/apply/", "/blog/", "/guides/", "/guides/cost-to-hire-line-dance-instructor/", "/guides/start-a-line-dance-club-on-campus/", "/legal/terms/", "/legal/privacy/", "/legal/refund-policy/"];
  return [
    ...staticRoutes.map((route) => ({ url: `${site.url}${route}`, lastModified: contentUpdatedAt, changeFrequency: "monthly" as const })),
    ...cities.map((city) => ({ url: `${site.url}/cities/${city.slug}/`, lastModified: contentUpdatedAt, changeFrequency: "weekly" as const })),
    ...eventTypes.map((event) => ({ url: `${site.url}/events/${event.slug}/`, lastModified: contentUpdatedAt, changeFrequency: "monthly" as const })),
    ...publishedPosts().map((post) => ({
      url: `${site.url}/blog/${post.slug}/`,
      lastModified: new Date(post.updatedDate ?? post.publishDate),
      changeFrequency: "yearly" as const
    }))
  ];
}
