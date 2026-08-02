const SPOTIFY_TRACK_PATH = /^\/(?:(?:intl-[a-z]{2}(?:-[a-z]{2})?)\/)?(?:embed\/)?track\/([A-Za-z0-9]{22})\/?$/i;
const MAX_SPOTIFY_URL_LENGTH = 512;

export type SpotifyTrackLinks = {
  trackId: string;
  openUrl: string;
  embedUrl: string;
};

/**
 * Accept a Spotify track share or embed URL and return trusted canonical URLs.
 * Other Spotify entity types and non-Spotify hosts are rejected.
 */
export function getSpotifyTrackLinks(value: string | null | undefined): SpotifyTrackLinks | null {
  const candidate = value?.trim();
  if (!candidate || candidate.length > MAX_SPOTIFY_URL_LENGTH) return null;

  try {
    const url = new URL(candidate);
    if (
      url.protocol !== "https:"
      || url.hostname.toLowerCase() !== "open.spotify.com"
      || url.username
      || url.password
      || url.port
    ) return null;

    const match = url.pathname.match(SPOTIFY_TRACK_PATH);
    if (!match) return null;

    const trackId = match[1];
    return {
      trackId,
      openUrl: `https://open.spotify.com/track/${trackId}`,
      embedUrl: `https://open.spotify.com/embed/track/${trackId}?utm_source=oembed`
    };
  } catch {
    return null;
  }
}
