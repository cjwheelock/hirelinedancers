import { cityPosts } from "./posts/cityPosts";
import { weeklyPosts } from "./posts/weeklyPosts";

export type BlogPost = {
  slug: string;
  title: string;
  description: string;
  /** ISO date (YYYY-MM-DD). Posts with a future date are excluded from the build
   *  and go live automatically on the next scheduled Monday rebuild. */
  publishDate: string;
  category: "City guide" | "Planning" | "Ideas";
  citySlug?: string;
  /** HTML body rendered inside the article shell. */
  body: string;
};

export const allPosts: BlogPost[] = [...cityPosts, ...weeklyPosts];

/** Posts whose publishDate is on or before the build date, newest first. */
export function publishedPosts(): BlogPost[] {
  const now = Date.now();
  return allPosts
    .filter((p) => new Date(p.publishDate).getTime() <= now)
    .sort((a, b) => b.publishDate.localeCompare(a.publishDate));
}

export function formatPostDate(iso: string): string {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC"
  });
}
