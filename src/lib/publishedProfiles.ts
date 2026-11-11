import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { PublicInstructorProfile, ProfileMedia } from "@/app/profile/PublicProfile";

export type PublishedProfileSnapshot = { profile: PublicInstructorProfile & { updated_at?: string | null }; media: ProfileMedia[] };

// The build step obtains this snapshot only from the published public views.
export function publishedProfiles(): PublishedProfileSnapshot[] {
  const file = join(process.cwd(), "tmp", "published-profiles.json");
  return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : [];
}

export function profileIdentifier(profile: PublicInstructorProfile) {
  return profile.slug || profile.id;
}

export function profilePath(profile: PublicInstructorProfile) {
  return `/profile/${encodeURIComponent(profileIdentifier(profile))}/`;
}

export function profilePhoto(media: ProfileMedia[]) {
  const photo = media.find(item => item.media_type === "headshot");
  if (!photo) return undefined;
  if (photo.storage_path && process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/instructor-media/${photo.storage_path.split("/").map(encodeURIComponent).join("/")}`;
  }
  try {
    const url = new URL(photo.external_url || "");
    return url.protocol === "https:" ? url.href : undefined;
  } catch {
    return undefined;
  }
}
