"use client";

import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { eventTypes } from "@/data/site";
import { useMarketplaceSession } from "@/hooks/useMarketplaceSession";
import {
  getMarketplaceClient,
  loginUrl,
  normalizePhone,
  readableError,
  type AccountRole,
  type InstructorPrivateSettings,
  type InstructorProfile,
  type MarketplaceAccount,
  type MarketplaceInquiry
} from "@/lib/marketplace";
import styles from "./Marketplace.module.css";

const danceStyles = [
  "Country line dancing",
  "Country swing",
  "Soul line dancing",
  "Pop line dancing",
  "Latin line dancing",
  "Beginner group instruction"
];

type ProfileMedia = {
  id: string;
  media_type: "headshot" | "image" | "welcome_video" | "video";
  storage_path: string | null;
  external_url: string | null;
  caption: string | null;
  status: string;
  sort_order: number;
};

export function AccountWorkspace() {
  const { session, account, loading, error, configured, refresh } = useMarketplaceSession();
  const [signingOut, setSigningOut] = useState(false);

  async function signOut() {
    const client = getMarketplaceClient();
    if (!client) return;
    setSigningOut(true);
    await client.auth.signOut();
    window.location.replace("/");
  }

  if (loading) return <div className={styles.loading}>Loading your account...</div>;

  if (!configured) {
    return (
      <section className={`${styles.shell} ${styles.narrow}`}>
        <p className={styles.eyebrow}>Account setup</p>
        <h1 className={styles.title}>Almost ready</h1>
        <p className={styles.error}>Supabase credentials were not included in this build.</p>
      </section>
    );
  }

  if (!session) {
    return (
      <section className={`${styles.shell} ${styles.narrow}`}>
        <p className={styles.eyebrow}>Your account</p>
        <h1 className={styles.title}>Sign in to continue</h1>
        <p className={styles.subtitle}>Manage your instructor profile or keep track of the instructors you contacted.</p>
        <div className={styles.buttonRow} style={{ marginTop: 28 }}>
          <a className={styles.button} href={loginUrl("/account/")}>Sign in</a>
        </div>
      </section>
    );
  }

  if (!account?.role) {
    return (
      <section className={`${styles.shell} ${styles.narrow}`}>
        <p className={styles.eyebrow}>One quick step</p>
        <h1 className={styles.title}>How will you use Hire Line Dancers?</h1>
        <p className={styles.subtitle}>Choose the account workspace you need. You can contact support later if you need both.</p>
        {error ? <p className={styles.error}>{error}</p> : null}
        <OnboardingForm
          email={session.user.email ?? ""}
          initialName={account?.full_name ?? session.user.user_metadata.full_name ?? ""}
          onComplete={() => void refresh()}
        />
      </section>
    );
  }

  return (
    <section className={styles.shell}>
      <div className={styles.topbar}>
        <div>
          <p className={styles.eyebrow}>{account.role === "instructor" ? "Instructor workspace" : "Planner workspace"}</p>
          <h1>Welcome, {account.full_name?.split(" ")[0] || "there"}</h1>
          <p className={styles.muted}>{account.email}</p>
        </div>
        <button className={styles.secondaryButton} type="button" disabled={signingOut} onClick={() => void signOut()}>
          {signingOut ? "Signing out..." : "Sign out"}
        </button>
      </div>

      {account.role === "instructor" ? <InstructorDashboard account={account} /> : null}
      {account.role === "organizer" ? <OrganizerDashboard /> : null}
      {account.role === "admin" ? <AdminDashboard /> : null}
    </section>
  );
}

function OnboardingForm({
  email,
  initialName,
  onComplete
}: {
  email: string;
  initialName: string;
  onComplete: () => void;
}) {
  const [role, setRole] = useState<AccountRole>("organizer");
  const [name, setName] = useState(initialName);
  const [company, setCompany] = useState("");
  const [phone, setPhone] = useState("");
  const [smsOptIn, setSmsOptIn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const client = getMarketplaceClient();
    if (!client) return;
    const normalizedPhone = normalizePhone(phone);
    if (phone.trim() && !normalizedPhone) {
      setError("Enter a mobile number in international format, such as +14155551234.");
      return;
    }
    if (smsOptIn && !normalizedPhone) {
      setError("Add a valid mobile number before enabling text alerts.");
      return;
    }

    setBusy(true);
    setError(null);
    const { error: rpcError } = await client.rpc("complete_account_onboarding", {
      p_role: role,
      p_full_name: name.trim(),
      p_company_name: company.trim() || null,
      p_phone_e164: normalizedPhone,
      p_sms_opt_in: smsOptIn
    });
    setBusy(false);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    onComplete();
  }

  return (
    <form className={`${styles.card} ${styles.stack}`} onSubmit={submit}>
      <div className={styles.roleGrid}>
        <label className={styles.roleOption}>
          <input type="radio" name="role" checked={role === "organizer"} onChange={() => setRole("organizer")} />
          <strong>I am planning an event</strong>
          <span>Contact instructors and keep your inquiries organized.</span>
        </label>
        <label className={styles.roleOption}>
          <input type="radio" name="role" checked={role === "instructor"} onChange={() => setRole("instructor")} />
          <strong>I teach line dancing</strong>
          <span>Build a profile, receive inquiries, and manage your availability.</span>
        </label>
      </div>

      <label className={styles.field}>
        <span>Full name</span>
        <input required autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} />
      </label>
      <label className={styles.field}>
        <span>Email</span>
        <input value={email} disabled />
      </label>
      <label className={styles.field}>
        <span>{role === "organizer" ? "Company or organization (optional)" : "Business name (optional)"}</span>
        <input autoComplete="organization" value={company} onChange={(event) => setCompany(event.target.value)} />
      </label>
      {role === "instructor" ? (
        <>
          <label className={styles.field}>
            <span>Mobile number (optional)</span>
            <input
              type="tel"
              autoComplete="tel"
              placeholder="+14155551234"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
            />
          </label>
          <label className={styles.check}>
            <input type="checkbox" checked={smsOptIn} onChange={(event) => setSmsOptIn(event.target.checked)} />
            <span>Text me when I receive a new inquiry. Message and data rates may apply. Reply STOP to opt out.</span>
          </label>
        </>
      ) : null}
      {error ? <p className={styles.error} role="alert">{error}</p> : null}
      <button className={styles.button} disabled={busy} type="submit">
        {busy ? "Saving..." : "Open my account"}
      </button>
    </form>
  );
}

