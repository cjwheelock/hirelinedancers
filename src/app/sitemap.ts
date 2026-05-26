import type { MetadataRoute } from "next";
import { cities, eventTypes, instructors, site } from "@/data/site";

export const dynamic = "force-static";

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date("2026-05-26");
  const staticRoutes = ["", "/pricing/", "/apply/", "/admin/", "/guides/cost-to-hire-line-dance-instructor/", "/legal/terms/", "/legal/privacy/", "/legal/refund-policy/"];
  return [
    ...staticRoutes.map((route) => ({ url: `${site.url}${route}`, lastModified: now })),
    ...cities.map((city) => ({ url: `${site.url}/cities/${city.slug}/`, lastModified: now })),
    ...eventTypes.map((event) => ({ url: `${site.url}/events/${event.slug}/`, lastModified: now })),
    ...instructors.map((instructor) => ({ url: `${site.url}/instructors/${instructor.slug}/`, lastModified: now }))
  ];
}
