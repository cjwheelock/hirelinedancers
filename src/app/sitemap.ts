import type { MetadataRoute } from "next";
import { cities, eventTypes, instructors, site } from "@/data/site";
import { publishedPosts } from "@/data/blog";

export const dynamic = "force-static";

export default function sitemap(): MetadataRoute.Sitemap {
  const contentUpdatedAt = new Date("2026-08-01T00:00:00Z");
  const staticRoutes = ["", "/about/", "/instructors/join/", "/apply/", "/blog/", "/guides/cost-to-hire-line-dance-instructor/", "/legal/terms/", "/legal/privacy/", "/legal/refund-policy/"];
  return [
    ...staticRoutes.map((route) => ({ url: `${site.url}${route}`, lastModified: contentUpdatedAt, changeFrequency: "monthly" as const })),
    ...cities.map((city) => ({ url: `${site.url}/cities/${city.slug}/`, lastModified: contentUpdatedAt, changeFrequency: "weekly" as const })),
    ...eventTypes.map((event) => ({ url: `${site.url}/events/${event.slug}/`, lastModified: contentUpdatedAt, changeFrequency: "monthly" as const })),
    ...instructors.map((instructor) => ({ url: `${site.url}/instructors/${instructor.slug}/`, lastModified: contentUpdatedAt, changeFrequency: "monthly" as const })),
    ...publishedPosts().map((post) => ({
      url: `${site.url}/blog/${post.slug}/`,
      lastModified: new Date(post.updatedDate ?? post.publishDate),
      changeFrequency: "yearly" as const
    }))
  ];
}