function InstructorDashboard({ account }: { account: MarketplaceAccount }) {
  const [tab, setTab] = useState<"profile" | "media" | "inquiries" | "membership">("profile");
  const [profile, setProfile] = useState<InstructorProfile | null>(null);
  const [settings, setSettings] = useState<InstructorPrivateSettings | null>(null);
  const [inquiries, setInquiries] = useState<MarketplaceInquiry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const client = getMarketplaceClient();
    if (!client) return;
    setLoading(true);
    setError(null);

    const { data: profileData, error: profileError } = await client
      .from("instructor_profiles")
      .select("*")
      .eq("account_id", account.id)
      .maybeSingle();
    if (profileError) {
      setError(profileError.message);
      setLoading(false);
      return;
    }

    const loadedProfile = profileData as InstructorProfile | null;
    setProfile(loadedProfile);
    if (loadedProfile) {
      const [privateResult, inquiryResult] = await Promise.all([
        client.from("instructor_private_settings").select("*").eq("instructor_profile_id", loadedProfile.id).maybeSingle(),
        client.from("inquiries").select("*").eq("instructor_profile_id", loadedProfile.id).order("created_at", { ascending: false })
      ]);
      if (privateResult.error) setError(privateResult.error.message);
      setSettings(privateResult.data as InstructorPrivateSettings | null);
      setInquiries((inquiryResult.data as MarketplaceInquiry[] | null) ?? []);
    }
    setLoading(false);
  }

  useEffect(() => {
    void load();
  }, [account.id]);

  return (
    <>
      <div className={styles.tabs} role="tablist" aria-label="Instructor account sections">
        {(["profile", "media", "inquiries", "membership"] as const).map((name) => (
          <button
            key={name}
            className={`${styles.tab} ${tab === name ? styles.activeTab : ""}`}
            type="button"
            role="tab"
            aria-selected={tab === name}
            onClick={() => setTab(name)}
          >
            {name[0].toUpperCase() + name.slice(1)}
          </button>
        ))}
      </div>

      {loading ? <div className={styles.loading}>Loading your instructor workspace...</div> : null}
      {error ? <p className={styles.error}>{error}</p> : null}
      {!loading && profile && tab === "profile" ? (
        <InstructorProfileForm profile={profile} settings={settings} onSaved={() => void load()} />
      ) : null}
      {!loading && profile && tab === "media" ? <ProfileMediaManager profile={profile} /> : null}
      {!loading && tab === "inquiries" ? <InquiryList inquiries={inquiries} perspective="instructor" onChange={() => void load()} /> : null}
      {!loading && profile && tab === "membership" ? <MembershipCard profile={profile} settings={settings} /> : null}
    </>
  );
}

