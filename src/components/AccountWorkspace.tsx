"use client";

import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { cities, eventTypes } from "@/data/site";
import { useMarketplaceSession } from "@/hooks/useMarketplaceSession";
import {
  cleanAccountIntent,
  cleanReturnPath,
  getMarketplaceClient,
  loginUrl,
  readableError,
  type AccountIntent,
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

type InstructorTab = "profile" | "inquiries" | "membership";

export function AccountWorkspace({ adminOnly = false }: { adminOnly?: boolean }) {
  const { session, account, isAdmin, isOwner, loading, error, configured, refresh } = useMarketplaceSession();
  const [signingOut, setSigningOut] = useState(false);
  const [workspaceMode, setWorkspaceMode] = useState<"admin" | "account">("admin");
  const [entryIntent, setEntryIntent] = useState<AccountIntent | null | undefined>(undefined);
  const [entryReturnTo, setEntryReturnTo] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setEntryIntent(cleanAccountIntent(params.get("intent")));
    const requestedReturn = params.get("returnTo");
    setEntryReturnTo(requestedReturn ? cleanReturnPath(requestedReturn) : null);
  }, []);

  useEffect(() => {
    if (entryIntent === undefined || !account?.role) return;
    if (account.role === entryIntent && entryReturnTo) {
      window.location.replace(entryReturnTo);
      return;
    }

    const url = new URL(window.location.href);
    if (!url.searchParams.has("intent") && !url.searchParams.has("returnTo")) return;
    url.searchParams.delete("intent");
    url.searchParams.delete("returnTo");
    window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
  }, [account?.role, entryIntent, entryReturnTo]);

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

  if (loading || entryIntent === undefined) return <div className={styles.loading}>Loading your account...</div>;

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
    const next = adminOnly ? "/admin/" : entryReturnTo ?? "/account/";
    return (
      <section className={`${styles.shell} ${styles.narrow}`}>
        <p className={styles.eyebrow}>Your account</p>
        <h1 className={styles.title}>Sign in to continue</h1>
        <p className={styles.subtitle}>Manage your instructor profile or keep track of the instructors you contacted.</p>
        <div className={styles.buttonRow} style={{ marginTop: 28 }}>
          <a className={styles.button} href={loginUrl(next, entryIntent ?? undefined)}>Sign in</a>
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
    const isInstructorEntry = entryIntent === "instructor";
    const isOrganizerEntry = entryIntent === "organizer";
    return (
      <section className={`${styles.shell} ${styles.narrow}`}>
        <p className={styles.eyebrow}>{isInstructorEntry ? "Instructor account" : isOrganizerEntry ? "Organizer account" : "One quick step"}</p>
        <h1 className={styles.title}>{isInstructorEntry ? "Set up your instructor workspace" : isOrganizerEntry ? "Set up your organizer workspace" : "How will you use Hire Line Dancers?"}</h1>
        <p className={styles.subtitle}>
          {isInstructorEntry
            ? "Add your account details, then complete your public instructor profile."
            : isOrganizerEntry
              ? "Add your account details, then you can contact instructors and track your inquiries."
              : "Choose the account workspace you need. You can contact support later if you need both."}
        </p>
        {error ? <p className={styles.error}>{error}</p> : null}
        <OnboardingForm
          email={session.user.email ?? ""}
          initialName={account?.full_name ?? session.user.user_metadata.full_name ?? ""}
          fixedRole={entryIntent ?? undefined}
          onComplete={async () => {
            if (entryReturnTo) {
              window.location.replace(entryReturnTo);
              return;
            }
            await refresh();
            window.history.replaceState({}, "", "/account/");
          }}
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
  fixedRole,
  onComplete
}: {
  email: string;
  initialName: string;
  fixedRole?: AccountIntent;
  onComplete: () => void | Promise<void>;
}) {
  const [role, setRole] = useState<AccountRole>(fixedRole ?? "organizer");
  const [name, setName] = useState(initialName);
  const [company, setCompany] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const client = getMarketplaceClient();
    if (!client) return;

    setBusy(true);
    setError(null);
    const { error: rpcError } = await client.rpc("complete_account_onboarding", {
      p_role: role,
      p_full_name: name.trim(),
      p_company_name: company.trim() || null,
      p_phone_e164: null,
      p_sms_opt_in: false
    });
    setBusy(false);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    await onComplete();
  }

  return (
    <form className={`${styles.card} ${styles.stack}`} onSubmit={submit}>
      {!fixedRole ? (
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
      ) : null}

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
      {error ? <p className={styles.error} role="alert">{error}</p> : null}
      <button className={styles.button} disabled={busy} type="submit">
        {busy ? "Saving..." : role === "instructor" ? "Open instructor workspace" : "Open organizer workspace"}
      </button>
    </form>
  );
}

