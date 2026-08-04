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
  instructor_profile_id: string;
  media_type: "headshot" | "image" | "welcome_video" | "video";
  storage_path: string | null;
  external_url: string | null;
  caption: string | null;
  status: string;
  sort_order: number;
};

export function AccountWorkspace({ adminOnly = false }: { adminOnly?: boolean }) {
  const { session, account, isAdmin, isOwner, loading, error, configured, refresh } = useMarketplaceSession();
  const [signingOut, setSigningOut] = useState(false);
  const [workspaceMode, setWorkspaceMode] = useState<"admin" | "account">("admin");

  useEffect(() => {
    if (!isAdmin) {
      setWorkspaceMode("account");
      return;
    }
    if (adminOnly || account?.role === "admin") {
      setWorkspaceMode("admin");
      return;
    }
    const params = new URLSearchParams(window.location.search);
    setWorkspaceMode(params.has("followup") || params.get("tab") === "inquiries" ? "account" : "admin");
  }, [account?.role, adminOnly, isAdmin]);

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
    const next = typeof window === "undefined"
      ? (adminOnly ? "/admin/" : "/account/")
      : `${window.location.pathname}${window.location.search}`;
    return (
      <section className={`${styles.shell} ${styles.narrow}`}>
        <p className={styles.eyebrow}>Your account</p>
        <h1 className={styles.title}>Sign in to continue</h1>
        <p className={styles.subtitle}>Manage your instructor profile or keep track of the instructors you contacted.</p>
        <div className={styles.buttonRow} style={{ marginTop: 28 }}>
          <a className={styles.button} href={loginUrl(next)}>Sign in</a>
        </div>
      </section>
    );
  }

  if (adminOnly && !isAdmin) {
    return (
      <section className={`${styles.shell} ${styles.narrow}`}>
        <p className={styles.eyebrow}>Admin access</p>
        <h1 className={styles.title}>Access restricted</h1>
        <p className={styles.error}>This dashboard is available only to approved Hire Line Dancers administrators.</p>
        <a className={styles.secondaryButton} href="/account/">Open my account</a>
      </section>
    );
  }

  if (!account?.role && !isAdmin) {
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
          <p className={styles.eyebrow}>{workspaceMode === "admin" && isAdmin ? "Admin workspace" : account?.role === "instructor" ? "Instructor workspace" : "Planner workspace"}</p>
          <h1>Welcome, {account?.full_name?.split(" ")[0] || "there"}</h1>
          <p className={styles.muted}>{account?.email}</p>
        </div>
        <button className={styles.secondaryButton} type="button" disabled={signingOut} onClick={() => void signOut()}>
          {signingOut ? "Signing out..." : "Sign out"}
        </button>
      </div>

      {!adminOnly && isAdmin && account?.role && account.role !== "admin" ? (
        <div className={styles.tabs} role="tablist" aria-label="Workspace selection">
          <button className={`${styles.tab} ${workspaceMode === "admin" ? styles.activeTab : ""}`} type="button" onClick={() => setWorkspaceMode("admin")}>Admin</button>
          <button className={`${styles.tab} ${workspaceMode === "account" ? styles.activeTab : ""}`} type="button" onClick={() => setWorkspaceMode("account")}>My account</button>
        </div>
      ) : null}

      {isAdmin && workspaceMode === "admin" ? <AdminDashboard isOwner={isOwner} /> : null}
      {workspaceMode === "account" && account?.role === "instructor" ? <InstructorDashboard account={account} /> : null}
      {workspaceMode === "account" && account?.role === "organizer" ? <OrganizerDashboard /> : null}
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
            <span>Text me when I receive a new inquiry. Message and data rates may apply. Turn alerts off any time in your account.</span>
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
  const [focusInquiryId, setFocusInquiryId] = useState<string | null>(null);
  const [focusFollowup, setFocusFollowup] = useState<"booking" | "completion" | null>(null);
  const [profile, setProfile] = useState<InstructorProfile | null>(null);
  const [settings, setSettings] = useState<InstructorPrivateSettings | null>(null);
  const [inquiries, setInquiries] = useState<MarketplaceInquiry[]>([]);
  const [loading, setLoading] = useState(true);
  const [checkoutPending, setCheckoutPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load(silent = false) {
    const client = getMarketplaceClient();
    if (!client) return;
    if (!silent) setLoading(true);
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

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("checkout") === "success") return;

    const requestedTab = params.get("tab");
    const requestedInquiry = params.get("inquiry");
    const requestedFollowup = params.get("followup");
    const validInquiry = requestedInquiry && /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(requestedInquiry)
      ? requestedInquiry
      : null;
    const validFollowup = requestedFollowup === "booking" || requestedFollowup === "completion"
      ? requestedFollowup
      : null;

    if (validInquiry) {
      setTab("inquiries");
      setFocusInquiryId(validInquiry);
      setFocusFollowup(validFollowup);
      return;
    }
    if (["profile", "media", "inquiries", "membership"].includes(requestedTab ?? "")) {
      setTab(requestedTab as "profile" | "media" | "inquiries" | "membership");
    }
  }, [account.id]);

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("checkout") !== "success") return;

    setTab("membership");
    setCheckoutPending(true);
    let stopped = false;
    let attempts = 0;
    let timer: number | undefined;

    async function pollForMembership() {
      await load(true);
      attempts += 1;
      if (!stopped && attempts < 6) {
        timer = window.setTimeout(() => void pollForMembership(), 1500);
      } else if (!stopped) {
        setCheckoutPending(false);
      }
    }

    timer = window.setTimeout(() => void pollForMembership(), 500);
    return () => {
      stopped = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [account.id]);

  useEffect(() => {
    if (!checkoutPending) return;
    const membershipConfirmed = profile?.status === "published"
      || ["trialing", "active", "past_due", "unpaid", "paused"].includes(settings?.subscription_status ?? "");
    if (!membershipConfirmed) return;

    setCheckoutPending(false);
    const url = new URL(window.location.href);
    url.searchParams.delete("checkout");
    window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
  }, [checkoutPending, profile?.status, settings?.subscription_status]);

  function chooseTab(name: "profile" | "media" | "inquiries" | "membership") {
    setTab(name);
    setFocusInquiryId(null);
    setFocusFollowup(null);
    const url = new URL(window.location.href);
    url.searchParams.set("tab", name);
    url.searchParams.delete("inquiry");
    url.searchParams.delete("followup");
    window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
  }

  function clearInquiryFocus() {
    setFocusInquiryId(null);
    setFocusFollowup(null);
    const url = new URL(window.location.href);
    url.searchParams.set("tab", "inquiries");
    url.searchParams.delete("inquiry");
    url.searchParams.delete("followup");
    window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
  }

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
            onClick={() => chooseTab(name)}
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
      {!loading && tab === "inquiries" ? (
        <InquiryList
          inquiries={inquiries}
          perspective="instructor"
          focusInquiryId={focusInquiryId}
          focusFollowup={focusFollowup}
          onChange={() => void load()}
          onFeedbackSubmitted={clearInquiryFocus}
        />
      ) : null}
      {!loading && profile && tab === "membership" ? (
        <MembershipCard profile={profile} settings={settings} checkoutPending={checkoutPending} />
      ) : null}
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
        <span>Text me when a new inquiry arrives. Message and data rates may apply. Turn alerts off any time in your account.</span>
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