function InstructorProfileForm({
  profile,
  settings,
  onSaved
}: {
  profile: InstructorProfile;
  settings: InstructorPrivateSettings | null;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    display_name: profile.display_name,
    business_name: profile.business_name ?? "",
    headline: profile.headline ?? "",
    bio: profile.bio ?? "",
    city: profile.city ?? "",
    region: profile.region ?? "",
    postal_code: profile.postal_code ?? "",
    travel_radius_miles: profile.travel_radius_miles?.toString() ?? "",
    years_teaching: profile.years_teaching?.toString() ?? "",
    max_group_size: profile.max_group_size?.toString() ?? "",
    styles: profile.styles,
    event_types: profile.event_types,
    favorite_song_name: profile.favorite_song_name ?? "",
    favorite_song_spotify_url: profile.favorite_song_spotify_url ?? "",
    provides_speakers: profile.provides_speakers ?? false,
    provides_microphone: profile.provides_microphone ?? false,
    provides_music_playback: profile.provides_music_playback ?? false,
    liability_insurance_status: profile.liability_insurance_status,
    preferred_response_hours: profile.preferred_response_hours.toString(),
    inquiry_email: settings?.inquiry_email ?? "",
    inquiry_phone_e164: settings?.inquiry_phone_e164 ?? "",
    sms_notifications_enabled: settings?.sms_notifications_enabled ?? false,
    minimum_rate: settings?.minimum_rate_cents ? (settings.minimum_rate_cents / 100).toString() : "",
    minimum_hours: settings?.minimum_hours?.toString() ?? ""
  });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function setValue<Key extends keyof typeof form>(key: Key, value: (typeof form)[Key]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function toggleArray(key: "styles" | "event_types", value: string) {
    setForm((current) => ({
      ...current,
      [key]: current[key].includes(value)
        ? current[key].filter((item) => item !== value)
        : [...current[key], value]
    }));
  }

  async function save(submitForReview: boolean) {
    const client = getMarketplaceClient();
    if (!client) return;
    const phone = normalizePhone(form.inquiry_phone_e164);
    if (form.inquiry_phone_e164.trim() && !phone) {
      setError("Enter the text notification number in international format, such as +14155551234.");
      return;
    }
    if (form.sms_notifications_enabled && !phone) {
      setError("Add a valid mobile number before enabling text notifications.");
      return;
    }
    if (submitForReview && (!form.bio.trim() || !form.city.trim() || !form.region.trim() || !form.event_types.length)) {
      setError("Add a bio, location, and at least one event type before submitting for review.");
      return;
    }

    setBusy(true);
    setError(null);
    setMessage(null);

    const profilePayload = {
      display_name: form.display_name.trim(),
      business_name: form.business_name.trim() || null,
      headline: form.headline.trim() || null,
      bio: form.bio.trim() || null,
      city: form.city.trim() || null,
      region: form.region.trim().toUpperCase() || null,
      postal_code: form.postal_code.trim() || null,
      travel_radius_miles: form.travel_radius_miles ? Number(form.travel_radius_miles) : null,
      years_teaching: form.years_teaching ? Number(form.years_teaching) : null,
      max_group_size: form.max_group_size ? Number(form.max_group_size) : null,
      styles: form.styles,
      event_types: form.event_types,
      favorite_song_name: form.favorite_song_name.trim() || null,
      favorite_song_spotify_url: form.favorite_song_spotify_url.trim() || null,
      provides_speakers: form.provides_speakers,
      provides_microphone: form.provides_microphone,
      provides_music_playback: form.provides_music_playback,
      liability_insurance_status: form.liability_insurance_status,
      preferred_response_hours: Number(form.preferred_response_hours),
      status: submitForReview ? "pending_review" : profile.status
    };

    const { error: profileError } = await client.from("instructor_profiles").update(profilePayload).eq("id", profile.id);
    if (profileError) {
      setError(profileError.message);
      setBusy(false);
      return;
    }

    const { error: settingsError } = await client.from("instructor_private_settings").upsert({
      instructor_profile_id: profile.id,
      inquiry_email: form.inquiry_email.trim(),
      inquiry_phone_e164: phone,
      sms_notifications_enabled: form.sms_notifications_enabled,
      minimum_rate_cents: form.minimum_rate ? Math.round(Number(form.minimum_rate) * 100) : null,
      minimum_hours: form.minimum_hours ? Number(form.minimum_hours) : null
    });
    setBusy(false);
    if (settingsError) {
      setError(settingsError.message);
      return;
    }
    setMessage(submitForReview ? "Your profile is ready for review." : "Your profile changes are saved.");
    onSaved();
  }

  const canEdit = profile.status === "draft" || profile.status === "published";
  const canSubmitForReview = profile.status === "draft";

  return (
    <div className={`${styles.card} ${styles.stack}`}>
      <div className={styles.buttonRow}>
        <span className={styles.status}>{profile.status.replace("_", " ")}</span>
        {profile.status === "pending_review" ? <span className={styles.muted}>We will email you after the review.</span> : null}
      </div>
      {!canEdit ? <p className={styles.notice}>Editing is paused while your profile is in review or awaiting membership activation.</p> : null}

      <div className={styles.grid}>
        <label className={styles.field}>
          <span>Public name</span>
          <input disabled={!canEdit} required value={form.display_name} onChange={(e) => setValue("display_name", e.target.value)} />
        </label>
        <label className={styles.field}>
          <span>Business name</span>
          <input disabled={!canEdit} value={form.business_name} onChange={(e) => setValue("business_name", e.target.value)} />
        </label>
      </div>
      <label className={styles.field}>
        <span>Profile headline</span>
        <input disabled={!canEdit} maxLength={120} value={form.headline} onChange={(e) => setValue("headline", e.target.value)} placeholder="Beginner-friendly lessons that get the whole room moving" />
      </label>
      <label className={styles.field}>
        <span>About you</span>
        <textarea disabled={!canEdit} maxLength={2000} value={form.bio} onChange={(e) => setValue("bio", e.target.value)} />
      </label>
      <div className={styles.grid}>
        <label className={styles.field}>
          <span>City</span>
          <input disabled={!canEdit} value={form.city} onChange={(e) => setValue("city", e.target.value)} />
        </label>
        <label className={styles.field}>
          <span>State</span>
          <input disabled={!canEdit} maxLength={2} value={form.region} onChange={(e) => setValue("region", e.target.value)} placeholder="CA" />
        </label>
        <label className={styles.field}>
          <span>ZIP code</span>
          <input disabled={!canEdit} value={form.postal_code} onChange={(e) => setValue("postal_code", e.target.value)} />
        </label>
        <label className={styles.field}>
          <span>Travel radius in miles</span>
          <input disabled={!canEdit} type="number" min="0" max="1000" value={form.travel_radius_miles} onChange={(e) => setValue("travel_radius_miles", e.target.value)} />
        </label>
        <label className={styles.field}>
          <span>Years teaching</span>
          <input disabled={!canEdit} type="number" min="0" max="80" value={form.years_teaching} onChange={(e) => setValue("years_teaching", e.target.value)} />
        </label>
        <label className={styles.field}>
          <span>Largest group you teach</span>
          <input disabled={!canEdit} type="number" min="1" max="10000" value={form.max_group_size} onChange={(e) => setValue("max_group_size", e.target.value)} />
        </label>
      </div>

      <fieldset className={styles.stack} disabled={!canEdit}>
        <legend className={styles.legend}>What do you teach?</legend>
        <div className={styles.checkGrid}>
          {danceStyles.map((item) => (
            <label className={styles.check} key={item}>
              <input type="checkbox" checked={form.styles.includes(item)} onChange={() => toggleArray("styles", item)} />
              <span>{item}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className={styles.stack} disabled={!canEdit}>
        <legend className={styles.legend}>Events you accept</legend>
        <div className={styles.checkGrid}>
          {eventTypes.map((item) => (
            <label className={styles.check} key={item.slug}>
              <input type="checkbox" checked={form.event_types.includes(item.slug)} onChange={() => toggleArray("event_types", item.slug)} />
              <span>{item.label}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className={styles.grid}>
        <label className={styles.field}>
          <span>Favorite line dance song</span>
          <input disabled={!canEdit} value={form.favorite_song_name} onChange={(e) => setValue("favorite_song_name", e.target.value)} />
        </label>
        <label className={styles.field}>
          <span>Spotify track link</span>
          <input disabled={!canEdit} type="url" value={form.favorite_song_spotify_url} onChange={(e) => setValue("favorite_song_spotify_url", e.target.value)} placeholder="https://open.spotify.com/track/..." />
        </label>
      </div>

      <fieldset className={styles.stack} disabled={!canEdit}>
        <legend className={styles.legend}>Equipment you can provide</legend>
        <div className={styles.checkGrid}>
          <label className={styles.check}><input type="checkbox" checked={form.provides_speakers} onChange={(e) => setValue("provides_speakers", e.target.checked)} /><span>Speakers</span></label>
          <label className={styles.check}><input type="checkbox" checked={form.provides_microphone} onChange={(e) => setValue("provides_microphone", e.target.checked)} /><span>Microphone</span></label>
          <label className={styles.check}><input type="checkbox" checked={form.provides_music_playback} onChange={(e) => setValue("provides_music_playback", e.target.checked)} /><span>Music playback device</span></label>
        </div>
      </fieldset>

      <div className={styles.grid}>
        <label className={styles.field}>
          <span>Liability insurance</span>
          <select disabled={!canEdit} value={form.liability_insurance_status} onChange={(e) => setValue("liability_insurance_status", e.target.value as typeof form.liability_insurance_status)}>
            <option value="not_provided">Not currently available</option>
            <option value="available">I can provide a certificate</option>
            <option value="required_per_event">I arrange it when required</option>
          </select>
        </label>
        <label className={styles.field}>
          <span>Response commitment</span>
          <select disabled={!canEdit} value={form.preferred_response_hours} onChange={(e) => setValue("preferred_response_hours", e.target.value)}>
            <option value="24">Within 24 hours</option>
            <option value="48">Within 48 hours</option>
            <option value="72">Within 72 hours</option>
          </select>
        </label>
      </div>

      <h3>Private inquiry and pricing settings</h3>
      <p className={styles.help}>These details are not displayed on your public profile.</p>
      <div className={styles.grid}>
        <label className={styles.field}>
          <span>Verified inquiry email</span>
          <input disabled type="email" value={form.inquiry_email} />
          <small>Inquiry alerts go to the email verified through your account sign-in.</small>
        </label>
        <label className={styles.field}>
          <span>Text notification number</span>
          <input disabled={!canEdit} type="tel" placeholder="+14155551234" value={form.inquiry_phone_e164} onChange={(e) => setValue("inquiry_phone_e164", e.target.value)} />
        </label>
        <label className={styles.field}>
          <span>Typical minimum rate in dollars</span>
          <input disabled={!canEdit} type="number" min="0" step="1" value={form.minimum_rate} onChange={(e) => setValue("minimum_rate", e.target.value)} />
        </label>
        <label className={styles.field}>
          <span>Minimum booking hours</span>
          <input disabled={!canEdit} type="number" min="0.5" max="24" step="0.5" value={form.minimum_hours} onChange={(e) => setValue("minimum_hours", e.target.value)} />
        </label>
      </div>
      <label className={styles.check}>
        <input disabled={!canEdit} type="checkbox" checked={form.sms_notifications_enabled} onChange={(e) => setValue("sms_notifications_enabled", e.target.checked)} />
        <span>Text me when a new inquiry arrives. Message and data rates may apply. Reply STOP to opt out.</span>
      </label>

      {message ? <p className={styles.success}>{message}</p> : null}
      {error ? <p className={styles.error}>{error}</p> : null}
      {canEdit ? (
        <div className={styles.buttonRow}>
          <button className={styles.secondaryButton} type="button" disabled={busy} onClick={() => void save(false)}>
            {profile.status === "published" ? "Save changes" : "Save draft"}
          </button>
          {canSubmitForReview ? (
            <button className={styles.button} type="button" disabled={busy} onClick={() => void save(true)}>Submit for review</button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function ProfileMediaManager({ profile }: { profile: InstructorProfile }) {
  const [media, setMedia] = useState<ProfileMedia[]>([]);
  const [uploadType, setUploadType] = useState<ProfileMedia["media_type"]>("headshot");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const client = getMarketplaceClient();
    if (!client) return;
    const { data, error: loadError } = await client
      .from("profile_media")
      .select("id,media_type,storage_path,external_url,caption,status,sort_order")
      .eq("instructor_profile_id", profile.id)
      .order("sort_order");
    if (loadError) setError(loadError.message);
    setMedia((data as ProfileMedia[] | null) ?? []);
  }

  useEffect(() => {
    void load();
  }, [profile.id]);

  async function upload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    const client = getMarketplaceClient();
    if (!file || !client) return;
    const isVideo = uploadType === "video" || uploadType === "welcome_video";
    const maximumBytes = isVideo ? 50 * 1024 * 1024 : 10 * 1024 * 1024;
    if (file.size > maximumBytes) {
      setError(isVideo ? "Videos must be 50 MB or smaller." : "Images must be 10 MB or smaller.");
      event.target.value = "";
      return;
    }
    if (isVideo !== file.type.startsWith("video/")) {
      setError(isVideo ? "Choose an MP4 or WebM video." : "Choose a JPG, PNG, or WebP image.");
      event.target.value = "";
      return;
    }

    setBusy(true);
    setError(null);
    const safeName = file.name.toLowerCase().replace(/[^a-z0-9.]+/g, "-");
    const path = `${profile.account_id}/${profile.id}/${crypto.randomUUID()}-${safeName}`;
    const { error: uploadError } = await client.storage.from("instructor-media").upload(path, file, {
      cacheControl: "3600",
      contentType: file.type,
      upsert: false
    });
    if (uploadError) {
      setError(uploadError.message);
      setBusy(false);
      return;
    }

    const { error: metadataError } = await client.from("profile_media").insert({
      instructor_profile_id: profile.id,
      media_type: uploadType,
      storage_path: path,
      mime_type: file.type,
      status: "ready",
      sort_order: media.length
    });
    if (metadataError) {
      await client.storage.from("instructor-media").remove([path]);
      setError(metadataError.message);
    }
    setBusy(false);
    event.target.value = "";
    await load();
  }

  async function remove(item: ProfileMedia) {
    const client = getMarketplaceClient();
    if (!client) return;
    setBusy(true);
    setError(null);
    const { error: metadataError } = await client.from("profile_media").delete().eq("id", item.id);
    if (!metadataError && item.storage_path) {
      await client.storage.from("instructor-media").remove([item.storage_path]);
    }
    if (metadataError) setError(metadataError.message);
    setBusy(false);
    await load();
  }

  function mediaUrl(item: ProfileMedia) {
    if (item.external_url) return item.external_url;
    const client = getMarketplaceClient();
    if (!client || !item.storage_path) return "";
    return client.storage.from("instructor-media").getPublicUrl(item.storage_path).data.publicUrl;
  }

  return (
    <div className={`${styles.card} ${styles.stack}`}>
      <div>
        <h2>Profile photos and videos</h2>
        <p className={styles.muted}>Add one headshot, up to three teaching photos, one welcome video, and up to three additional videos.</p>
      </div>
      <div className={styles.grid}>
        <label className={styles.field}>
          <span>Media type</span>
          <select value={uploadType} onChange={(event) => setUploadType(event.target.value as ProfileMedia["media_type"])}>
            <option value="headshot">Main headshot</option>
            <option value="image">Teaching photo</option>
            <option value="welcome_video">Welcome video</option>
            <option value="video">Dancing or teaching video</option>
          </select>
        </label>
        <label className={styles.field}>
          <span>{busy ? "Uploading..." : "Choose a file"}</span>
          <input
            type="file"
            disabled={busy || !["draft", "published"].includes(profile.status)}
            accept={uploadType === "video" || uploadType === "welcome_video" ? "video/mp4,video/webm" : "image/jpeg,image/png,image/webp"}
            onChange={(event) => void upload(event)}
          />
        </label>
      </div>
      {profile.status === "pending_review" ? <p className={styles.notice}>Media is locked while your profile is in review.</p> : null}
      {error ? <p className={styles.error}>{error}</p> : null}
      <div className={styles.mediaGrid}>
        {media.map((item) => (
          <article className={styles.mediaItem} key={item.id}>
            {item.media_type === "video" || item.media_type === "welcome_video" ? (
              <video className={styles.mediaPreview} src={mediaUrl(item)} controls preload="metadata" />
            ) : (
              // Uploaded user content has a runtime URL that Next Image cannot optimize during static export.
              // eslint-disable-next-line @next/next/no-img-element
              <img className={styles.mediaPreview} src={mediaUrl(item)} alt={item.caption || item.media_type} />
            )}
            <span className={styles.status}>{item.media_type.replace("_", " ")}</span>
            {["draft", "published"].includes(profile.status) ? (
              <button className={styles.dangerButton} type="button" disabled={busy} onClick={() => void remove(item)}>Remove</button>
            ) : null}
          </article>
        ))}
      </div>
    </div>
  );
}

function MembershipCard({ profile, settings }: { profile: InstructorProfile; settings: InstructorPrivateSettings | null }) {
  const [busy, setBusy] = useState<"checkout" | "portal" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const checkoutRequestKey = useRef<string | null>(null);

  async function activateMembership() {
    const client = getMarketplaceClient();
    if (!client) return;
    setBusy("checkout");
    setError(null);
    checkoutRequestKey.current ??= crypto.randomUUID();
    const { data, error: checkoutError } = await client.functions.invoke("create-instructor-checkout", {
      body: { instructorProfileId: profile.id },
      headers: { "Idempotency-Key": checkoutRequestKey.current }
    });
    setBusy(null);
    if (checkoutError) {
      setError(checkoutError.message);
      return;
    }
    if (!data?.url || typeof data.url !== "string") {
      setError("Stripe checkout did not return a secure payment link.");
      return;
    }
    window.location.assign(data.url);
  }

  async function manageMembership() {
    const client = getMarketplaceClient();
    if (!client) return;
    setBusy("portal");
    setError(null);
    const { data, error: portalError } = await client.functions.invoke("create-billing-portal", {
      body: {}
    });
    setBusy(null);
    if (portalError) {
      setError(portalError.message);
      return;
    }
    if (!data?.url || typeof data.url !== "string") {
      setError("Stripe did not return a secure billing link.");
      return;
    }
    window.location.assign(data.url);
  }

  const canManage = profile.status === "published"
    || ["trialing", "active", "past_due", "paused"].includes(settings?.subscription_status ?? "");

  return (
    <div className={styles.card}>
      <p className={styles.eyebrow}>Instructor membership</p>
      <h2>$14.99 per month</h2>
      <p>Your membership starts only after your profile is approved. It includes the first-year booking guarantee described in the refund policy.</p>
      <p><span className={styles.status}>{settings?.subscription_status ?? "inactive"}</span></p>
      {profile.status === "approved" ? (
        <>
          <p>Your profile has been approved. Activate membership to publish it in the directory.</p>
          <button className={styles.button} type="button" disabled={busy !== null} onClick={() => void activateMembership()}>
            {busy === "checkout" ? "Opening secure checkout..." : "Activate membership"}
          </button>
        </>
      ) : null}
      {profile.status === "draft" || profile.status === "pending_review" ? (
        <p className={styles.notice}>Membership activation becomes available after your profile is approved.</p>
      ) : null}
      {profile.status === "published" ? <p className={styles.success}>Your profile is live in the directory.</p> : null}
      {canManage ? (
        <button className={styles.secondaryButton} type="button" disabled={busy !== null} onClick={() => void manageMembership()}>
          {busy === "portal" ? "Opening membership settings..." : "Manage membership"}
        </button>
      ) : null}
      {error ? <p className={styles.error}>{error}</p> : null}
    </div>
  );
}

type AdminNotificationJob = {
  id: number;
  channel: "email" | "sms";
  notification_type: string;
  status: string;
  attempts: number;
  last_error: string | null;
  created_at: string;
};

function AdminDashboard() {
  const [profiles, setProfiles] = useState<InstructorProfile[]>([]);
  const [inquiries, setInquiries] = useState<MarketplaceInquiry[]>([]);
  const [jobs, setJobs] = useState<AdminNotificationJob[]>([]);
  const [slugs, setSlugs] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function suggestedSlug(profile: InstructorProfile) {
    return [profile.display_name, profile.city, profile.region]
      .filter(Boolean)
      .join(" ")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
  }

  async function load() {
    const client = getMarketplaceClient();
    if (!client) return;
    setLoading(true);
    setError(null);
    const [profileResult, inquiryResult, jobResult] = await Promise.all([
      client.from("instructor_profiles").select("*").order("updated_at", { ascending: false }),
      client.from("inquiries").select("*").order("created_at", { ascending: false }).limit(100),
      client.from("inquiry_notification_jobs").select("id,channel,notification_type,status,attempts,last_error,created_at").order("created_at", { ascending: false }).limit(100)
    ]);
    const loadError = profileResult.error ?? inquiryResult.error ?? jobResult.error;
    if (loadError) setError(loadError.message);
    const loadedProfiles = (profileResult.data as InstructorProfile[] | null) ?? [];
    setProfiles(loadedProfiles);
    setInquiries((inquiryResult.data as MarketplaceInquiry[] | null) ?? []);
    setJobs((jobResult.data as AdminNotificationJob[] | null) ?? []);
    setSlugs((current) => Object.fromEntries(loadedProfiles.map((profile) => [profile.id, current[profile.id] ?? profile.slug ?? suggestedSlug(profile)])));
    setLoading(false);
  }

  useEffect(() => {
    void load();
  }, []);

  async function review(profileId: string, decision: "approve" | "return_to_draft" | "suspend") {
    const client = getMarketplaceClient();
    if (!client) return;
    setBusyId(profileId);
    setError(null);
    const { error: reviewError } = await client.rpc("review_instructor_profile", {
      p_instructor_profile_id: profileId,
      p_decision: decision,
      p_slug: slugs[profileId] || null,
      p_note: notes[profileId] || null
    });
    setBusyId(null);
    if (reviewError) setError(reviewError.message);
    else await load();
  }

  const pending = profiles.filter((profile) => profile.status === "pending_review");
  const deliveryFailures = jobs.filter((job) => job.status === "failed");

  if (loading) return <div className={styles.loading}>Loading marketplace operations...</div>;

  return (
    <>
      {error ? <p className={styles.error}>{error}</p> : null}
      <div className={styles.grid}>
        <article className={styles.card}><p className={styles.eyebrow}>Pending review</p><h2>{pending.length}</h2></article>
        <article className={styles.card}><p className={styles.eyebrow}>Inquiry records</p><h2>{inquiries.length}</h2></article>
        <article className={styles.card}><p className={styles.eyebrow}>Notification jobs</p><h2>{jobs.length}</h2></article>
        <article className={styles.card}><p className={styles.eyebrow}>Delivery failures</p><h2>{deliveryFailures.length}</h2></article>
      </div>

      <div className={styles.card}>
        <h2>Profiles awaiting review</h2>
        <p className={styles.muted}>Approval unlocks the $14.99 monthly membership checkout. Stripe publishes the profile only after successful payment.</p>
        {!pending.length ? <p className={styles.notice}>No profiles are waiting for review.</p> : null}
        <div className={styles.list}>
          {pending.map((profile) => (
            <article className={styles.listItem} key={profile.id}>
              <div className={styles.buttonRow}><h3>{profile.display_name}</h3><span className={styles.status}>{profile.status.replace("_", " ")}</span></div>
              <p>{[profile.business_name, profile.city, profile.region].filter(Boolean).join(" · ")}</p>
              <p>{profile.bio || "No bio provided."}</p>
              <p>Events: {profile.event_types.length ? profile.event_types.join(", ") : "None selected"}</p>
              <div className={styles.grid}>
                <label className={styles.field}>
                  <span>Public profile slug</span>
                  <input value={slugs[profile.id] ?? ""} onChange={(event) => setSlugs((current) => ({ ...current, [profile.id]: event.target.value }))} />
                </label>
                <label className={styles.field}>
                  <span>Review note</span>
                  <input value={notes[profile.id] ?? ""} onChange={(event) => setNotes((current) => ({ ...current, [profile.id]: event.target.value }))} />
                </label>
              </div>
              <div className={styles.buttonRow}>
                <button className={styles.button} disabled={busyId === profile.id} type="button" onClick={() => void review(profile.id, "approve")}>Approve for payment</button>
                <button className={styles.dangerButton} disabled={busyId === profile.id} type="button" onClick={() => void review(profile.id, "return_to_draft")}>Return to draft</button>
              </div>
            </article>
          ))}
        </div>
      </div>

      <div className={styles.card}>
        <h2>Recent inquiries</h2>
        <div className={styles.list}>
          {inquiries.slice(0, 20).map((inquiry) => (
            <article className={styles.listItem} key={inquiry.id}>
              <div className={styles.buttonRow}><strong>{inquiry.contact_name || "Planner"} to {inquiry.instructor_name || "instructor"}</strong><span className={styles.status}>{inquiry.status}</span></div>
              <p>{[inquiry.event_type, inquiry.event_date, inquiry.event_city, inquiry.event_region].filter(Boolean).join(" · ")}</p>
              <p>Outcome: {inquiry.booking_outcome.replace("_", " ")}</p>
            </article>
          ))}
        </div>
      </div>

      <div className={styles.card}>
        <h2>Notification delivery</h2>
        <div className={styles.list}>
          {jobs.slice(0, 30).map((job) => (
            <article className={styles.listItem} key={job.id}>
              <div className={styles.buttonRow}><strong>{job.channel.toUpperCase()} · {job.notification_type.replace("_", " ")}</strong><span className={styles.status}>{job.status}</span></div>
              <p>{new Date(job.created_at).toLocaleString()} · {job.attempts} attempt{job.attempts === 1 ? "" : "s"}</p>
              {job.last_error ? <p className={styles.error}>{job.last_error}</p> : null}
            </article>
          ))}
        </div>
      </div>
    </>
  );
}

function OrganizerDashboard() {
  const [inquiries, setInquiries] = useState<MarketplaceInquiry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const client = getMarketplaceClient();
    if (!client) return;
    const { data, error: loadError } = await client.from("inquiries").select("*").order("created_at", { ascending: false });
    setInquiries((data as MarketplaceInquiry[] | null) ?? []);
    setError(loadError?.message ?? null);
    setLoading(false);
  }

  useEffect(() => {
    void load();
  }, []);

  return (
    <>
      <div className={styles.card}>
        <h2>Your instructor inquiries</h2>
        <p>Instructors reply to your account email so contracts, availability, rates, and payments can stay in your usual inbox.</p>
        <a className={styles.button} href="/#find">Find an instructor</a>
      </div>
      {loading ? <div className={styles.loading}>Loading inquiries...</div> : null}
      {error ? <p className={styles.error}>{error}</p> : null}
      {!loading ? <InquiryList inquiries={inquiries} perspective="organizer" onChange={() => void load()} /> : null}
    </>
  );
}

function InquiryList({
  inquiries,
  perspective,
  onChange
}: {
  inquiries: MarketplaceInquiry[];
  perspective: "organizer" | "instructor";
  onChange: () => void;
}) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function setStatus(id: string, status: string) {
    const client = getMarketplaceClient();
    if (!client) return;
    setBusyId(id);
    setError(null);
    const { error: actionError } = await client.rpc("set_inquiry_status", {
      p_inquiry_id: id,
      p_status: status,
      p_note: null
    });
    setBusyId(null);
    if (actionError) setError(actionError.message);
    else onChange();
  }

  async function reportOutcome(id: string, outcome: string) {
    const client = getMarketplaceClient();
    if (!client) return;
    setBusyId(id);
    setError(null);
    const { error: actionError } = await client.rpc("report_booking_outcome", {
      p_inquiry_id: id,
      p_outcome: outcome,
      p_booking_value_cents: null,
      p_note: null
    });
    setBusyId(null);
    if (actionError) setError(actionError.message);
    else onChange();
  }

  if (!inquiries.length) {
    return <p className={styles.notice}>{perspective === "instructor" ? "No inquiries yet. New inquiries will appear here and arrive by email." : "You have not contacted an instructor yet."}</p>;
  }

  return (
    <div className={styles.list}>
      {error ? <p className={styles.error}>{error}</p> : null}
      {inquiries.map((inquiry) => (
        <article className={styles.listItem} key={inquiry.id}>
          <div className={styles.buttonRow}>
            <span className={styles.status}>{inquiry.status.replace("_", " ")}</span>
            <span className={styles.muted}>{new Date(inquiry.created_at).toLocaleDateString()}</span>
          </div>
          <h3>{perspective === "instructor" ? inquiry.contact_name : inquiry.instructor_name}</h3>
          <p>{[inquiry.event_type, inquiry.event_date, inquiry.event_city, inquiry.event_region].filter(Boolean).join(" · ")}</p>
          {inquiry.guest_count ? <p>{inquiry.guest_count} expected attendees</p> : null}
          {inquiry.message ? <p>{inquiry.message}</p> : null}
          {perspective === "instructor" && inquiry.contact_email ? (
            <p><a href={`mailto:${inquiry.contact_email}?subject=${encodeURIComponent(`Your line dance inquiry for ${inquiry.event_date ?? "your event"}`)}`}>Reply by email</a></p>
          ) : null}
          <div className={styles.buttonRow}>
            {perspective === "instructor" && !["responded", "declined", "booked", "not_booked", "closed"].includes(inquiry.status) ? (
              <button className={styles.secondaryButton} disabled={busyId === inquiry.id} type="button" onClick={() => void setStatus(inquiry.id, "responded")}>Mark responded</button>
            ) : null}
            {perspective === "organizer" && !["withdrawn", "booked", "not_booked", "closed"].includes(inquiry.status) ? (
              <button className={styles.dangerButton} disabled={busyId === inquiry.id} type="button" onClick={() => void setStatus(inquiry.id, "withdrawn")}>Withdraw inquiry</button>
            ) : null}
            {inquiry.booking_outcome === "unknown" || inquiry.booking_outcome === "still_deciding" ? (
              <>
                <button className={styles.button} disabled={busyId === inquiry.id} type="button" onClick={() => void reportOutcome(inquiry.id, "booked")}>Booked</button>
                <button className={styles.dangerButton} disabled={busyId === inquiry.id} type="button" onClick={() => void reportOutcome(inquiry.id, "not_booked")}>Not booked</button>
              </>
            ) : null}
          </div>
        </article>
      ))}
    </div>
  );
}