function InstructorDashboard({ account }: { account: MarketplaceAccount }) {
  const [tab, setTab] = useState<InstructorTab>("profile");
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
    if (requestedTab === "media") {
      setTab("profile");
      const url = new URL(window.location.href);
      url.searchParams.set("tab", "profile");
      window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
      return;
    }
    if (["profile", "inquiries", "membership"].includes(requestedTab ?? "")) {
      setTab(requestedTab as InstructorTab);
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

  function chooseTab(name: InstructorTab) {
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
        {(["profile", "inquiries", "membership"] as const).map((name) => (
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
      inquiry_phone_e164: null,
      sms_notifications_enabled: false,
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
  const selectedMarket = cities.find((market) => market.city === form.city && market.state === form.region);

  function selectMarket(slug: string) {
    const market = cities.find((item) => item.slug === slug);
    if (!market) return;
    setForm((current) => ({ ...current, city: market.city, region: market.state }));
  }

  return (
    <div className={`${styles.card} ${styles.stack}`}>
      <div className={styles.buttonRow}>
        <span className={styles.status}>{profile.status.replace("_", " ")}</span>
        {profile.status === "pending_review" ? <span className={styles.muted}>We will email you after the review.</span> : null}
      </div>
      {!canEdit ? <p className={styles.notice}>Editing is paused while your profile is in review or awaiting membership activation.</p> : null}

      <div className={`${styles.grid} ${styles.alignedGrid}`}>
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
        <span>About you</span>
        <textarea disabled={!canEdit} maxLength={2000} value={form.bio} onChange={(e) => setValue("bio", e.target.value)} />
      </label>

      <ProfileMediaManager profile={profile} />

      <div className={`${styles.grid} ${styles.alignedGrid}`}>
        <label className={styles.field}>
          <span>City or metro area</span>
          <select disabled={!canEdit} required value={selectedMarket?.slug ?? ""} onChange={(e) => selectMarket(e.target.value)}>
            <option value="">Select one of our launch areas</option>
            {cities.map((market) => (
              <option key={market.slug} value={market.slug}>{market.city}, {market.state}</option>
            ))}
          </select>
        </label>
        <label className={styles.field}>
          <span>ZIP code</span>
          <input disabled={!canEdit} value={form.postal_code} onChange={(e) => setValue("postal_code", e.target.value)} />
        </label>
        <label className={styles.field}>
          <span>Travel radius in miles</span>
          <input disabled={!canEdit} type="number" min="0" max="1000" value={form.travel_radius_miles} onChange={(e) => setValue("travel_radius_miles", e.target.value)} />
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

      <div className={`${styles.grid} ${styles.alignedGrid}`}>
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

      <div className={`${styles.grid} ${styles.alignedGrid}`}>
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
      <div className={`${styles.grid} ${styles.alignedGrid}`}>
        <label className={styles.field}>
          <span>Verified inquiry email</span>
          <input disabled type="email" value={form.inquiry_email} />
          <small>Inquiry alerts go to the email verified through your account sign-in.</small>
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
    <section className={`${styles.profileMediaSection} ${styles.stack}`} aria-labelledby="profile-media-heading">
      <div>
        <h2 id="profile-media-heading">Profile photos and videos</h2>
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
    </section>
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

  const hasPriorSubscription = Boolean(settings?.stripe_subscription_id);
  const canManage = profile.status === "published"
    || ["trialing", "active", "past_due", "unpaid", "paused"].includes(settings?.subscription_status ?? "");

  return (
    <div className={styles.card}>
      <p className={styles.eyebrow}>Instructor membership</p>
      <h2>$14.99 per month</h2>
      <p>Activate your instructor membership after your profile is approved. Stripe securely processes payment, and your membership renews monthly until canceled. Eligible founding memberships include the first-year booking guarantee described in the refund policy.</p>
      <p><span className={styles.status}>{settings?.subscription_status ?? "inactive"}</span></p>
      {profile.status === "approved" ? (
        <>
          {checkoutPending ? (
            <p className={styles.notice}>Stripe received your checkout. We are confirming your membership now. This usually takes a few seconds.</p>
          ) : (
            <>
              <p>Your profile has been approved. {hasPriorSubscription ? "Restart your membership" : "Activate your membership"} to publish it in the directory.</p>
              <button className={styles.button} type="button" disabled={busy !== null} onClick={() => void activateMembership()}>
                {busy === "checkout" ? "Opening secure checkout..." : hasPriorSubscription ? "Restart membership" : "Activate membership"}
              </button>
              <p className={styles.muted}>By selecting this button, you agree to the <a href="/legal/terms/">Terms of Use</a>, acknowledge the <a href="/legal/refund-policy/">Refund Policy</a>, and authorize a recurring $14.99 monthly charge until you cancel.</p>
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

type AdminInstructorMembership = {
  instructor_profile_id: string;
  account_id: string;
  display_name: string;
  business_name: string | null;
  account_email: string | null;
  inquiry_email: string | null;
  city: string | null;
  region: string | null;
  profile_status: string;
  subscription_status: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  stripe_livemode: boolean | null;
  founding_member_number: number | null;
  founding_status: string;
  guarantee_status: string;
  guarantee_started_at: string | null;
  guarantee_ends_at: string | null;
  claim_deadline_at: string | null;
  guarantee_admin_note: string | null;
  qualifying_booking_count: number;
  claim_id: string | null;
  claim_status: string | null;
  claim_received_at: string | null;
  claim_received_via: string | null;
  claimant_email: string | null;
  requested_amount_cents: number | null;
  approved_refund_amount_cents: number | null;
  profile_complete_confirmed: boolean | null;
  contact_details_current_confirmed: boolean | null;
  response_requirement_confirmed: boolean | null;
  claim_admin_note: string | null;
  decision_reason: string | null;
  verified_refund_cents: number;
  refund_count: number;
  refunded: boolean;
  latest_refunded_at: string | null;
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

function statusLabel(value: string | null) {
  return (value || "not started").replaceAll("_", " ");
}

function money(cents: number | null | undefined) {
  if (cents == null) return "Not entered";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}

function adminDate(value: string | null) {
  return value ? new Date(value).toLocaleDateString() : "Not set";
}

function dollarsToCents(value: string) {
  if (!value.trim()) return null;
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return Math.round(amount * 100);
}

function stripeCustomerUrl(customerId: string, livemode: boolean | null) {
  const mode = livemode === true ? "" : "/test";
  return `https://dashboard.stripe.com${mode}/customers/${encodeURIComponent(customerId)}`;
}

async function edgeFunctionError(error: unknown) {
  if (error && typeof error === "object" && "context" in error) {
    const context = (error as { context?: unknown }).context;
    if (context instanceof Response) {
      const payload = await context.clone().json().catch(() => null) as { error?: unknown } | null;
      if (typeof payload?.error === "string") return payload.error;
    }
  }
  return readableError(error);
}

function MembershipGuaranteeAdmin({ isOwner }: { isOwner: boolean }) {
  const [search, setSearch] = useState("");
  const [rows, setRows] = useState<AdminInstructorMembership[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [foundingStatus, setFoundingStatus] = useState("unassigned");
  const [guaranteeStatus, setGuaranteeStatus] = useState("not_started");
  const [guaranteeNote, setGuaranteeNote] = useState("");
  const [claimSource, setClaimSource] = useState("email");
  const [claimantEmail, setClaimantEmail] = useState("");
  const [requestedAmount, setRequestedAmount] = useState("");
  const [instructorMessage, setInstructorMessage] = useState("");
  const [claimNote, setClaimNote] = useState("");
  const [reviewStatus, setReviewStatus] = useState("in_review");
  const [approvedAmount, setApprovedAmount] = useState("");
  const [profileConfirmed, setProfileConfirmed] = useState(false);
  const [contactConfirmed, setContactConfirmed] = useState(false);
  const [responseConfirmed, setResponseConfirmed] = useState(false);
  const [reviewNote, setReviewNote] = useState("");
  const [decisionReason, setDecisionReason] = useState("");
  const [refundId, setRefundId] = useState("");
  const [refundIssuedConfirmed, setRefundIssuedConfirmed] = useState(false);

  const selected = useMemo(
    () => rows.find((row) => row.instructor_profile_id === selectedProfileId) ?? null,
    [rows, selectedProfileId]
  );

  async function loadMemberships(query = search) {
    const client = getMarketplaceClient();
    if (!client) return;
    setLoading(true);
    setError(null);
    const { data, error: searchError } = await client.rpc("admin_search_instructors", {
      p_search: query.trim() || null,
      p_limit: 100,
      p_offset: 0
    });
    if (searchError) {
      setError(searchError.message);
      setRows([]);
    } else {
      const nextRows = (data as AdminInstructorMembership[] | null) ?? [];
      setRows(nextRows);
      setSelectedProfileId((current) => (
        current && nextRows.some((row) => row.instructor_profile_id === current)
          ? current
          : nextRows[0]?.instructor_profile_id ?? null
      ));
    }
    setLoading(false);
  }

  useEffect(() => {
    void loadMemberships("");
  }, []);

  useEffect(() => {
    if (!selected) return;
    setFoundingStatus(selected.founding_status || "unassigned");
    setGuaranteeStatus(selected.guarantee_status || "not_started");
    setGuaranteeNote(selected.guarantee_admin_note ?? "");
    setClaimSource(selected.claim_received_via ?? "email");
    setClaimantEmail(selected.claimant_email ?? selected.inquiry_email ?? selected.account_email ?? "");
    setRequestedAmount(selected.requested_amount_cents == null ? "" : (selected.requested_amount_cents / 100).toString());
    setClaimNote(selected.claim_admin_note ?? "");
    setReviewStatus(
      ["approved", "denied", "withdrawn", "refund_pending"].includes(selected.claim_status ?? "")
        ? selected.claim_status as string
        : "in_review"
    );
    setApprovedAmount(selected.approved_refund_amount_cents == null ? "" : (selected.approved_refund_amount_cents / 100).toString());
    setProfileConfirmed(Boolean(selected.profile_complete_confirmed));
    setContactConfirmed(Boolean(selected.contact_details_current_confirmed));
    setResponseConfirmed(Boolean(selected.response_requirement_confirmed));
    setReviewNote(selected.claim_admin_note ?? "");
    setDecisionReason(selected.decision_reason ?? "");
    setInstructorMessage("");
    setRefundId("");
    setRefundIssuedConfirmed(false);
  }, [selected]);

  async function searchMemberships(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    await loadMemberships(search);
  }

  async function saveGuarantee(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const client = getMarketplaceClient();
    if (!client || !selected || !isOwner) return;
    setBusy("guarantee");
    setError(null);
    setMessage(null);
    const { error: updateError } = await client.rpc("admin_update_instructor_guarantee", {
      p_instructor_profile_id: selected.instructor_profile_id,
      p_founding_status: foundingStatus,
      p_guarantee_status: guaranteeStatus,
      p_admin_note: guaranteeNote.trim() || null
    });
    setBusy(null);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    setMessage("Founding and guarantee status saved.");
    await loadMemberships(search);
  }

  async function logClaim(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const client = getMarketplaceClient();
    if (!client || !selected || !isOwner) return;
    const requestedCents = dollarsToCents(requestedAmount);
    if (requestedAmount.trim() && requestedCents == null) {
      setError("Enter a valid requested refund amount.");
      return;
    }
    setBusy("claim");
    setError(null);
    setMessage(null);
    const { error: claimError } = await client.rpc("admin_log_guarantee_claim", {
      p_instructor_profile_id: selected.instructor_profile_id,
      p_received_via: claimSource,
      p_claimant_email: claimantEmail.trim() || null,
      p_requested_amount_cents: requestedCents,
      p_instructor_message: instructorMessage.trim() || null,
      p_admin_note: claimNote.trim() || null
    });
    setBusy(null);
    if (claimError) {
      setError(claimError.message);
      return;
    }
    setMessage("Refund claim logged for review.");
    await loadMemberships(search);
  }

  async function reviewClaim(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const client = getMarketplaceClient();
    if (!client || !selected?.claim_id || !isOwner) return;
    const approvedCents = dollarsToCents(approvedAmount);
    if (["approved", "refund_pending"].includes(reviewStatus) && approvedCents == null) {
      setError("Enter the approved refund amount before approving this claim.");
      return;
    }
    setBusy("review");
    setError(null);
    setMessage(null);
    const { error: reviewError } = await client.rpc("admin_review_guarantee_claim", {
      p_claim_id: selected.claim_id,
      p_status: reviewStatus,
      p_profile_complete_confirmed: profileConfirmed,
      p_contact_details_current_confirmed: contactConfirmed,
      p_response_requirement_confirmed: responseConfirmed,
      p_approved_refund_amount_cents: approvedCents,
      p_admin_note: reviewNote.trim() || null,
      p_decision_reason: decisionReason.trim() || null
    });
    setBusy(null);
    if (reviewError) {
      setError(reviewError.message);
      return;
    }
    setMessage("Claim review saved. No money was moved.");
    await loadMemberships(search);
  }

  async function verifyRefund(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const client = getMarketplaceClient();
    if (!client || !selected?.claim_id || !isOwner) return;
    if (!refundIssuedConfirmed) {
      setError("Confirm that you already issued the refund in Stripe.");
      return;
    }
    if (!/^re_[A-Za-z0-9]+$/.test(refundId.trim())) {
      setError("Enter the Stripe refund ID beginning with re_.");
      return;
    }
    setBusy("refund");
    setError(null);
    setMessage(null);
    const { data, error: verifyError } = await client.functions.invoke("verify-instructor-refund", {
      body: { claimId: selected.claim_id, refundId: refundId.trim() }
    });
    setBusy(null);
    if (verifyError) {
      setError(await edgeFunctionError(verifyError));
      return;
    }
    if (data?.error) {
      setError(String(data.error));
      return;
    }
    setMessage(`Stripe verified ${money(Number(data?.amountCents ?? 0))}. Claim status: ${statusLabel(String(data?.claimStatus ?? "updated"))}.`);
    setRefundId("");
    setRefundIssuedConfirmed(false);
    await loadMemberships(search);
  }

  return (
    <div className={styles.membershipAdminLayout}>
      <div className={styles.card}>
        <p className={styles.eyebrow}>Instructor operations</p>
        <h2>Memberships and guarantees</h2>
        <p className={styles.muted}>Search by instructor name, business, email, city, or state. Refunds are issued manually in Stripe and verified here afterward.</p>
        <form className={styles.membershipSearch} onSubmit={searchMemberships}>
          <label className={styles.field}>
            <span>Search instructors</span>
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Name, email, or city" />
          </label>
          <button className={styles.button} disabled={loading} type="submit">{loading ? "Searching..." : "Search"}</button>
        </form>
        {error ? <p className={styles.error} role="alert">{error}</p> : null}
        {message ? <p className={styles.success}>{message}</p> : null}
        {!loading && !rows.length ? <p className={styles.notice}>No instructors match this search.</p> : null}
        <div className={styles.membershipResults}>
          {rows.map((row) => (
            <button
              className={`${styles.membershipResult} ${selectedProfileId === row.instructor_profile_id ? styles.selectedMembershipResult : ""}`}
              key={row.instructor_profile_id}
              type="button"
              onClick={() => setSelectedProfileId(row.instructor_profile_id)}
            >
              <span><strong>{row.display_name}</strong>{row.business_name ? <small>{row.business_name}</small> : null}</span>
              <span><small>{[row.city, row.region].filter(Boolean).join(", ") || "Location not set"}</small><small>{row.account_email}</small></span>
              <span className={styles.resultStatuses}>
                <span className={styles.status}>{statusLabel(row.subscription_status)}</span>
                {row.refunded ? <span className={styles.verifiedBadge}>Refund verified</span> : null}
              </span>
            </button>
          ))}
        </div>
      </div>

      {selected ? (
        <div className={styles.membershipDetail}>
          <div className={styles.card}>
            <div className={styles.membershipHeader}>
              <div>
                <p className={styles.eyebrow}>Selected instructor</p>
                <h2>{selected.display_name}</h2>
                <p className={styles.muted}>{[selected.business_name, selected.city, selected.region].filter(Boolean).join(" · ")}</p>
              </div>
              {isOwner && selected.stripe_customer_id ? (
                <a className={styles.secondaryButton} href={stripeCustomerUrl(selected.stripe_customer_id, selected.stripe_livemode)} target="_blank" rel="noreferrer">Open Stripe customer</a>
              ) : isOwner ? <span className={styles.notice}>No Stripe customer yet.</span> : null}
            </div>
            <div className={styles.membershipSummary}>
              <div><span>Profile</span><strong>{statusLabel(selected.profile_status)}</strong></div>
              <div><span>Membership</span><strong>{statusLabel(selected.subscription_status)}</strong></div>
              <div><span>Founding</span><strong>{selected.founding_member_number ? `#${selected.founding_member_number}, ${statusLabel(selected.founding_status)}` : statusLabel(selected.founding_status)}</strong></div>
              <div><span>Guarantee</span><strong>{statusLabel(selected.guarantee_status)}</strong></div>
              <div><span>Bookings</span><strong>{selected.qualifying_booking_count}</strong></div>
              <div><span>Verified refunds</span><strong>{money(selected.verified_refund_cents)}</strong></div>
            </div>
            <dl className={styles.membershipFacts}>
              <div><dt>Account email</dt><dd>{selected.account_email || "Not set"}</dd></div>
              <div><dt>Inquiry email</dt><dd>{selected.inquiry_email || "Not set"}</dd></div>
              <div><dt>Guarantee period</dt><dd>{adminDate(selected.guarantee_started_at)} to {adminDate(selected.guarantee_ends_at)}</dd></div>
              <div><dt>Claim deadline</dt><dd>{adminDate(selected.claim_deadline_at)}</dd></div>
            </dl>
            {selected.refunded ? (
              <p className={styles.verifiedRefund} role="status">
                <span aria-hidden="true">✓</span>
                <span><strong>Refund verified against Stripe</strong><small>{money(selected.verified_refund_cents)} verified on {adminDate(selected.latest_refunded_at)}</small></span>
              </p>
            ) : selected.verified_refund_cents > 0 ? (
              <p className={styles.notice}>Stripe has verified {money(selected.verified_refund_cents)} in partial refunds. Claim status: {statusLabel(selected.claim_status)}.</p>
            ) : null}
            {!isOwner ? <p className={styles.notice}>Finance records are read-only for delegated administrators. Only the marketplace owner can change guarantees or verify refunds.</p> : null}
          </div>

          {isOwner ? (
            <>
              <form className={`${styles.card} ${styles.stack}`} onSubmit={saveGuarantee}>
                <div><h3>Founding and guarantee status</h3><p className={styles.muted}>Founding numbers stay attached to the original instructor record.</p></div>
                <div className={styles.grid}>
                  <label className={styles.field}>
                    <span>Founding status</span>
                    <select disabled={selected.refunded || selected.verified_refund_cents > 0} value={foundingStatus} onChange={(event) => setFoundingStatus(event.target.value)}>
                      <option value="unassigned">Unassigned</option>
                      <option value="reserved">Reserved</option>
                      <option value="active">Active</option>
                      <option value="ended">Ended</option>
                      <option value="not_available">Not available</option>
                    </select>
                  </label>
                  <label className={styles.field}>
                    <span>Guarantee status</span>
                    <select disabled={selected.refunded || selected.verified_refund_cents > 0} value={guaranteeStatus} onChange={(event) => setGuaranteeStatus(event.target.value)}>
                      {[
                        "not_started", "covered", "claim_eligible", "fulfilled", "ineligible", "claim_received",
                        "under_review", "approved", "denied", "expired"
                      ].map((value) => <option value={value} key={value}>{statusLabel(value)}</option>)}
                      <option disabled value="refunded">refunded (Stripe verified)</option>
                    </select>
                  </label>
                </div>
                <label className={styles.field}><span>Internal guarantee note</span><textarea disabled={selected.refunded || selected.verified_refund_cents > 0} maxLength={4000} value={guaranteeNote} onChange={(event) => setGuaranteeNote(event.target.value)} /></label>
                <button className={styles.secondaryButton} disabled={busy !== null || selected.refunded || selected.verified_refund_cents > 0} type="submit">{busy === "guarantee" ? "Saving..." : "Save guarantee status"}</button>
              </form>

              <form className={`${styles.card} ${styles.stack}`} onSubmit={logClaim}>
                <div><h3>Log a refund claim</h3><p className={styles.muted}>Use this after an instructor contacts you. This creates the review record and does not issue a refund.</p></div>
                <div className={styles.grid}>
                  <label className={styles.field}>
                    <span>Received through</span>
                    <select value={claimSource} onChange={(event) => setClaimSource(event.target.value)}>
                      <option value="email">Email</option><option value="phone">Phone</option><option value="admin">Admin entry</option><option value="other">Other</option>
                    </select>
                  </label>
                  <label className={styles.field}><span>Claimant email</span><input type="email" value={claimantEmail} onChange={(event) => setClaimantEmail(event.target.value)} /></label>
                  <label className={styles.field}><span>Requested refund, dollars</span><input type="number" min="0.01" step="0.01" value={requestedAmount} onChange={(event) => setRequestedAmount(event.target.value)} /></label>
                </div>
                <label className={styles.field}><span>Instructor message</span><textarea maxLength={4000} value={instructorMessage} onChange={(event) => setInstructorMessage(event.target.value)} /></label>
                <label className={styles.field}><span>Internal claim note</span><textarea maxLength={4000} value={claimNote} onChange={(event) => setClaimNote(event.target.value)} /></label>
                <button className={styles.secondaryButton} disabled={busy !== null || selected.refunded || selected.verified_refund_cents > 0} type="submit">{busy === "claim" ? "Logging..." : selected.claim_id ? "Update claim intake" : "Log claim"}</button>
              </form>

              {selected.claim_id ? (
                <form className={`${styles.card} ${styles.stack}`} onSubmit={reviewClaim}>
                  <div className={styles.membershipHeader}>
                    <div><h3>Review guarantee claim</h3><p className={styles.muted}>Claim received {adminDate(selected.claim_received_at)}. Current status: {statusLabel(selected.claim_status)}.</p></div>
                    <span className={styles.status}>{statusLabel(selected.claim_status)}</span>
                  </div>
                  <div className={styles.grid}>
                    <label className={styles.field}>
                      <span>Review decision</span>
                      <select disabled={selected.refunded || selected.verified_refund_cents > 0} value={reviewStatus} onChange={(event) => setReviewStatus(event.target.value)}>
                        <option value="in_review">In review</option><option value="approved">Approved</option><option value="refund_pending">Refund pending</option><option value="denied">Denied</option><option value="withdrawn">Withdrawn</option>
                      </select>
                    </label>
                    <label className={styles.field}><span>Approved refund, dollars</span><input disabled={selected.refunded || selected.verified_refund_cents > 0} type="number" min="0.01" step="0.01" value={approvedAmount} onChange={(event) => setApprovedAmount(event.target.value)} /></label>
                  </div>
                  <div className={styles.requirementChecklist}>
                    <label className={styles.check}><input disabled={selected.refunded || selected.verified_refund_cents > 0} type="checkbox" checked={profileConfirmed} onChange={(event) => setProfileConfirmed(event.target.checked)} /><span>Profile completeness requirement confirmed</span></label>
                    <label className={styles.check}><input disabled={selected.refunded || selected.verified_refund_cents > 0} type="checkbox" checked={contactConfirmed} onChange={(event) => setContactConfirmed(event.target.checked)} /><span>Contact details were current during the guarantee period</span></label>
                    <label className={styles.check}><input disabled={selected.refunded || selected.verified_refund_cents > 0} type="checkbox" checked={responseConfirmed} onChange={(event) => setResponseConfirmed(event.target.checked)} /><span>Instructor response requirement confirmed</span></label>
                  </div>
                  <label className={styles.field}><span>Internal review note</span><textarea disabled={selected.refunded || selected.verified_refund_cents > 0} maxLength={4000} value={reviewNote} onChange={(event) => setReviewNote(event.target.value)} /></label>
                  <label className={styles.field}><span>Decision reason</span><textarea disabled={selected.refunded || selected.verified_refund_cents > 0} maxLength={2000} value={decisionReason} onChange={(event) => setDecisionReason(event.target.value)} /></label>
                  <button className={styles.secondaryButton} disabled={busy !== null || selected.refunded || selected.verified_refund_cents > 0} type="submit">{busy === "review" ? "Saving..." : "Save claim review"}</button>
                </form>
              ) : null}

              {selected.claim_id && ["approved", "refund_pending", "partially_refunded", "refunded"].includes(selected.claim_status ?? "") ? (
                <form className={`${styles.card} ${styles.stack} ${styles.refundVerificationCard}`} onSubmit={verifyRefund}>
                  <div><p className={styles.eyebrow}>Final verification</p><h3>Record a refund issued in Stripe</h3></div>
                  <p>This action never sends money or cancels a subscription. First issue the refund from the Stripe Dashboard, cancel the subscription there if the instructor wants to stop future charges, then paste the Stripe refund ID here. The server checks the customer, membership invoice, price, amount, and refund status before recording it.</p>
                  {selected.stripe_customer_id ? <a className={styles.secondaryButton} href={stripeCustomerUrl(selected.stripe_customer_id, selected.stripe_livemode)} target="_blank" rel="noreferrer">Open customer in Stripe</a> : null}
                  <label className={styles.check}><input disabled={selected.refunded} type="checkbox" checked={refundIssuedConfirmed} onChange={(event) => setRefundIssuedConfirmed(event.target.checked)} /><span>I already issued this refund in Stripe.</span></label>
                  <label className={styles.field}><span>Stripe refund ID</span><input disabled={selected.refunded} required placeholder="re_..." value={refundId} onChange={(event) => setRefundId(event.target.value)} /></label>
                  <button className={styles.button} disabled={busy !== null || selected.refunded || !refundIssuedConfirmed} type="submit">{busy === "refund" ? "Verifying with Stripe..." : "Verify and record refund"}</button>
                </form>
              ) : null}
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function AdminDashboard({ isOwner }: { isOwner: boolean }) {
  const [tab, setTab] = useState<"overview" | "profiles" | "memberships" | "delivery" | "access">("overview");
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
      setMessage(decision === "approve" ? "Instructor approved or reactivated. Active memberships publish automatically." : "Instructor profile updated.");
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
          ? (["overview", "profiles", "memberships", "delivery", "access"] as const)
          : (["overview", "profiles", "memberships", "delivery"] as const)
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
            <p className={styles.muted}>Review the profile copy and all uploaded media before approval. Approval unlocks membership checkout.</p>
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
                    <td>
                      {["approved", "published"].includes(profile.status) ? <button className={styles.dangerButton} disabled={busyId === profile.id} type="button" onClick={() => void review(profile.id, "suspend")}>Suspend</button> : null}
                      {profile.status === "suspended" ? <button className={styles.secondaryButton} disabled={busyId === profile.id} type="button" onClick={() => void review(profile.id, "approve")}>Reactivate</button> : null}
                    </td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          </div>
        </>
      ) : null}

      {!loading && tab === "memberships" ? <MembershipGuaranteeAdmin isOwner={isOwner} /> : null}

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
