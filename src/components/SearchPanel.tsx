"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { CalendarDays, MapPin, Search, Users } from "lucide-react";
import { cities, eventTypes, instructors, type Instructor } from "@/data/site";
import {
  getMarketplaceClient,
  marketplaceConfigured,
  type InstructorProfile
} from "@/lib/marketplace";

type PublicProfile = Pick<
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
  | "provides_speakers"
  | "provides_microphone"
  | "provides_music_playback"
  | "liability_insurance_status"
  | "preferred_response_hours"
> & {
  headshotUrl: string | null;
  headshotAlt: string | null;
};

type PublicMediaRow = {
  id: string;
  instructor_profile_id: string;
  media_type: "headshot" | "image" | "welcome_video" | "video";
  storage_path: string | null;
  external_url: string | null;
  alt_text: string | null;
  sort_order: number;
};

type PublicInstructorResultsProps = {
  citySlug?: string;
  eventSlug?: string;
  groupSize?: number;
  compact?: boolean;
  darkBackground?: boolean;
  showExamplesWhenUnconfigured?: boolean;
  emptyTitle?: string;
  emptyBody?: string;
  onCountChange?: (count: number | null) => void;
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
  "provides_speakers",
  "provides_microphone",
  "provides_music_playback",
  "liability_insurance_status",
  "preferred_response_hours"
].join(",");

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
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

function mediaUrl(item: PublicMediaRow) {
  const external = safeExternalUrl(item.external_url);
  if (external) return external;
  const client = getMarketplaceClient();
  if (!client || !item.storage_path) return null;
  return client.storage.from("instructor-media").getPublicUrl(item.storage_path).data.publicUrl;
}

function locationLabel(profile: Pick<PublicProfile, "city" | "region">) {
  return [profile.city, profile.region].filter(Boolean).join(", ") || "Service area available on request";
}

function marketMatches(profile: Pick<PublicProfile, "city" | "region">, citySlug?: string) {
  if (!citySlug) return true;
  const market = cities.find((item) => item.slug === citySlug);
  if (!market) return false;
  const profileCity = profile.city?.trim().toLowerCase();
  const marketCities = [market.city, ...market.serviceCities].map((item) => item.trim().toLowerCase());
  return Boolean(profileCity && marketCities.includes(profileCity));
}

function exampleMarketMatches(instructor: Instructor, citySlug?: string) {
  if (!citySlug) return true;
  const market = cities.find((item) => item.slug === citySlug);
  return Boolean(market?.serviceCities.includes(instructor.city));
}

function PublicProfileCard({ profile, compact = false }: { profile: PublicProfile; compact?: boolean }) {
  const identifier = profile.slug || profile.id;
  const profileHref = `/profile/?${new URLSearchParams({ instructor: identifier }).toString()}`;
  const highlights = [
    ...profile.styles,
    profile.provides_speakers ? "Can provide speakers" : null,
    profile.provides_microphone ? "Can provide a microphone" : null
  ].filter((value): value is string => Boolean(value));

  return (
    <article className={compact ? "instructor-card compact" : "instructor-card"}>
      <div className="card-top">
        <div className="avatar" aria-hidden={profile.headshotUrl ? undefined : "true"}>
          {profile.headshotUrl ? (
            // Profile media is uploaded at runtime and cannot use Next Image during static export.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={profile.headshotUrl} alt={profile.headshotAlt || `${profile.display_name}, line dance instructor`} />
          ) : (
            initials(profile.display_name)
          )}
        </div>
        <div className="card-title-row">
          <div>
            <h3><Link href={profileHref}>{profile.display_name}</Link></h3>
            <p className="card-sub">
              {profile.business_name ? `${profile.business_name} · ` : ""}{locationLabel(profile)}
            </p>
          </div>
          <span className="pill">Published profile</span>
        </div>
      </div>

      <p className="muted">
        {profile.years_teaching === null ? "Teaching experience listed on profile" : `${profile.years_teaching} years teaching`}
        {profile.travel_radius_miles === null ? "" : ` · travels about ${profile.travel_radius_miles} miles`}
      </p>

      <p className="bio">{profile.headline || profile.bio || "Beginner-friendly line dance instruction for events and programs."}</p>

      {highlights.length > 0 ? (
        <div className="tag-row">
          {highlights.slice(0, compact ? 2 : 3).map((highlight) => <span key={highlight}>{highlight}</span>)}
        </div>
      ) : null}

      <Link className="button secondary small" href={profileHref}>
        <MapPin size={15} aria-hidden="true" /> View profile and check availability
      </Link>
    </article>
  );
}

function ExampleProfileCard({ instructor, compact = false }: { instructor: Instructor; compact?: boolean }) {
  return (
    <article className={compact ? "instructor-card compact" : "instructor-card"}>
      <div className="card-top">
        <div className="avatar" aria-hidden="true">{initials(instructor.name)}</div>
        <div className="card-title-row">
          <div>
            <h3>{instructor.name}</h3>
            <p className="card-sub">{instructor.business} · {instructor.city}, {instructor.state}</p>
          </div>
          <span className="pill">Example profile</span>
        </div>
      </div>
      <p className="muted">Illustrative directory preview</p>
      <p className="bio">{instructor.bio}</p>
      <div className="tag-row">
        {instructor.tags.slice(0, compact ? 2 : 3).map((tag) => <span key={tag}>{tag}</span>)}
      </div>
      <Link className="button secondary small" href="/instructors/join/">
        Are you an instructor? Apply to join
      </Link>
    </article>
  );
}

