import type { MetadataRoute } from "next";
import { cities, eventTypes, instructors, site } from "@/data/site";
import { publishedPosts } from "@/data/blog";

export const dynamic = "force-static";

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  const staticRoutes = ["", "/instructors/join/", "/apply/", "/blog/", "/guides/cost-to-hire-line-dance-instructor/", "/legal/terms/", "/legal/privacy/", "/legal/refund-policy/"];
  return [
    ...staticRoutes.map((route) => ({ url: `${site.url}${route}`, lastModified: now })),
    ...cities.map((city) => ({ url: `${site.url}/cities/${city.slug}/`, lastModified: now })),
    ...eventTypes.map((event) => ({ url: `${site.url}/events/${event.slug}/`, lastModified: now })),
    ...instructors.map((instructor) => ({ url: `${site.url}/instructors/${instructor.slug}/`, lastModified: now })),
    ...publishedPosts().map((post) => ({ url: `${site.url}/blog/${post.slug}/`, lastModified: new Date(post.publishDate) }))
  ];
}
