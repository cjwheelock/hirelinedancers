import { eventTypes } from "@/data/site";
import type { ProfileHighlight } from "@/lib/marketplace";
import type { VideoProvider } from "@/lib/videoLinks";

type SpotlightMedia = {
  path?: string; url?: string; caption?: string; alt?: string; provider?: VideoProvider; embedId?: string;
};
export type SpotlightContent = {
  name: string; city: string; region?: string; headline?: string; bio?: string; years?: number;
  highlights: ProfileHighlight[]; events: string[]; favoriteDance?: string; favoriteSong?: string;
  photo?: SpotlightMedia; video?: SpotlightMedia;
};
export type Spotlight = {
  profile_id: string; slug: string; revision: string; content: SpotlightContent;
  status: "draft" | "approved" | "released" | "declined"; released_at: string | null;
};

export function articleText(value: string) {
  return value.trim().replace(/\s*\u2014\s*/g, ", ");
}

export function spotlightHeading(c: SpotlightContent) {
  const location = [c.city, c.region].filter(Boolean).join(", ");
  const title = articleText(`Meet ${c.name} in ${c.city}`);
  const searchTitle = articleText(`Meet ${c.name}, a line dance instructor in ${location}`);
  const events = c.events.map(value => eventTypes.find(event => event.slug === value)?.label.toLowerCase() || value.replace(/[-_]/g, " "));
  const occasion = events.length ? ` for ${new Intl.ListFormat("en-US").format(events)}` : "";
  const description = articleText(c.headline || `${c.name} teaches line dancing${occasion} in ${location}.`);
  return { title, searchTitle, description };
}

export function spotlightMediaUrl(media?: SpotlightMedia) {
  if (!media) return undefined;
  if (media.path && process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/instructor-media/${media.path.split("/").map(encodeURIComponent).join("/")}`;
  }
  try {
    const url = new URL(media.url || "");
    return url.protocol === "https:" ? url.href : undefined;
  } catch {
    return undefined;
  }
}