export function PublicInstructorResults({
  citySlug,
  eventSlug,
  groupSize = 0,
  compact = false,
  darkBackground = false,
  showExamplesWhenUnconfigured = false,
  emptyTitle = "No published instructor matches yet.",
  emptyBody = "Try another filter, or check back as new instructors are approved.",
  onCountChange
}: PublicInstructorResultsProps) {
  const [profiles, setProfiles] = useState<PublicProfile[]>([]);
  const [loading, setLoading] = useState(marketplaceConfigured);
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    if (!marketplaceConfigured) {
      setLoading(false);
      return;
    }

    const client = getMarketplaceClient();
    if (!client) {
      setLoading(false);
      setLoadFailed(true);
      return;
    }
    const marketplaceClient = client;

    let active = true;
    async function loadProfiles() {
      const { data: profileRows, error: profileError } = await marketplaceClient
        .from("instructor_directory_profiles")
        .select(publicProfileFields)
        .eq("status", "published")
        .order("display_name");

      if (!active) return;
      if (profileError) {
        setLoadFailed(true);
        setLoading(false);
        return;
      }

      const publicProfiles = (profileRows ?? []) as unknown as Omit<PublicProfile, "headshotUrl" | "headshotAlt">[];
      const profileIds = publicProfiles.map((profile) => profile.id);
      let mediaRows: PublicMediaRow[] = [];

      if (profileIds.length > 0) {
        const { data: mediaData, error: mediaError } = await marketplaceClient
          .from("profile_media")
          .select("id,instructor_profile_id,media_type,storage_path,external_url,alt_text,sort_order")
          .eq("status", "ready")
          .in("instructor_profile_id", profileIds)
          .order("sort_order");

        if (!active) return;
        if (mediaError) {
          setLoadFailed(true);
          setLoading(false);
          return;
        }
        mediaRows = (mediaData ?? []) as PublicMediaRow[];
      }

      setProfiles(publicProfiles.map((profile) => {
        const headshot = mediaRows.find((item) => item.instructor_profile_id === profile.id && item.media_type === "headshot");
        return {
          ...profile,
          headshotUrl: headshot ? mediaUrl(headshot) : null,
          headshotAlt: headshot?.alt_text ?? null
        };
      }));
      setLoadFailed(false);
      setLoading(false);
    }

    void loadProfiles();
    return () => {
      active = false;
    };
  }, []);

  const results = useMemo(() => profiles
    .filter((profile) => {
      const cityMatch = marketMatches(profile, citySlug);
      const eventMatch = !eventSlug || profile.event_types.includes(eventSlug);
      const groupMatch = !groupSize || (profile.max_group_size ?? 0) >= groupSize;
      return cityMatch && eventMatch && groupMatch;
    })
    .sort((a, b) => (b.years_teaching ?? 0) - (a.years_teaching ?? 0) || a.display_name.localeCompare(b.display_name)), [citySlug, eventSlug, groupSize, profiles]);

  const exampleResults = useMemo(() => instructors
    .filter((instructor) => {
      const cityMatch = exampleMarketMatches(instructor, citySlug);
      const eventMatch = !eventSlug || instructor.events.includes(eventSlug);
      const groupMatch = !groupSize || instructor.groupSize >= groupSize;
      return cityMatch && eventMatch && groupMatch;
    })
    .sort((a, b) => Number(b.featured) - Number(a.featured) || b.years - a.years), [citySlug, eventSlug, groupSize]);

  const visibleCount = marketplaceConfigured ? results.length : showExamplesWhenUnconfigured ? exampleResults.length : 0;

  useEffect(() => {
    onCountChange?.(loading ? null : visibleCount);
  }, [loading, onCountChange, visibleCount]);

  const stateClass = darkBackground ? "empty-state" : "policy-box";

  if (loading) {
    return (
      <div className={stateClass} role="status">
        <h3>Loading published instructors</h3>
        <p>We are checking the directory for profiles that fit your event.</p>
      </div>
    );
  }

  if (loadFailed) {
    return (
      <div className={stateClass} role="status">
        <h3>We could not load the directory</h3>
        <p>Please try again soon. Your filters have not been submitted.</p>
      </div>
    );
  }

  if (!marketplaceConfigured && showExamplesWhenUnconfigured) {
    if (!exampleResults.length) {
      return (
        <div className={stateClass}>
          <h3>{emptyTitle}</h3>
          <p>{emptyBody}</p>
        </div>
      );
    }
    return (
      <>
        <div className={stateClass}>
          <h3>Example profiles</h3>
          <p>These illustrative profiles preview how the directory will work. They are not active instructor listings.</p>
        </div>
        {exampleResults.map((instructor) => (
          <ExampleProfileCard key={instructor.slug} instructor={instructor} compact={compact} />
        ))}
      </>
    );
  }

  if (!marketplaceConfigured) {
    return (
      <div className={stateClass}>
        <h3>Published profiles are coming soon</h3>
        <p>The live directory is not connected in this build. Instructors can apply now to be considered for launch.</p>
      </div>
    );
  }

  if (!results.length) {
    return (
      <div className={stateClass}>
        <h3>{emptyTitle}</h3>
        <p>{emptyBody}</p>
      </div>
    );
  }

  return <>{results.map((profile) => <PublicProfileCard key={profile.id} profile={profile} compact={compact} />)}</>;
}