function MembershipCard({
  profile,
  settings,
  checkoutPending,
}: {
  profile: InstructorProfile;
  settings: InstructorPrivateSettings | null;
  checkoutPending: boolean;
}) {
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

  const trialEligible = !settings?.stripe_subscription_id;
  const canManage = profile.status === "published"
    || ["trialing", "active", "past_due", "unpaid", "paused"].includes(settings?.subscription_status ?? "");

  return (
    <div className={styles.card}>
      <p className={styles.eyebrow}>Instructor membership</p>
      <h2>{trialEligible ? "First 30 days free, then $14.99 per month" : "$14.99 per month"}</h2>
      {trialEligible ? (
        <p>Your membership starts only after your profile is approved. Stripe securely collects your payment method at checkout, but you will not be charged until your 30-day free trial ends. Cancel before then and you will not be charged. Your membership also includes the first-year booking guarantee described in the refund policy.</p>
      ) : (
        <p>Restart your instructor membership for $14.99 per month. The introductory free month is available once per instructor. Your first-year booking guarantee remains governed by the refund policy.</p>
      )}
      <p><span className={styles.status}>{settings?.subscription_status ?? "inactive"}</span></p>
      {profile.status === "approved" ? (
        <>
          {checkoutPending ? (
            <p className={styles.notice}>Stripe received your checkout. We are confirming your membership now. This usually takes a few seconds.</p>
          ) : (
            <>
              <p>Your profile has been approved. {trialEligible ? "Start your free month" : "Restart your membership"} to publish it in the directory.</p>
              <button className={styles.button} type="button" disabled={busy !== null} onClick={() => void activateMembership()}>
                {busy === "checkout" ? "Opening secure checkout..." : trialEligible ? "Start my free month" : "Restart membership"}
              </button>
            </>
          )}
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

type AdminAccess = {
  account_id: string;
  email: string | null;
  full_name: string | null;
  is_owner: boolean;
  granted_at: string;
};

type AdminFollowupResponse = {
  id: number;
  inquiry_id: string;
  stage: "booking" | "completion";
  response: string;
  confirmed_event_date: string | null;
  private_comment: string | null;
  submitted_at: string;
};

type AdminAnalytics = {
  summary: {
    inquiries: number;
    instructors: number;
    companies: number;
    booked: number;
    in_progress: number;
    not_booked: number;
    completed: number;
    did_not_happen: number;
    cohort_booked: number;
    cohort_completed: number;
  };
  instructors: Array<{
    instructor_key: string;
    instructor_name: string;
    inquiries: number;
    companies: number;
    booked: number;
    completed: number;
    latest_inquiry_at: string;
  }>;
  companies: Array<{
    company_key: string;
    company_name: string;
    contact_email: string | null;
    inquiries: number;
    instructors: number;
    booked: number;
    completed: number;
    latest_inquiry_at: string;
  }>;
  instructor_companies: Array<{
    instructor_key: string;
    instructor_name: string;
    company_key: string;
    company_name: string;
    contact_email: string | null;
    inquiries: number;
    booked: number;
    completed: number;
    latest_inquiry_at: string;
  }>;
  series: Array<{
    period_start: string;
    inquiries: number;
    booked: number;
    completed: number;
  }>;
};

type AdminRangePreset = "today" | "7d" | "30d" | "12m" | "all" | "custom";

const emptyAdminAnalytics: AdminAnalytics = {
  summary: {
    inquiries: 0,
    instructors: 0,
    companies: 0,
    booked: 0,
    in_progress: 0,
    not_booked: 0,
    completed: 0,
    did_not_happen: 0,
    cohort_booked: 0,
    cohort_completed: 0
  },
  instructors: [],
  companies: [],
  instructor_companies: [],
  series: []
};

function dateInputValue(date: Date) {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

function adminRange(
  preset: AdminRangePreset,
  customStart: string,
  customEnd: string
): { start: string | null; end: string | null; bucket: "day" | "week" | "month" | "year" } {
  if (preset === "all") return { start: null, end: null, bucket: "month" };

  const now = new Date();
  const end = new Date(now);
  end.setHours(24, 0, 0, 0);
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);

  if (preset === "7d") start.setDate(start.getDate() - 6);
  if (preset === "30d") start.setDate(start.getDate() - 29);
  if (preset === "12m") start.setFullYear(start.getFullYear() - 1);
  if (preset === "custom") {
    const customStartDate = new Date(`${customStart}T00:00:00`);
    const customEndDate = new Date(`${customEnd}T00:00:00`);
    customEndDate.setDate(customEndDate.getDate() + 1);
    const days = Math.max(1, (customEndDate.getTime() - customStartDate.getTime()) / 86_400_000);
    return {
      start: customStartDate.toISOString(),
      end: customEndDate.toISOString(),
      bucket: days > 730 ? "year" : days > 120 ? "month" : days > 45 ? "week" : "day"
    };
  }

  return {
    start: start.toISOString(),
    end: end.toISOString(),
    bucket: preset === "12m" ? "month" : "day"
  };
}

function percent(numerator: number, denominator: number) {
  if (!denominator) return "0%";
  return `${Math.round((numerator / denominator) * 100)}%`;
}

function AdminDashboard({ isOwner }: { isOwner: boolean }) {
  const [tab, setTab] = useState<"overview" | "profiles" | "delivery" | "access">("overview");
  const [profiles, setProfiles] = useState<InstructorProfile[]>([]);
  const [inquiries, setInquiries] = useState<MarketplaceInquiry[]>([]);
  const [jobs, setJobs] = useState<AdminNotificationJob[]>([]);
  const [media, setMedia] = useState<ProfileMedia[]>([]);
  const [admins, setAdmins] = useState<AdminAccess[]>([]);
  const [followupResponses, setFollowupResponses] = useState<AdminFollowupResponse[]>([]);
  const [analytics, setAnalytics] = useState<AdminAnalytics>(emptyAdminAnalytics);
  const [slugs, setSlugs] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [rangePreset, setRangePreset] = useState<AdminRangePreset>("30d");
  const [customStart, setCustomStart] = useState(() => {
    const date = new Date();
    date.setDate(date.getDate() - 29);
    return dateInputValue(date);
  });
  const [customEnd, setCustomEnd] = useState(() => dateInputValue(new Date()));
  const [grantEmail, setGrantEmail] = useState("");
  const [loading, setLoading] = useState(true);
  const [analyticsLoading, setAnalyticsLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  function suggestedSlug(profile: InstructorProfile) {
    return [profile.display_name, profile.city, profile.region]
      .filter(Boolean)
      .join(" ")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
  }

  async function loadOperations() {
    const client = getMarketplaceClient();
    if (!client) return;
    setLoading(true);
    setError(null);
    const [profileResult, inquiryResult, jobResult, mediaResult, adminResult, feedbackResult] = await Promise.all([
      client.from("instructor_profiles").select("*").order("updated_at", { ascending: false }),
      client.from("inquiries").select("*").order("created_at", { ascending: false }).limit(100),
      client.from("inquiry_notification_jobs").select("id,channel,notification_type,status,attempts,last_error,created_at").order("created_at", { ascending: false }).limit(100),
      client.from("profile_media").select("*").order("sort_order"),
      client.rpc("list_marketplace_admins"),
      client.from("inquiry_followup_responses").select("id,inquiry_id,stage,response,confirmed_event_date,private_comment,submitted_at").order("submitted_at", { ascending: false }).limit(100)
    ]);
    const loadError = profileResult.error ?? inquiryResult.error ?? jobResult.error ?? mediaResult.error ?? adminResult.error ?? feedbackResult.error;
    if (loadError) setError(loadError.message);
    const loadedProfiles = (profileResult.data as InstructorProfile[] | null) ?? [];
    setProfiles(loadedProfiles);
    setInquiries((inquiryResult.data as MarketplaceInquiry[] | null) ?? []);
    setJobs((jobResult.data as AdminNotificationJob[] | null) ?? []);
    setMedia((mediaResult.data as ProfileMedia[] | null) ?? []);
    setAdmins((adminResult.data as AdminAccess[] | null) ?? []);
    setFollowupResponses((feedbackResult.data as AdminFollowupResponse[] | null) ?? []);
    setSlugs((current) => Object.fromEntries(loadedProfiles.map((profile) => [profile.id, current[profile.id] ?? profile.slug ?? suggestedSlug(profile)])));
    setLoading(false);
  }

  async function loadAnalytics() {
    const client = getMarketplaceClient();
    if (!client) return;
    setAnalyticsLoading(true);
    setError(null);
    const range = adminRange(rangePreset, customStart, customEnd);
    const { data, error: analyticsError } = await client.rpc("get_marketplace_admin_analytics", {
      p_start: range.start,
      p_end: range.end,
      p_bucket: range.bucket,
      p_time_zone: Intl.DateTimeFormat().resolvedOptions().timeZone || "America/New_York"
    });
    if (analyticsError) setError(analyticsError.message);
    else setAnalytics((data as AdminAnalytics | null) ?? emptyAdminAnalytics);
    setAnalyticsLoading(false);
  }

  useEffect(() => {
    void loadOperations();
  }, []);

  useEffect(() => {
    if (rangePreset === "custom" && (!customStart || !customEnd || customStart > customEnd)) return;
    void loadAnalytics();
  }, [rangePreset, customStart, customEnd]);

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
    else {
      setMessage(decision === "approve" ? "Instructor approved for membership checkout." : "Instructor profile updated.");
      await loadOperations();
    }
  }

  async function grantAdmin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const client = getMarketplaceClient();
    if (!client) return;
    setBusyId("grant-admin");
    setError(null);
    setMessage(null);
    const { error: grantError } = await client.rpc("grant_marketplace_admin", { p_email: grantEmail.trim() });
    setBusyId(null);
    if (grantError) setError(grantError.message);
    else {
      setGrantEmail("");
      setMessage("Admin access granted.");
      await loadOperations();
    }
  }

  async function revokeAdmin(accountId: string) {
    const client = getMarketplaceClient();
    if (!client) return;
    setBusyId(accountId);
    setError(null);
    setMessage(null);
    const { error: revokeError } = await client.rpc("revoke_marketplace_admin", { p_account_id: accountId });
    setBusyId(null);
    if (revokeError) setError(revokeError.message);
    else {
      setMessage("Admin access revoked.");
      await loadOperations();
    }
  }

  function mediaUrl(item: ProfileMedia) {
    if (item.external_url) return item.external_url;
    const client = getMarketplaceClient();
    if (!client || !item.storage_path) return "";
    return client.storage.from("instructor-media").getPublicUrl(item.storage_path).data.publicUrl;
  }

  const pending = profiles.filter((profile) => profile.status === "pending_review");
  const deliveryFailures = jobs.filter((job) => job.status === "failed");

  const summary = analytics.summary;

  return (
    <>
      <div className={styles.tabs} role="tablist" aria-label="Admin dashboard sections">
        {(isOwner
          ? (["overview", "profiles", "delivery", "access"] as const)
          : (["overview", "profiles", "delivery"] as const)
        ).map((name) => (
          <button key={name} className={`${styles.tab} ${tab === name ? styles.activeTab : ""}`} type="button" onClick={() => setTab(name)}>
            {name[0].toUpperCase() + name.slice(1)}
          </button>
        ))}
      </div>
      {error ? <p className={styles.error}>{error}</p> : null}
      {message ? <p className={styles.success}>{message}</p> : null}
      {loading ? <div className={styles.loading}>Loading marketplace operations...</div> : null}

      {!loading && tab === "overview" ? (
        <>
          <div className={`${styles.card} ${styles.filterBar}`}>
            <div>
              <h2>Marketplace performance</h2>
              <p className={styles.muted}>Every submitted contact form counts as one inquiry. Booking activity uses the date it was reported, and completed gigs use the confirmed event date.</p>
            </div>
            <label className={styles.field}>
              <span>Time frame</span>
              <select value={rangePreset} onChange={(event) => setRangePreset(event.target.value as AdminRangePreset)}>
                <option value="today">Today</option>
                <option value="7d">Last 7 days</option>
                <option value="30d">Last 30 days</option>
                <option value="12m">Last 12 months</option>
                <option value="all">All time</option>
                <option value="custom">Custom</option>
              </select>
            </label>
            {rangePreset === "custom" ? (
              <>
                <label className={styles.field}><span>Start</span><input type="date" value={customStart} onChange={(event) => setCustomStart(event.target.value)} /></label>
                <label className={styles.field}><span>End</span><input type="date" value={customEnd} onChange={(event) => setCustomEnd(event.target.value)} /></label>
              </>
            ) : null}
          </div>

          {analyticsLoading ? <div className={styles.loading}>Calculating marketplace results...</div> : (
            <>
              <div className={styles.metricGrid}>
                <article className={styles.metricCard}><span>Inquiries</span><strong>{summary.inquiries}</strong></article>
                <article className={styles.metricCard}><span>Instructors contacted</span><strong>{summary.instructors}</strong></article>
                <article className={styles.metricCard}><span>Companies</span><strong>{summary.companies}</strong></article>
                <article className={styles.metricCard}><span>Bookings reported</span><strong>{summary.booked}</strong><small>{percent(summary.cohort_booked, summary.inquiries)} conversion among selected inquiries</small></article>
                <article className={styles.metricCard}><span>Completed gigs</span><strong>{summary.completed}</strong><small>{percent(summary.cohort_completed, summary.cohort_booked)} completion among selected bookings</small></article>
                <article className={styles.metricCard}><span>In progress</span><strong>{summary.in_progress}</strong></article>
              </div>

              <div className={styles.card}>
                <h2>Activity over time</h2>
                {!analytics.series.length ? <p className={styles.notice}>No inquiry activity in this time frame.</p> : (
                  <div className={styles.tableWrap}>
                    <table className={styles.dataTable}>
                      <thead><tr><th>Period</th><th>Inquiries</th><th>Booked</th><th>Completed</th></tr></thead>
                      <tbody>{analytics.series.map((row) => (
                        <tr key={row.period_start}><td>{new Date(`${row.period_start}T12:00:00`).toLocaleDateString()}</td><td>{row.inquiries}</td><td>{row.booked}</td><td>{row.completed}</td></tr>
                      ))}</tbody>
                    </table>
                  </div>
                )}
              </div>

              <div className={styles.card}>
                <h2>Performance by instructor</h2>
                <p className={styles.muted}>Booking and completion columns show the current results for inquiries submitted during this time frame.</p>
                <div className={styles.tableWrap}>
                  <table className={styles.dataTable}>
                    <thead><tr><th>Instructor</th><th>Inquiries</th><th>Companies</th><th>Booked</th><th>Completed</th><th>Booking rate</th></tr></thead>
                    <tbody>{analytics.instructors.map((row) => (
                      <tr key={row.instructor_key}><td>{row.instructor_name}</td><td>{row.inquiries}</td><td>{row.companies}</td><td>{row.booked}</td><td>{row.completed}</td><td>{percent(row.booked, row.inquiries)}</td></tr>
                    ))}</tbody>
                  </table>
                </div>
              </div>

              <div className={styles.card}>
                <h2>Inquiries by instructor and company</h2>
                <p className={styles.muted}>Use this view to see how many times each company or organizer contacted a specific instructor.</p>
                <div className={styles.tableWrap}>
                  <table className={styles.dataTable}>
                    <thead><tr><th>Instructor</th><th>Company</th><th>Inquiries</th><th>Booked</th><th>Completed</th><th>Latest inquiry</th></tr></thead>
                    <tbody>{analytics.instructor_companies.map((row) => (
                      <tr key={`${row.instructor_key}:${row.company_key}`}>
                        <td>{row.instructor_name}</td>
                        <td>{row.company_name}{row.contact_email ? <small>{row.contact_email}</small> : null}</td>
                        <td>{row.inquiries}</td><td>{row.booked}</td><td>{row.completed}</td>
                        <td>{new Date(row.latest_inquiry_at).toLocaleDateString()}</td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
              </div>

              <div className={styles.card}>
                <h2>Performance by company or organizer</h2>
                <div className={styles.tableWrap}>
                  <table className={styles.dataTable}>
                    <thead><tr><th>Company</th><th>Inquiries</th><th>Instructors</th><th>Booked</th><th>Completed</th><th>Latest inquiry</th></tr></thead>
                    <tbody>{analytics.companies.map((row) => (
                      <tr key={row.company_key}><td>{row.company_name}{row.contact_email ? <small>{row.contact_email}</small> : null}</td><td>{row.inquiries}</td><td>{row.instructors}</td><td>{row.booked}</td><td>{row.completed}</td><td>{new Date(row.latest_inquiry_at).toLocaleDateString()}</td></tr>
                    ))}</tbody>
                  </table>
                </div>
              </div>
            </>
          )}

          <div className={styles.card}>
            <h2>Recent inquiries</h2>
            <div className={styles.tableWrap}>
              <table className={styles.dataTable}>
                <thead><tr><th>Submitted</th><th>Company</th><th>Instructor</th><th>Event</th><th>Booking</th><th>Completion</th></tr></thead>
                <tbody>{inquiries.slice(0, 30).map((inquiry) => (
                  <tr key={inquiry.id}>
                    <td>{new Date(inquiry.created_at).toLocaleDateString()}</td>
                    <td>{inquiry.company_name || inquiry.contact_name || "Individual organizer"}</td>
                    <td>{inquiry.instructor_name || "Instructor"}</td>
                    <td>{[inquiry.event_type, inquiry.event_date].filter(Boolean).join(" · ")}</td>
                    <td><span className={styles.status}>{inquiry.booking_outcome.replaceAll("_", " ")}</span></td>
                    <td><span className={styles.status}>{inquiry.completion_status.replaceAll("_", " ")}</span></td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          </div>

          <div className={styles.card}>
            <h2>Recent instructor feedback</h2>
            {!followupResponses.length ? <p className={styles.notice}>No instructor follow-up responses yet.</p> : (
              <div className={styles.list}>{followupResponses.slice(0, 20).map((response) => {
                const inquiry = inquiries.find((item) => item.id === response.inquiry_id);
                return (
                  <article className={styles.listItem} key={response.id}>
                    <div className={styles.buttonRow}><strong>{inquiry?.instructor_name || "Instructor"}</strong><span className={styles.status}>{response.stage}: {response.response.replaceAll("_", " ")}</span></div>
                    <p>{[inquiry?.company_name || inquiry?.contact_name, response.confirmed_event_date].filter(Boolean).join(" · ")}</p>
                    {response.private_comment ? <p>{response.private_comment}</p> : <p>No additional comment.</p>}
                  </article>
                );
              })}</div>
            )}
          </div>
        </>
      ) : null}

      {!loading && tab === "profiles" ? (
        <>
          <div className={styles.card}>
            <h2>Profiles awaiting review</h2>
            <p className={styles.muted}>Review the profile copy and all uploaded media before approval. Approval unlocks membership checkout and the 30-day free trial.</p>
            {!pending.length ? <p className={styles.notice}>No profiles are waiting for review.</p> : null}
            <div className={styles.list}>
              {pending.map((profile) => {
                const profileMedia = media.filter((item) => item.instructor_profile_id === profile.id);
                return (
                  <article className={styles.listItem} key={profile.id}>
                    <div className={styles.buttonRow}><h3>{profile.display_name}</h3><span className={styles.status}>{profile.status.replace("_", " ")}</span></div>
                    <p>{[profile.business_name, profile.city, profile.region].filter(Boolean).join(" · ")}</p>
                    <p>{profile.bio || "No bio provided."}</p>
                    <p>Events: {profile.event_types.length ? profile.event_types.join(", ") : "None selected"}</p>
                    {!profileMedia.length ? <p className={styles.error}>No profile media has been uploaded.</p> : (
                      <div className={styles.mediaGrid}>{profileMedia.map((item) => (
                        <div className={styles.mediaItem} key={item.id}>
                          {item.media_type === "video" || item.media_type === "welcome_video" ? (
                            <video className={styles.mediaPreview} src={mediaUrl(item)} controls preload="metadata" />
                          ) : (
                            // Uploaded user content has a runtime URL that Next Image cannot optimize during static export.
                            // eslint-disable-next-line @next/next/no-img-element
                            <img className={styles.mediaPreview} src={mediaUrl(item)} alt={item.caption || item.media_type} />
                          )}
                          <span className={styles.status}>{item.media_type.replace("_", " ")}</span>
                        </div>
                      ))}</div>
                    )}
                    <div className={styles.grid}>
                      <label className={styles.field}><span>Public profile slug</span><input value={slugs[profile.id] ?? ""} onChange={(event) => setSlugs((current) => ({ ...current, [profile.id]: event.target.value }))} /></label>
                      <label className={styles.field}><span>Review note</span><input value={notes[profile.id] ?? ""} onChange={(event) => setNotes((current) => ({ ...current, [profile.id]: event.target.value }))} /></label>
                    </div>
                    <div className={styles.buttonRow}>
                      <button className={styles.button} disabled={busyId === profile.id} type="button" onClick={() => void review(profile.id, "approve")}>Approve for payment</button>
                      <button className={styles.dangerButton} disabled={busyId === profile.id} type="button" onClick={() => void review(profile.id, "return_to_draft")}>Request changes</button>
                    </div>
                  </article>
                );
              })}
            </div>
          </div>

          <div className={styles.card}>
            <h2>All instructor profiles</h2>
            <div className={styles.tableWrap}>
              <table className={styles.dataTable}>
                <thead><tr><th>Instructor</th><th>Location</th><th>Status</th><th>Action</th></tr></thead>
                <tbody>{profiles.map((profile) => (
                  <tr key={profile.id}>
                    <td>{profile.display_name}</td><td>{[profile.city, profile.region].filter(Boolean).join(", ")}</td><td><span className={styles.status}>{profile.status.replaceAll("_", " ")}</span></td>
                    <td>{["approved", "published"].includes(profile.status) ? <button className={styles.dangerButton} disabled={busyId === profile.id} type="button" onClick={() => void review(profile.id, "suspend")}>Suspend</button> : null}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          </div>
        </>
      ) : null}

      {!loading && tab === "delivery" ? (
        <div className={styles.card}>
          <div className={styles.buttonRow}><h2>Notification delivery</h2><span className={styles.status}>{deliveryFailures.length} failed</span></div>
          <div className={styles.list}>
            {jobs.slice(0, 100).map((job) => (
              <article className={styles.listItem} key={job.id}>
                <div className={styles.buttonRow}><strong>{job.channel.toUpperCase()} · {job.notification_type.replaceAll("_", " ")}</strong><span className={styles.status}>{job.status}</span></div>
                <p>{new Date(job.created_at).toLocaleString()} · {job.attempts} attempt{job.attempts === 1 ? "" : "s"}</p>
                {job.last_error ? <p className={styles.error}>{job.last_error}</p> : null}
              </article>
            ))}
          </div>
        </div>
      ) : null}

      {!loading && tab === "access" && isOwner ? (
        <div className={styles.card}>
          <h2>Admin access</h2>
          <p className={styles.muted}>Only people listed here can open the admin dashboard or query marketplace reports. A new admin must sign in once before you grant access.</p>
          <form className={styles.filterBar} onSubmit={grantAdmin}>
            <label className={styles.field}><span>Account email</span><input type="email" required value={grantEmail} onChange={(event) => setGrantEmail(event.target.value)} placeholder="person@example.com" /></label>
            <button className={styles.button} disabled={busyId === "grant-admin"} type="submit">{busyId === "grant-admin" ? "Granting..." : "Grant admin access"}</button>
          </form>
          <div className={styles.list}>{admins.map((admin) => (
            <article className={styles.listItem} key={admin.account_id}>
              <div><h3>{admin.full_name || admin.email || "Administrator"}</h3><p>{admin.email}</p></div>
              <div className={styles.buttonRow}>
                <span className={styles.status}>{admin.is_owner ? "Owner" : "Admin"}</span>
                {!admin.is_owner ? <button className={styles.dangerButton} disabled={busyId === admin.account_id} type="button" onClick={() => void revokeAdmin(admin.account_id)}>Revoke access</button> : null}
              </div>
            </article>
          ))}</div>
        </div>
      ) : null}
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
  onChange,
  focusInquiryId = null,
  focusFollowup = null,
  onFeedbackSubmitted
}: {
  inquiries: MarketplaceInquiry[];
  perspective: "organizer" | "instructor";
  onChange: () => void;
  focusInquiryId?: string | null;
  focusFollowup?: "booking" | "completion" | null;
  onFeedbackSubmitted?: () => void;
}) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [comments, setComments] = useState<Record<string, string>>({});
  const [eventDates, setEventDates] = useState<Record<string, string>>(() => Object.fromEntries(
    inquiries.map((inquiry) => [inquiry.id, inquiry.booking_event_date || inquiry.event_date || ""])
  ));

  useEffect(() => {
    if (!focusInquiryId || !inquiries.some((inquiry) => inquiry.id === focusInquiryId)) return;
    const timer = window.setTimeout(() => {
      document.getElementById(`inquiry-${focusInquiryId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 100);
    return () => window.clearTimeout(timer);
  }, [focusInquiryId, inquiries]);

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

  async function submitInstructorFeedback(
    inquiry: MarketplaceInquiry,
    stage: "booking" | "completion",
    response: string
  ) {
    const client = getMarketplaceClient();
    if (!client) return;
    const requestId = `${inquiry.id}:${stage}`;
    setBusyId(requestId);
    setError(null);
    const { error: actionError } = await client.rpc("submit_instructor_inquiry_feedback", {
      p_inquiry_id: inquiry.id,
      p_stage: stage,
      p_response: response,
      p_private_comment: comments[requestId]?.trim() || null,
      p_confirmed_event_date: stage === "booking" && response === "booked"
        ? eventDates[inquiry.id] || inquiry.event_date
        : null
    });
    setBusyId(null);
    if (actionError) setError(actionError.message);
    else {
      onChange();
      onFeedbackSubmitted?.();
    }
  }

  if (!inquiries.length) {
    return <p className={styles.notice}>{perspective === "instructor" ? "No inquiries yet. New inquiries will appear here and arrive by email." : "You have not contacted an instructor yet."}</p>;
  }

  return (
    <div className={styles.list}>
      {error ? <p className={styles.error}>{error}</p> : null}
      {focusInquiryId && !inquiries.some((inquiry) => inquiry.id === focusInquiryId) ? (
        <p className={styles.error}>That inquiry is not available in this instructor account.</p>
      ) : null}
      {inquiries.map((inquiry) => (
        <article
          className={`${styles.listItem} ${focusInquiryId === inquiry.id ? styles.focusedItem : ""}`}
          id={`inquiry-${inquiry.id}`}
          key={inquiry.id}
        >
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
            {perspective === "organizer" && (inquiry.booking_outcome === "unknown" || inquiry.booking_outcome === "still_deciding") ? (
              <>
                <button className={styles.button} disabled={busyId === inquiry.id} type="button" onClick={() => void reportOutcome(inquiry.id, "booked")}>Booked</button>
                <button className={styles.dangerButton} disabled={busyId === inquiry.id} type="button" onClick={() => void reportOutcome(inquiry.id, "not_booked")}>Not booked</button>
              </>
            ) : null}
          </div>

          {perspective === "instructor" ? (
            <div className={`${styles.feedbackPanel} ${focusInquiryId === inquiry.id && focusFollowup === "booking" ? styles.focusedFeedback : ""}`}>
              <div>
                <strong>Did this inquiry turn into a booking?</strong>
                <p>Current result: {inquiry.booking_outcome.replaceAll("_", " ")}</p>
              </div>
              <label className={styles.field}>
                <span>Confirmed event date</span>
                <input disabled={inquiry.completion_status !== "unknown"} type="date" value={eventDates[inquiry.id] ?? inquiry.event_date ?? ""} onChange={(event) => setEventDates((current) => ({ ...current, [inquiry.id]: event.target.value }))} />
              </label>
              <label className={styles.field}>
                <span>Private comments (optional)</span>
                <textarea
                  disabled={inquiry.completion_status !== "unknown"}
                  maxLength={2000}
                  placeholder="Your feedback helps us improve Hire Line Dancers."
                  value={comments[`${inquiry.id}:booking`] ?? ""}
                  onChange={(event) => setComments((current) => ({ ...current, [`${inquiry.id}:booking`]: event.target.value }))}
                />
              </label>
              <p className={styles.help}>Comments are visible only to you and Hire Line Dancers administrators.</p>
              {inquiry.completion_status !== "unknown" ? <p className={styles.notice}>The booking result is locked because event completion has already been recorded.</p> : null}
              <div className={styles.buttonRow}>
                <button className={styles.button} disabled={inquiry.completion_status !== "unknown" || busyId === `${inquiry.id}:booking`} type="button" onClick={() => void submitInstructorFeedback(inquiry, "booking", "booked")}>Yes, booked</button>
                <button className={styles.dangerButton} disabled={inquiry.completion_status !== "unknown" || busyId === `${inquiry.id}:booking`} type="button" onClick={() => void submitInstructorFeedback(inquiry, "booking", "not_booked")}>No</button>
                <button className={styles.secondaryButton} disabled={inquiry.completion_status !== "unknown" || busyId === `${inquiry.id}:booking`} type="button" onClick={() => void submitInstructorFeedback(inquiry, "booking", "still_deciding")}>In progress</button>
              </div>
            </div>
          ) : null}

          {perspective === "instructor" && inquiry.booking_outcome === "booked" ? (() => {
            const bookingDate = inquiry.booking_event_date || inquiry.event_date;
            const eventHasArrived = !bookingDate || bookingDate <= dateInputValue(new Date());
            return (
              <div className={`${styles.feedbackPanel} ${focusInquiryId === inquiry.id && focusFollowup === "completion" ? styles.focusedFeedback : ""}`}>
                <div>
                  <strong>Did the booked event happen?</strong>
                  <p>Current result: {inquiry.completion_status.replaceAll("_", " ")}</p>
                </div>
                {!eventHasArrived ? <p className={styles.notice}>This question opens after the event date, {new Date(`${bookingDate}T00:00:00`).toLocaleDateString()}.</p> : null}
                <label className={styles.field}>
                  <span>Private comments (optional)</span>
                  <textarea
                    maxLength={2000}
                    placeholder="Tell us what went well or what could be better."
                    value={comments[`${inquiry.id}:completion`] ?? ""}
                    onChange={(event) => setComments((current) => ({ ...current, [`${inquiry.id}:completion`]: event.target.value }))}
                  />
                </label>
                <p className={styles.help}>Comments are visible only to you and Hire Line Dancers administrators.</p>
                <div className={styles.buttonRow}>
                  <button className={styles.button} disabled={!eventHasArrived || busyId === `${inquiry.id}:completion`} type="button" onClick={() => void submitInstructorFeedback(inquiry, "completion", "completed")}>Yes, it happened</button>
                  <button className={styles.dangerButton} disabled={!eventHasArrived || busyId === `${inquiry.id}:completion`} type="button" onClick={() => void submitInstructorFeedback(inquiry, "completion", "did_not_happen")}>No</button>
                </div>
              </div>
            );
          })() : null}
        </article>
      ))}
    </div>
  );
}
