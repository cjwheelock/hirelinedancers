"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { InstructorContactLink } from "@/components/InstructorContactLink";
import {
  CalendarCheck,
  Clock,
  Headphones,
  MapPin,
  Mic2,
  Music,
  ShieldCheck,
  Speaker,
  Users
} from "lucide-react";
import { SpotifyTrack } from "@/components/SpotifyTrack";
import { eventTypes } from "@/data/site";
import {
  getMarketplaceClient,
  marketplaceConfigured,
  type InstructorProfile
} from "@/lib/marketplace";
import styles from "./profile.module.css";

type PublicInstructorProfile = Pick<
  InstructorProfile,
  | "id"
  | "slug"
  | "display_name"
  | "business_name"
  | "headline"
  | "bio"
  | "city"
  | "region"
  | "travel_radius_miles"
  | "years_teaching"
  | "max_group_size"
  | "styles"
  | "event_types"
  | "age_groups"
  | "languages"
  | "favorite_song_name"
  | "favorite_song_spotify_url"
  | "provides_speakers"
  | "provides_microphone"
  | "provides_music_playback"
  | "liability_insurance_status"
  | "preferred_response_hours"
>;

type ProfileMedia = {
  id: string;
  instructor_profile_id: string;
  media_type: "headshot" | "image" | "welcome_video" | "video";
  storage_path: string | null;
  external_url: string | null;
  mime_type: string | null;
  caption: string | null;
  alt_text: string | null;
  sort_order: number;
};

