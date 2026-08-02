import { cityPosts } from "./posts/cityPosts";
import { employeeAdvocacyPosts } from "./posts/employeeAdvocacyPosts";
import { weeklyPosts } from "./posts/weeklyPosts";

export type BlogPost = {
  slug: string;
  title: string;
  description: string;
  /** ISO date (YYYY-MM-DD). Posts with a future date are excluded from the build
   *  and go live automatically on the next scheduled Monday rebuild. */
  publishDate: string;
  status?: "draft" | "ready";
  category: "City guide" | "Planning" | "Ideas";
  citySlug?: string;
  author?: string;
  updatedDate?: string;
  reviewer?: string;
  /** HTML body rendered inside the article shell. */
  body: string;
};

export const allPosts: BlogPost[] = [...cityPosts, ...employeeAdvocacyPosts, ...weeklyPosts];

/** Posts whose publishDate is on or before the build date, newest first. */
export function publishedPosts(): BlogPost[] {
  const now = Date.now();
  const includeDrafts = process.env.INCLUDE_DRAFT_POSTS === "true";
  return allPosts
    .filter((p) => (includeDrafts || p.status !== "draft") && new Date(p.publishDate).getTime() <= now)
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