export function InstructorDirectoryBrowser() {
  const [city, setCity] = useState("");
  const [event, setEvent] = useState("");
  const [groupSize, setGroupSize] = useState("");
  const [resultCount, setResultCount] = useState<number | null>(null);

  return (
    <div className="search-grid">
      <form className="search-form" onSubmit={(submitEvent) => submitEvent.preventDefault()}>
        <label>
          <span><MapPin size={16} aria-hidden="true" /> Service market</span>
          <select value={city} onChange={(changeEvent) => setCity(changeEvent.target.value)}>
            <option value="">All launch markets</option>
            {cities.map((item) => <option key={item.slug} value={item.slug}>{item.city}, {item.state}</option>)}
          </select>
        </label>
        <label>
          <span><CalendarDays size={16} aria-hidden="true" /> Event or program</span>
          <select value={event} onChange={(changeEvent) => setEvent(changeEvent.target.value)}>
            <option value="">Any event or program</option>
            {eventTypes.map((item) => <option key={item.slug} value={item.slug}>{item.label}</option>)}
          </select>
        </label>
        <label>
          <span><Users size={16} aria-hidden="true" /> Approximate group size</span>
          <input value={groupSize} onChange={(changeEvent) => setGroupSize(changeEvent.target.value)} type="number" min="1" placeholder="Any size" />
        </label>
        <button className="button primary" type="submit" disabled={resultCount === null}>
          <Search size={18} aria-hidden="true" />
          {resultCount === null ? "Loading instructors" : `${resultCount} published instructor${resultCount === 1 ? "" : "s"}`}
        </button>
      </form>
      <div className="results-list" aria-live="polite">
        <PublicInstructorResults
          citySlug={city || undefined}
          eventSlug={event || undefined}
          groupSize={Number(groupSize || 0)}
          onCountChange={setResultCount}
        />
      </div>
    </div>
  );
}

export function SearchPanel() {
  const [city, setCity] = useState("nashville-tn");
  const [event, setEvent] = useState("");
  const [groupSize, setGroupSize] = useState("100");
  const [resultCount, setResultCount] = useState<number | null>(null);
  const selectedEvent = eventTypes.find((item) => item.slug === event);

  return (
    <section className="search-section" id="find">
      <div className="section-heading">
        <p className="eyebrow">Find your match</p>
        <h2>Tell us about your event. We&rsquo;ll show you who&rsquo;s nearby.</h2>
        <p>Pick your city, the kind of event or program, and roughly how many guests. We&rsquo;ll show you published instructors whose experience fits the request.</p>
      </div>
      <div className="search-grid">
        <form className="search-form" onSubmit={(submitEvent) => submitEvent.preventDefault()}>
          <label>
            <span><MapPin size={16} aria-hidden="true" /> Your city</span>
            <select value={city} onChange={(changeEvent) => setCity(changeEvent.target.value)}>
              {cities.map((item) => (
                <option key={item.slug} value={item.slug}>{item.city}, {item.state}</option>
              ))}
            </select>
          </label>
          <label>
            <span><CalendarDays size={16} aria-hidden="true" /> Type of event or program</span>
            <select value={event} onChange={(changeEvent) => setEvent(changeEvent.target.value)}>
              <option value="">Any event or program</option>
              {eventTypes.map((item) => (
                <option key={item.slug} value={item.slug}>{item.label}</option>
              ))}
            </select>
          </label>
          <label>
            <span><Users size={16} aria-hidden="true" /> Approximate group size</span>
            <input value={groupSize} onChange={(changeEvent) => setGroupSize(changeEvent.target.value)} type="number" min="1" />
          </label>
          <button className="button primary" type="submit" disabled={resultCount === null}>
            <Search size={18} aria-hidden="true" />
            {resultCount === null ? "Loading instructors" : `Show ${resultCount} instructor${resultCount === 1 ? "" : "s"} near me`}
          </button>
        </form>
        <div className="results-list" aria-live="polite">
          <PublicInstructorResults
            citySlug={city}
            eventSlug={event || undefined}
            groupSize={Number(groupSize || 0)}
            compact
            darkBackground
            showExamplesWhenUnconfigured
            emptyTitle="No instructor has listed this fit just yet."
            emptyBody={selectedEvent
              ? `We do not have a ${selectedEvent.label.toLowerCase()} match in this city yet. Try another filter or check back as instructors join.`
              : "We do not have a match for this group size in this city yet. Try another filter or check back as instructors join."}
            onCountChange={setResultCount}
          />
        </div>
      </div>
    </section>
  );
}
