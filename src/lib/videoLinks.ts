// Mirrors private.parse_video_link in the database. The database is the
// source of truth; this copy gives instant feedback in the editor and builds
// embed URLs on the public profile.

export type VideoProvider = "youtube" | "instagram" | "tiktok";

export type ParsedVideoLink = { provider: VideoProvider; id: string };

export function parseVideoLink(value: string): ParsedVideoLink | null {
  const url = value.trim();
  if (!/^https:\/\//i.test(url) || url.length > 500) return null;

  const youtube =
    url.match(/^https:\/\/(?:www\.|m\.)?youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/|live\/)([A-Za-z0-9_-]{11})/i) ??
    url.match(/^https:\/\/youtu\.be\/([A-Za-z0-9_-]{11})/i);
  if (youtube) return { provider: "youtube", id: youtube[1] };

  const instagram = url.match(/^https:\/\/(?:www\.)?instagram\.com\/(?:[A-Za-z0-9_.]+\/)?(?:p|reel|reels|tv)\/([A-Za-z0-9_-]{5,40})/i);
  if (instagram) return { provider: "instagram", id: instagram[1] };

  const tiktok =
    url.match(/^https:\/\/(?:www\.|m\.)?tiktok\.com\/@[A-Za-z0-9_.-]+\/video\/([0-9]{8,25})/i) ??
    url.match(/^https:\/\/(?:www\.)?tiktok\.com\/embed\/(?:v2\/)?([0-9]{8,25})/i);
  if (tiktok) return { provider: "tiktok", id: tiktok[1] };

  return null;
}

export function videoLinkProblem(value: string): string | null {
  const url = value.trim();
  if (!url) return null;
  if (/^https:\/\/(vm|vt)\.tiktok\.com\//i.test(url)) {
    return "That is a TikTok short link. Open the video in a browser and copy the full link that includes /video/.";
  }
  if (!parseVideoLink(url)) return "Paste a link to a public YouTube, Instagram, or TikTok video.";
  return null;
}

export function embedUrl(provider: VideoProvider, id: string): string {
  if (provider === "youtube") return `https://www.youtube-nocookie.com/embed/${id}?rel=0&modestbranding=1&playsinline=1`;
  if (provider === "instagram") return `https://www.instagram.com/p/${id}/embed/`;
  return `https://www.tiktok.com/embed/v2/${id}`;
}

export function providerLabel(provider: VideoProvider): string {
  return provider === "youtube" ? "YouTube" : provider === "instagram" ? "Instagram" : "TikTok";
}

// Vertical platforms need a taller frame than YouTube.
export function isVerticalProvider(provider: VideoProvider, url?: string | null): boolean {
  if (provider === "youtube") return Boolean(url && /youtube\.com\/shorts\//i.test(url));
  return true;
}

export function youtubeThumbnail(id: string): string {
  return `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
}