const publicProfileFields = [
  "id",
  "slug",
  "display_name",
  "business_name",
  "headline",
  "bio",
  "city",
  "region",
  "travel_radius_miles",
  "years_teaching",
  "max_group_size",
  "styles",
  "event_types",
  "age_groups",
  "languages",
  "favorite_song_name",
  "favorite_song_spotify_url",
  "provides_speakers",
  "provides_microphone",
  "provides_music_playback",
  "liability_insurance_status",
  "preferred_response_hours"
].join(",");

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function safeExternalUrl(value: string | null) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function mediaUrl(item: ProfileMedia) {
  const external = safeExternalUrl(item.external_url);
  if (external) return external;
  const client = getMarketplaceClient();
  if (!client || !item.storage_path) return null;
  return client.storage.from("instructor-media").getPublicUrl(item.storage_path).data.publicUrl;
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function readableLabel(value: string) {
  return value
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function eventLabel(value: string) {
  return eventTypes.find((event) => event.slug === value)?.label ?? readableLabel(value);
}

function insuranceCopy(status: PublicInstructorProfile["liability_insurance_status"]) {
  if (status === "available") {
    return "Liability insurance is available. Ask the instructor for current documentation and confirm the venue’s requirements.";
  }
  if (status === "required_per_event") {
    return "Insurance is arranged when an event requires it. Confirm documentation, timing, and any related costs directly with the instructor.";
  }
  return "Insurance information has not been provided to Hire Line Dancers. Ask the instructor directly and confirm the venue’s requirements before booking.";
}

function setupCopy(label: string, value: boolean | null) {
  if (value === true) return `${label} can be provided by the instructor.`;
  if (value === false) return `Plan for the venue or event team to provide ${label.toLowerCase()}.`;
  return `Confirm ${label.toLowerCase()} with the instructor for this event.`;
}

function MediaGallery({ media, instructorName }: { media: ProfileMedia[]; instructorName: string }) {
  const galleryMedia = media.filter((item) => item.media_type !== "headshot");
  if (!galleryMedia.length) return null;

  return (
    <section className={styles.section} aria-labelledby="profile-media-heading">
      <p className={styles.kicker}>Photos and videos</p>
      <h2 id="profile-media-heading">See {instructorName} teach and dance</h2>
      <div className={styles.mediaGrid}>
        {galleryMedia.map((item) => {
          const url = mediaUrl(item);
          if (!url) return null;
          const isVideo = item.media_type === "video" || item.media_type === "welcome_video";
          const isDirectVideo = Boolean(
            item.storage_path ||
            item.mime_type?.startsWith("video/") ||
            /\.(mp4|m4v|webm|ogg|mov)(?:[?#]|$)/i.test(url)
          );

          return (
            <figure className={styles.mediaItem} key={item.id}>
              {isVideo && isDirectVideo ? (
                <video className={styles.media} src={url} controls playsInline preload="metadata">
                  Your browser does not support this video.
                </video>
              ) : isVideo ? (
                <a className={styles.videoLink} href={url} target="_blank" rel="noopener noreferrer">
                  <Music size={28} aria-hidden="true" />
                  <span>Open {item.media_type === "welcome_video" ? "welcome video" : "teaching video"}</span>
                </a>
              ) : (
                // Profile media is uploaded at runtime and cannot use Next Image during static export.
                // eslint-disable-next-line @next/next/no-img-element
                <img className={styles.media} src={url} alt={item.alt_text || `${instructorName} teaching line dancing`} />
              )}
              {item.caption ? <figcaption>{item.caption}</figcaption> : null}
            </figure>
          );
        })}
      </div>
    </section>
  );
}

export function PublicProfile() {
  const [profile, setProfile] = useState<PublicInstructorProfile | null>(null);
  const [media, setMedia] = useState<ProfileMedia[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const identifier = new URLSearchParams(window.location.search).get("instructor")?.trim();
    if (!identifier) {
      setError("Choose a published instructor from the directory to view a profile.");
      setLoading(false);
      return;
    }
    const profileIdentifier = identifier;
    if (!marketplaceConfigured) {
      setError("The live instructor directory is not connected in this build.");
      setLoading(false);
      return;
    }

    const client = getMarketplaceClient();
    if (!client) {
      setError("The instructor directory is not available right now.");
      setLoading(false);
      return;
    }
    const marketplaceClient = client;

    let active = true;
    async function loadProfile() {
      let query = marketplaceClient
        .from("instructor_directory_profiles")
        .select(publicProfileFields);
      query = isUuid(profileIdentifier) ? query.eq("id", profileIdentifier) : query.eq("slug", profileIdentifier);

      const { data: profileData, error: profileError } = await query.maybeSingle();
      if (!active) return;
      if (profileError || !profileData) {
        setError("This published instructor profile could not be found.");
        setLoading(false);
        return;
      }

      const publicProfile = profileData as unknown as PublicInstructorProfile;
      const { data: mediaData, error: mediaError } = await marketplaceClient
        .from("profile_media")
        .select("id,instructor_profile_id,media_type,storage_path,external_url,mime_type,caption,alt_text,sort_order")
        .eq("instructor_profile_id", publicProfile.id)
        .eq("status", "ready")
        .order("sort_order");

      if (!active) return;
      if (mediaError) {
        setError("This instructor’s media could not be loaded right now.");
        setLoading(false);
        return;
      }

      setProfile(publicProfile);
      setMedia((mediaData ?? []) as ProfileMedia[]);
      setLoading(false);
    }

    void loadProfile();
    return () => {
      active = false;
    };
  }, []);

  if (loading) {
    return (
      <section className={styles.state} role="status">
        <p className={styles.kicker}>Instructor profile</p>
        <h1>Loading profile</h1>
        <p>We are retrieving this instructor’s published information.</p>
      </section>
    );
  }

  if (error || !profile) {
    return (
      <section className={styles.state}>
        <p className={styles.kicker}>Instructor directory</p>
        <h1>Profile unavailable</h1>
        <p>{error}</p>
        <Link className={styles.primaryButton} href="/instructors/">Browse published instructors</Link>
      </section>
    );
  }

  const identifier = profile.slug || profile.id;
  const headshot = media.find((item) => item.media_type === "headshot");
  const headshotUrl = headshot ? mediaUrl(headshot) : null;
  const location = [profile.city, profile.region].filter(Boolean).join(", ") || "Service area available on request";

  return (
    <main className={styles.shell}>
      <section className={styles.hero}>
        <div className={styles.headshot} aria-hidden={headshotUrl ? undefined : "true"}>
          {headshotUrl ? (
            // Profile media is uploaded at runtime and cannot use Next Image during static export.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={headshotUrl} alt={headshot?.alt_text || `${profile.display_name}, line dance instructor`} />
          ) : initials(profile.display_name)}
        </div>
        <div className={styles.heroCopy}>
          <p className={styles.kicker}>Published instructor profile</p>
          <h1>{profile.display_name}</h1>
          {profile.business_name ? <p className={styles.business}>{profile.business_name}</p> : null}
          <p className={styles.headline}>{profile.headline || "Beginner-friendly line dance instruction for events and programs."}</p>
          <div className={styles.heroTags}>
            <span><MapPin size={16} aria-hidden="true" /> {location}</span>
            {profile.max_group_size ? <span><Users size={16} aria-hidden="true" /> Groups up to {profile.max_group_size}</span> : null}
            {profile.years_teaching !== null ? <span><Clock size={16} aria-hidden="true" /> {profile.years_teaching} years teaching</span> : null}
          </div>
        </div>
      </section>

      <div className={styles.layout}>
        <div className={styles.content}>
          {profile.bio ? (
            <section className={styles.section} aria-labelledby="about-instructor-heading">
              <p className={styles.kicker}>About the instructor</p>
              <h2 id="about-instructor-heading">Meet {profile.display_name}</h2>
              <p className={styles.bodyCopy}>{profile.bio}</p>
            </section>
          ) : null}

          <MediaGallery media={media} instructorName={profile.display_name} />

          <section className={styles.section} aria-labelledby="services-heading">
            <p className={styles.kicker}>Services and fit</p>
            <h2 id="services-heading">What {profile.display_name} offers</h2>
            <div className={styles.serviceGroups}>
              {profile.event_types.length > 0 ? (
                <div>
                  <h3>Events and programs</h3>
                  <div className={styles.tags}>{profile.event_types.map((item) => <span key={item}>{eventLabel(item)}</span>)}</div>
                </div>
              ) : null}
              {profile.styles.length > 0 ? (
                <div>
                  <h3>Dance styles</h3>
                  <div className={styles.tags}>{profile.styles.map((item) => <span key={item}>{item}</span>)}</div>
                </div>
              ) : null}
              {profile.age_groups.length > 0 ? (
                <div>
                  <h3>Age groups</h3>
                  <div className={styles.tags}>{profile.age_groups.map((item) => <span key={item}>{readableLabel(item)}</span>)}</div>
                </div>
              ) : null}
              {profile.languages.length > 0 ? (
                <div>
                  <h3>Languages</h3>
                  <div className={styles.tags}>{profile.languages.map((item) => <span key={item}>{item}</span>)}</div>
                </div>
              ) : null}
            </div>
            {profile.travel_radius_miles !== null && profile.city ? (
              <p className={styles.bodyCopy}>{profile.display_name} lists a travel radius of about {profile.travel_radius_miles} miles from {profile.city}. Confirm the exact venue and any travel terms directly.</p>
            ) : null}
          </section>

          <section className={styles.section} aria-labelledby="equipment-heading">
            <p className={styles.kicker}>Event preparation</p>
            <h2 id="equipment-heading">Equipment and insurance</h2>
            <div className={styles.detailList}>
              <div><Speaker size={21} aria-hidden="true" /><span>{setupCopy("Speakers", profile.provides_speakers)}</span></div>
              <div><Mic2 size={21} aria-hidden="true" /><span>{setupCopy("A microphone", profile.provides_microphone)}</span></div>
              <div><Headphones size={21} aria-hidden="true" /><span>{setupCopy("Music playback", profile.provides_music_playback)}</span></div>
              <div><ShieldCheck size={21} aria-hidden="true" /><span>{insuranceCopy(profile.liability_insurance_status)}</span></div>
            </div>
          </section>

          {profile.favorite_song_name || profile.favorite_song_spotify_url ? (
            <SpotifyTrack
              instructorName={profile.display_name}
              song={profile.favorite_song_name ?? undefined}
              spotifyUrl={profile.favorite_song_spotify_url ?? undefined}
            />
          ) : null}
        </div>

        <aside className={styles.contactCard}>
          <CalendarCheck size={30} aria-hidden="true" />
          <p className={styles.kicker}>Check availability</p>
          <h2>Tell {profile.display_name} about your event.</h2>
          <p>Send the date, location, group size, and event details. The instructor will reply directly with availability, rates, and next steps.</p>
          <InstructorContactLink instructorIdentifier={identifier} className={styles.primaryButton}>Contact this instructor</InstructorContactLink>
          <p className={styles.finePrint}>You can browse without an account. Sign in is required when you send an inquiry so you can track its status.</p>
          <p className={styles.finePrint}>Hire Line Dancers does not handle instructor contracts or event payments. Confirm all terms directly before booking.</p>
          <p className={styles.response}><Clock size={15} aria-hidden="true" /> Preferred response window: about {profile.preferred_response_hours} hours</p>
        </aside>
      </div>
    </main>
  );
}
