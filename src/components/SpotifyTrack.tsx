import { ExternalLink, Music2 } from "lucide-react";
import { getSpotifyTrackLinks } from "@/lib/spotify";

export function SpotifyTrack({
  instructorName,
  song,
  spotifyUrl,
  note
}: {
  instructorName: string;
  song?: string;
  spotifyUrl?: string;
  note?: string;
}) {
  const track = getSpotifyTrackLinks(spotifyUrl);
  if (!song && !track) return null;

  const playerTitle = song
    ? `Spotify player for ${song}`
    : `Spotify player for ${instructorName}'s favorite line dance song`;

  return (
    <section className="favorite-song" aria-labelledby="favorite-song-heading">
      <div className="favorite-song-intro">
        <span className="favorite-song-icon" aria-hidden="true"><Music2 size={21} /></span>
        <div>
          <p className="favorite-song-label">Favorite line dance song</p>
          <h2 id="favorite-song-heading">{song || `${instructorName}'s pick`}</h2>
        </div>
      </div>
      {note ? <p className="favorite-song-note">{note}</p> : null}
      {track && (
        <>
          <iframe
            className="spotify-player"
            src={track.embedUrl}
            width="100%"
            height="152"
            frameBorder="0"
            allowFullScreen
            allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
            loading="lazy"
            referrerPolicy="strict-origin-when-cross-origin"
            title={playerTitle}
          />
          <a
            className="spotify-link"
            href={track.openUrl}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Open this song on Spotify in a new tab"
          >
            Open this song on Spotify <ExternalLink size={14} aria-hidden="true" />
          </a>
        </>
      )}
    </section>
  );
}
