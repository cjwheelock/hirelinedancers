import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { cities } from "./site";
import { spotlightHeading, type Spotlight } from "@/lib/spotlight";
import { cityPosts } from "./posts/cityPosts";
import { employeeAdvocacyPosts } from "./posts/employeeAdvocacyPosts";
import { weeklyPosts } from "./posts/weeklyPosts";

export type BlogPost = {
  slug: string;
  title: string;
  searchTitle?: string;
  description: string;
  /** ISO date (YYYY-MM-DD). Future dates stay out of production builds. */
  publishDate: string;
  /** Only posts explicitly marked ready appear in production pages, feeds, and
   *  sitemaps. Set INCLUDE_DRAFT_POSTS=true for a local editorial preview build. */
  status?: "draft" | "ready";
  category: "City guide" | "Planning" | "Ideas" | "Instructor spotlight";
  spotlight?: Spotlight;
  citySlug?: string;
  author?: string;
  updatedDate?: string;
  reviewer?: string;
  /** HTML body rendered inside the article shell. */
  body: string;
};

export const allPosts: BlogPost[] = [...cityPosts, ...employeeAdvocacyPosts, ...weeklyPosts];

// The build writes one public-only snapshot shared by pages, RSS, and the sitemap.
const spotlightFile = join(process.cwd(), "tmp", "released-spotlights.json");
const releasedSpotlights: Spotlight[] = existsSync(spotlightFile) ? JSON.parse(readFileSync(spotlightFile, "utf8")) : [];

/** Explicitly approved posts whose publishDate is on or before the build date. */
export function publishedPosts(): BlogPost[] {
  const now = Date.now();
  const includeDrafts = process.env.INCLUDE_DRAFT_POSTS === "true";
  const spotlights = releasedSpotlights.map((row): BlogPost => {
    const { city, region } = row.content;
    const market = cities.find(m => m.state.toLowerCase() === region?.toLowerCase()
      && [m.city, ...m.serviceCities].some(c => c.toLowerCase() === city.toLowerCase()));
    return {
      ...spotlightHeading(row.content), slug: row.slug, status: "ready", category: "Instructor spotlight",
      publishDate: row.released_at!.slice(0, 10), citySlug: market?.slug, spotlight: row, body: ""
    };
  });
  return [...allPosts, ...spotlights]
    .filter((p) => (includeDrafts || p.status === "ready") && new Date(p.publishDate).getTime() <= now)
    .sort((a, b) => b.publishDate.localeCompare(a.publishDate));
}

export function publishedPostsForCity(citySlug: string, limit = 5): BlogPost[] {
  return publishedPosts()
    .filter((post) => post.citySlug === citySlug)
    .slice(0, limit);
}

export function formatPostDate(iso: string): string {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC"
  });
}
