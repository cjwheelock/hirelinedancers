import type { MetadataRoute } from "next";
import { cities, eventTypes, site } from "@/data/site";
import { publishedPosts } from "@/data/blog";
import { profilePath, publishedProfiles } from "@/lib/publishedProfiles";

export const dynamic = "force-static";

export default function sitemap(): MetadataRoute.Sitemap {
  const staticRoutes = ["", "/about/", "/instructors/", "/instructors/join/", "/support/", "/blog/", "/guides/", "/guides/cost-to-hire-line-dance-instructor/", "/guides/start-a-line-dance-club-on-campus/", "/legal/terms/", "/legal/privacy/", "/legal/refund-policy/"];
  return [
    ...staticRoutes.map((route) => ({ url: `${site.url}${route}`, changeFrequency: "monthly" as const })),
    ...cities.map((city) => ({ url: `${site.url}/cities/${city.slug}/`, changeFrequency: "weekly" as const })),
    ...eventTypes.map((event) => ({ url: `${site.url}/events/${event.slug}/`, changeFrequency: "monthly" as const })),
    ...publishedProfiles().map(({ profile }) => ({
      url: `${site.url}${profilePath(profile)}`,
      ...(profile.updated_at ? { lastModified: new Date(profile.updated_at) } : {}),
      changeFrequency: "weekly" as const
    })),
    ...publishedPosts().map((post) => ({
      url: `${site.url}/blog/${post.slug}/`,
      lastModified: new Date(post.updatedDate ?? post.publishDate),
      changeFrequency: "yearly" as const
    }))
  ];
}
