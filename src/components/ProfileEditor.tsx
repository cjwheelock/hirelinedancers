"use client";

import { useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Circle,
  Copy,
  ExternalLink,
  Eye,
  Plus,
  Trash2
} from "lucide-react";
import { eventTypes, serviceMarkets } from "@/data/site";
import {
  foundingOfferLabel,
  freePeriod,
  guaranteeCoverage,
  monthlyPriceWithCurrency
} from "@/lib/commercialTerms";
import {
  getMarketplaceClient,
  type InstructorPrivateSettings,
  type InstructorProfile,
  type ProfileHighlight,
  type ProfilePackage
} from "@/lib/marketplace";
import { ProfileMediaManager, type EditorMedia } from "./ProfileMediaManager";
import styles from "./Marketplace.module.css";
import editor from "./ProfileEditor.module.css";

export const danceStyles = [
  "Country line dancing",
  "Country swing",
  "Soul line dancing",
  "Pop line dancing",
  "Latin line dancing",
  "Beginner group instruction"
];

const ageGroupOptions = [
  { value: "kids", label: "Kids" },
  { value: "teens", label: "Teens" },
  { value: "adults", label: "Adults" },
  { value: "seniors", label: "Seniors" },
  { value: "all_ages", label: "All ages" }
];

const commonLanguages = ["English", "Spanish", "French", "Portuguese", "Vietnamese", "Chinese", "ASL"];

const steps = [
  { id: "basics", label: "Basics" },
  { id: "media", label: "Photos & videos" },
  { id: "services", label: "Services" },
  { id: "links", label: "Links & pricing" },
  { id: "review", label: "Preview & submit" }
] as const;

type StepId = (typeof steps)[number]["id"];

type PackageDraft = { name: string; description: string; durationHours: string; price: string };
type HighlightDraft = { title: string; detail: string };

function packageDrafts(packages: ProfilePackage[] | undefined): PackageDraft[] {
  return (packages ?? []).map((item) => ({
    name: item.name,
    description: item.description ?? "",
    durationHours: item.durationHours ? String(item.durationHours) : "",
    price: item.priceCents ? String(item.priceCents / 100) : ""
  }));
}

function highlightDrafts(highlights: ProfileHighlight[] | undefined): HighlightDraft[] {
  return (highlights ?? []).map((item) => ({ title: item.title, detail: item.detail ?? "" }));
}

function cleanSocial(value: string, kind: "instagram" | "tiktok" | "youtube" | "website"): string | null {
  let url = value.trim();
  if (!url) return null;
  if (kind === "instagram" && /^@?[A-Za-z0-9_.]+$/.test(url)) url = `https://www.instagram.com/${url.replace(/^@/, "")}/`;
  if (kind === "tiktok" && /^@?[A-Za-z0-9_.-]+$/.test(url)) url = `https://www.tiktok.com/@${url.replace(/^@/, "")}`;
  if (kind === "youtube" && /^@[A-Za-z0-9_.-]+$/.test(url)) url = `https://www.youtube.com/${url}`;
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  url = url.replace(/^http:\/\//i, "https://").replace(/[?#].*$/, "");
  return url;
}

function socialProblem(value: string | null, kind: "instagram" | "tiktok" | "youtube" | "website"): string | null {
  if (!value) return null;
  const patterns = {
    instagram: /^https:\/\/(www\.)?instagram\.com\/[A-Za-z0-9_.]+\/?$/i,
    tiktok: /^https:\/\/(www\.)?tiktok\.com\/@[A-Za-z0-9_.-]+\/?$/i,
    youtube: /^https:\/\/(www\.|m\.)?youtube\.com\/(@[A-Za-z0-9_.-]+|channel\/[A-Za-z0-9_-]+|c\/[A-Za-z0-9_.-]+)\/?$/i,
    website: /^https:\/\/[^\s/]+\.[^\s]+$/i
  };
  if (patterns[kind].test(value)) return null;
  return {
    instagram: "Use your Instagram profile link or @handle.",
    tiktok: "Use your TikTok profile link or @handle.",
    youtube: "Use your YouTube channel link, like youtube.com/@yourname.",
    website: "Enter a full website address."
  }[kind];
}

export function ProfileEditor({
  profile,
  settings,
  hasLifetimeAccess,
  onSaved,
  describeEdgeError
}: {
  profile: InstructorProfile;
  settings: InstructorPrivateSettings | null;
  hasLifetimeAccess: boolean | null;
  onSaved: () => void;
  describeEdgeError: (error: unknown) => Promise<string>;
}) {
  const [step, setStep] = useState<StepId>("basics");
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
    age_groups: profile.age_groups ?? [],
    languages: profile.languages?.length ? profile.languages : ["English"],
    favorite_song_name: profile.favorite_song_name ?? "",
    favorite_song_spotify_url: profile.favorite_song_spotify_url ?? "",
    provides_speakers: profile.provides_speakers ?? false,
    provides_microphone: profile.provides_microphone ?? false,
    provides_music_playback: profile.provides_music_playback ?? false,
    liability_insurance_status: profile.liability_insurance_status,
    preferred_response_hours: profile.preferred_response_hours.toString(),
    inquiry_email: settings?.inquiry_email ?? "",
    minimum_rate: settings?.minimum_rate_cents ? (settings.minimum_rate_cents / 100).toString() : "",
    minimum_hours: settings?.minimum_hours?.toString() ?? "",
    instagram: settings?.instagram_url ?? "",
    tiktok: settings?.tiktok_url ?? "",
    youtube: settings?.youtube_url ?? "",
    website: settings?.website_url ?? ""
  });
  const [packages, setPackages] = useState<PackageDraft[]>(() => packageDrafts(profile.packages));
  const [highlights, setHighlights] = useState<HighlightDraft[]>(() => highlightDrafts(profile.highlights));
  const [media, setMedia] = useState<EditorMedia[]>([]);
  const [newLanguage, setNewLanguage] = useState("");
  const [busy, setBusy] = useState<"save" | "continue" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const paymentSetupRequestKey = useRef<string | null>(null);
  const topRef = useRef<HTMLDivElement>(null);

  const canEdit = ["draft", "approved", "published"].includes(profile.status);
  const canContinue = profile.status === "draft";
  const allEventTypesSelected = eventTypes.every((item) => form.event_types.includes(item.slug));

  function setValue<Key extends keyof typeof form>(key: Key, value: (typeof form)[Key]) {
    setForm((current) => ({ ...current, [key]: value }));
    setMessage(null);
  }

  function toggle(key: "styles" | "event_types" | "age_groups" | "languages", value: string) {
    setForm((current) => ({
      ...current,
      [key]: current[key].includes(value) ? current[key].filter((item) => item !== value) : [...current[key], value]
    }));
    setMessage(null);
  }

  const headshotReady = media.some((item) => item.media_type === "headshot" && item.status === "ready");
  const videoCount = media.filter((item) => item.media_type === "video" || item.media_type === "welcome_video").length;
  const photoCount = media.filter((item) => item.media_type === "image").length;
  const cleanPackages = packages.filter((item) => item.name.trim());
  const cleanHighlights = highlights.filter((item) => item.title.trim());

  const checklist = useMemo(() => [
    { label: "Headshot", done: headshotReady, step: "media" as StepId, required: true },
    { label: "Inquiry email", done: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.inquiry_email.trim()), step: "links" as StepId, required: true },
    { label: "Name, location, and event types", done: Boolean(form.display_name.trim() && form.city.trim() && form.region.trim() && form.event_types.length), step: "services" as StepId, required: true },
    { label: "About you (at least 150 characters)", done: form.bio.trim().length >= 150, step: "basics" as StepId, required: false },
    { label: "Headline", done: Boolean(form.headline.trim()), step: "basics" as StepId, required: false },
    { label: "At least one video", done: videoCount > 0, step: "media" as StepId, required: false },
    { label: "Two or more photos of you teaching", done: photoCount >= 2, step: "media" as StepId, required: false },
    { label: "Dance styles", done: form.styles.length > 0, step: "services" as StepId, required: false },
    { label: "A package clients can pick", done: cleanPackages.length > 0, step: "services" as StepId, required: false },
    { label: "A past event highlight", done: cleanHighlights.length > 0, step: "services" as StepId, required: false },
    { label: "Years teaching", done: Boolean(form.years_teaching), step: "basics" as StepId, required: false }
  ], [cleanHighlights.length, cleanPackages.length, form, headshotReady, photoCount, videoCount]);
  const score = Math.round((checklist.filter((item) => item.done).length / checklist.length) * 100);
  const nextTip = checklist.find((item) => !item.done);

  function goTo(id: StepId) {
    setStep(id);
    setError(null);
    requestAnimationFrame(() => topRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }

  function validateLocal(): string | null {
    const socials = (["instagram", "tiktok", "youtube", "website"] as const)
      .map((kind) => socialProblem(cleanSocial(form[kind], kind), kind))
      .find(Boolean);
    if (socials) return socials;
    for (const item of cleanPackages) {
      const hours = item.durationHours ? Number(item.durationHours) : null;
      const price = item.price ? Number(item.price) : null;
      if (hours !== null && (!Number.isFinite(hours) || hours < 0.5 || hours > 24)) return `Set the length of "${item.name}" between 0.5 and 24 hours.`;
      if (price !== null && (!Number.isFinite(price) || price < 10 || price > 10000)) return `Set the price of "${item.name}" between $10 and $10,000, or leave it blank.`;
    }
    return null;
  }

  async function save(continueToSubmission: boolean, quiet = false): Promise<boolean> {
    const client = getMarketplaceClient();
    if (!client) return false;
    const localProblem = validateLocal();
    if (localProblem) {
      setError(localProblem);
      return false;
    }
    if (continueToSubmission && (!form.display_name.trim() || !form.bio.trim() || !form.city.trim() || !form.region.trim() || !form.event_types.length)) {
      setError("Add your public name, an About you section, your location, and at least one event type before continuing.");
      return false;
    }
    const inquiryEmail = form.inquiry_email.trim().toLowerCase();
    const inquiryEmailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(inquiryEmail);
    if (inquiryEmail && !inquiryEmailValid) {
      setError("Enter a valid inquiry email in Links & pricing, or leave it blank for now.");
      return false;
    }
    if (continueToSubmission && !inquiryEmailValid) {
      setError("Add the email where you want inquiry alerts in Links & pricing before continuing.");
      return false;
    }
    if (continueToSubmission && !headshotReady) {
      setError("Add a headshot in Photos & videos before continuing.");
      return false;
    }

    setBusy(continueToSubmission ? "continue" : "save");
    setError(null);
    if (!quiet) setMessage(null);

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
      age_groups: form.age_groups,
      languages: form.languages,
      favorite_song_name: form.favorite_song_name.trim() || null,
      favorite_song_spotify_url: form.favorite_song_spotify_url.trim() || null,
      provides_speakers: form.provides_speakers,
      provides_microphone: form.provides_microphone,
      provides_music_playback: form.provides_music_playback,
      liability_insurance_status: form.liability_insurance_status,
      preferred_response_hours: Number(form.preferred_response_hours),
      packages: cleanPackages.map((item) => {
        const next: ProfilePackage = { name: item.name.trim() };
        if (item.description.trim()) next.description = item.description.trim();
        if (item.durationHours) next.durationHours = Number(item.durationHours);
        next.priceCents = item.price ? Math.round(Number(item.price) * 100) : null;
        return next;
      }),
      highlights: cleanHighlights.map((item) => (item.detail.trim()
        ? { title: item.title.trim(), detail: item.detail.trim() }
        : { title: item.title.trim() })),
      status: profile.status
    };

    // Private settings need an inquiry email, so a draft without one saves
    // its public profile only until the instructor adds it.
    const { error: settingsError } = !inquiryEmailValid ? { error: null } : await client.from("instructor_private_settings").upsert({
      instructor_profile_id: profile.id,
      inquiry_email: inquiryEmail,
      inquiry_phone_e164: null,
      sms_notifications_enabled: false,
      minimum_rate_cents: form.minimum_rate ? Math.round(Number(form.minimum_rate) * 100) : null,
      minimum_hours: form.minimum_hours ? Number(form.minimum_hours) : null,
      instagram_url: cleanSocial(form.instagram, "instagram"),
      tiktok_url: cleanSocial(form.tiktok, "tiktok"),
      youtube_url: cleanSocial(form.youtube, "youtube"),
      website_url: cleanSocial(form.website, "website")
    });
    if (settingsError) {
      setError(settingsError.message);
      setBusy(null);
      return false;
    }

    const { error: profileError } = await client.from("instructor_profiles").update(profilePayload).eq("id", profile.id);
    if (profileError) {
      setError(profileError.message.includes("check constraint")
        ? "Some profile details are not in the expected format. Check your packages and highlights and try again."
        : profileError.message);
      setBusy(null);
      return false;
    }

    const emailChanged = inquiryEmailValid && inquiryEmail !== (settings?.inquiry_email ?? "").toLowerCase();
    if (!continueToSubmission) {
      setBusy(null);
      setMessage(emailChanged
        ? `Saved. We sent a confirmation to ${inquiryEmail} so you know inquiry alerts will arrive there.`
        : quiet ? "Saved." : "Your profile changes are saved.");
      onSaved();
      return true;
    }

    if (hasLifetimeAccess === null) {
      setBusy(null);
      setError("We could not verify your instructor access. Refresh the page before continuing.");
      return false;
    }

    if (hasLifetimeAccess) {
      const { error: submissionError } = await client.rpc("submit_lifetime_instructor_profile_for_review");
      setBusy(null);
      if (submissionError) {
        setError(submissionError.message);
        return false;
      }
      setMessage("Your profile was submitted. We’ll review it ASAP.");
      onSaved();
      return true;
    }

    if (settings?.payment_setup_completed_at) {
      const { data: resubmissionData, error: resubmissionError } = await client.rpc("resubmit_instructor_profile_after_payment_setup");
      setBusy(null);
      if (resubmissionError) {
        setError(resubmissionError.message.includes("A verified payment setup is required before resubmitting")
          ? "We could not verify your saved payment method. Refresh the page and try again. If this continues, contact support. You will not be asked to enter your card again unless a replacement is required."
          : resubmissionError.message);
        return false;
      }
      if (resubmissionData?.profileStatus !== "pending_review") {
        setError("Your updated profile could not be resubmitted for review. Refresh the page and try again.");
        return false;
      }
      setMessage("Your saved payment method is confirmed. Your updated profile was resubmitted. We’ll review it ASAP.");
      onSaved();
      return true;
    }

    paymentSetupRequestKey.current ??= crypto.randomUUID();
    const { data, error: setupError } = await client.functions.invoke("create-instructor-payment-setup", {
      body: { instructorProfileId: profile.id },
      headers: { "Idempotency-Key": paymentSetupRequestKey.current }
    });
    if (setupError) {
      setBusy(null);
      setError(await describeEdgeError(setupError));
      return false;
    }
    if (!data?.url || typeof data.url !== "string") {
      setBusy(null);
      setError("Stripe payment setup did not return a secure link.");
      return false;
    }
    window.location.assign(data.url);
    return true;
  }

  async function next(direction: 1 | -1) {
    const index = steps.findIndex((item) => item.id === step);
    const target = steps[index + direction];
    if (!target) return;
    if (canEdit && step !== "media" && direction === 1) {
      const saved = await save(false, true);
      if (!saved) return;
    }
    goTo(target.id);
  }

  const publicUrl = profile.slug && profile.status === "published"
    ? `https://hirelinedancers.com/profile/?instructor=${encodeURIComponent(profile.slug)}`
    : null;
  const previewUrl = `/profile/?instructor=${encodeURIComponent(profile.id)}&preview=1`;

  async function copyLink() {
    if (!publicUrl) return;
    try {
      await navigator.clipboard.writeText(publicUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      setError("Copy did not work in this browser. Select the link and copy it instead.");
    }
  }

  function addLanguage() {
    const value = newLanguage.trim().replace(/\s+/g, " ");
    if (!value || value.length > 40) return;
    if (!form.languages.some((item) => item.toLowerCase() === value.toLowerCase())) {
      setValue("languages", [...form.languages, value]);
    }
    setNewLanguage("");
  }

  const stepIndex = steps.findIndex((item) => item.id === step);

  return (
    <div className={`${styles.card} ${editor.editor}`} ref={topRef}>
      <header className={editor.header}>
        <div className={editor.headerTop}>
          <div>
            <p className={styles.eyebrow}>Your public profile</p>
            <h2>{profile.status === "draft" ? "Set up your profile" : "Edit your profile"}</h2>
          </div>
          <div className={editor.headerActions}>
            <span className={styles.status}>{profile.status.replace("_", " ")}</span>
            <a className={styles.secondaryButton} href={previewUrl} target="_blank" rel="noopener noreferrer">
              <Eye size={16} aria-hidden="true" /> Preview
            </a>
          </div>
        </div>
        <div className={editor.progress} aria-label={`Profile strength ${score} percent`}>
          <div className={editor.progressTrack}><div className={editor.progressFill} style={{ width: `${score}%` }} /></div>
          <p>
            <strong>Profile strength {score}%</strong>
            {nextTip ? <> · Next: <button type="button" className={editor.inlineLink} onClick={() => goTo(nextTip.step)}>{nextTip.label.toLowerCase()}</button></> : " · Looking great"}
          </p>
        </div>
        <nav className={editor.steps} aria-label="Profile setup steps">
          {steps.map((item, index) => (
            <button
              key={item.id}
              type="button"
              className={`${editor.stepButton} ${item.id === step ? editor.stepActive : ""}`}
              aria-current={item.id === step ? "step" : undefined}
              onClick={() => goTo(item.id)}
            >
              <span className={editor.stepNumber}>{index + 1}</span>
              <span>{item.label}</span>
            </button>
          ))}
        </nav>
      </header>

      {profile.status === "pending_review" ? <p className={styles.notice}>Your profile is under review. Editing is paused until we finish.</p> : null}
      {profile.status === "suspended" ? <p className={styles.notice}>Editing is paused while your profile is suspended. Contact support for help.</p> : null}

      <fieldset className={editor.body} disabled={!canEdit}>
        {step === "basics" ? (
          <section className={styles.stack} aria-labelledby="step-basics">
            <div>
              <h3 id="step-basics">Introduce yourself</h3>
              <p className={styles.help}>This is the first thing planners read. Keep it warm and specific.</p>
            </div>
            <div className={`${styles.grid} ${styles.alignedGrid}`}>
              <label className={styles.field}>
                <span>Public name</span>
                <input required maxLength={80} value={form.display_name} onChange={(e) => setValue("display_name", e.target.value)} />
              </label>
              <label className={styles.field}>
                <span>Business name (optional)</span>
                <input maxLength={80} value={form.business_name} onChange={(e) => setValue("business_name", e.target.value)} />
              </label>
            </div>
            <label className={styles.field}>
              <span>Headline</span>
              <input
                maxLength={120}
                value={form.headline}
                onChange={(e) => setValue("headline", e.target.value)}
                placeholder="High-energy line dancing that gets every guest on the floor"
              />
              <small className={editor.counter}>{form.headline.length}/120 · Shown under your name</small>
            </label>
            <label className={styles.field}>
              <span>About you</span>
              <textarea
                maxLength={2000}
                rows={7}
                value={form.bio}
                onChange={(e) => setValue("bio", e.target.value)}
                placeholder="How did you start dancing? What kinds of events do you love? How do you get a shy crowd moving? What will guests remember?"
              />
              <small className={editor.counter}>{form.bio.length}/2000{form.bio.trim().length < 150 ? ` · Aim for at least 150 characters` : ""}</small>
            </label>
            <div className={`${styles.grid} ${styles.alignedGrid}`}>
              <label className={styles.field}>
                <span>Years teaching</span>
                <input type="number" min="0" max="80" inputMode="numeric" value={form.years_teaching} onChange={(e) => setValue("years_teaching", e.target.value)} />
              </label>
              <label className={styles.field}>
                <span>Largest group you teach</span>
                <input type="number" min="1" max="5000" inputMode="numeric" placeholder="200" value={form.max_group_size} onChange={(e) => setValue("max_group_size", e.target.value)} />
              </label>
            </div>
            <div className={styles.stack}>
              <span className={styles.legend}>Who you teach</span>
              <div className={editor.chips}>
                {ageGroupOptions.map((item) => (
                  <button key={item.value} type="button" className={editor.chip} aria-pressed={form.age_groups.includes(item.value)} onClick={() => toggle("age_groups", item.value)}>
                    {item.label}
                  </button>
                ))}
              </div>
            </div>
            <div className={styles.stack}>
              <span className={styles.legend}>Languages you teach in</span>
              <div className={editor.chips}>
                {Array.from(new Set([...commonLanguages, ...form.languages])).map((item) => (
                  <button key={item} type="button" className={editor.chip} aria-pressed={form.languages.includes(item)} onClick={() => toggle("languages", item)}>
                    {item}
                  </button>
                ))}
              </div>
              <div className={editor.inlineAdd}>
                <input aria-label="Add another language" placeholder="Another language" maxLength={40} value={newLanguage} onChange={(e) => setNewLanguage(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addLanguage(); } }} />
                <button type="button" className={styles.secondaryButton} onClick={addLanguage}><Plus size={16} aria-hidden="true" /> Add</button>
              </div>
            </div>
          </section>
        ) : null}

        {step === "services" ? (
          <section className={styles.stack} aria-labelledby="step-services">
            <div>
              <h3 id="step-services">Where you work and what you offer</h3>
              <p className={styles.help}>Planners search by city. Packages and past events help them picture hiring you.</p>
            </div>
            <div className={`${styles.grid} ${styles.alignedGrid}`}>
              <label className={styles.field}>
                <span>City</span>
                <input
                  required
                  list="instructor-city-suggestions"
                  autoComplete="address-level2"
                  maxLength={120}
                  value={form.city}
                  onChange={(e) => {
                    const value = e.target.value;
                    const market = serviceMarkets.find((item) => `${item.city}, ${item.state}` === value);
                    if (market) setForm((current) => ({ ...current, city: market.city, region: market.state }));
                    else setValue("city", value);
                  }}
                />
                <datalist id="instructor-city-suggestions">
                  {serviceMarkets.map((market) => <option key={market.slug} value={`${market.city}, ${market.state}`} />)}
                </datalist>
              </label>
              <label className={styles.field}>
                <span>State</span>
                <input required autoComplete="address-level1" maxLength={2} placeholder="TX" value={form.region} onChange={(e) => setValue("region", e.target.value.toUpperCase().replace(/[^A-Z]/g, ""))} />
              </label>
              <label className={styles.field}>
                <span>ZIP code</span>
                <input inputMode="numeric" maxLength={10} value={form.postal_code} onChange={(e) => setValue("postal_code", e.target.value)} />
              </label>
              <label className={styles.field}>
                <span>How far you travel (miles)</span>
                <input type="number" min="0" max="1000" inputMode="numeric" value={form.travel_radius_miles} onChange={(e) => setValue("travel_radius_miles", e.target.value)} />
              </label>
            </div>

            <div className={styles.stack}>
              <span className={styles.legend}>Events you accept</span>
              <div className={editor.chips}>
                <button type="button" className={editor.chip} aria-pressed={allEventTypesSelected} onClick={() => setValue("event_types", allEventTypesSelected ? [] : eventTypes.map((item) => item.slug))}>
                  All events
                </button>
                {eventTypes.map((item) => (
                  <button key={item.slug} type="button" className={editor.chip} aria-pressed={form.event_types.includes(item.slug)} onClick={() => toggle("event_types", item.slug)}>
                    {item.label}
                  </button>
                ))}
              </div>
            </div>

            <div className={styles.stack}>
              <span className={styles.legend}>What you teach</span>
              <div className={editor.chips}>
                {danceStyles.map((item) => (
                  <button key={item} type="button" className={editor.chip} aria-pressed={form.styles.includes(item)} onClick={() => toggle("styles", item)}>
                    {item}
                  </button>
                ))}
              </div>
            </div>

            <div className={editor.subsection}>
              <div className={editor.subsectionHeader}>
                <div>
                  <h4>Packages</h4>
                  <p className={styles.help}>Ready-made options clients see on your profile. You can start a quote from one. Leave the price blank to show &ldquo;Custom quote.&rdquo;</p>
                </div>
                {packages.length < 4 ? (
                  <button type="button" className={styles.secondaryButton} onClick={() => setPackages((current) => [...current, { name: "", description: "", durationHours: "", price: "" }])}>
                    <Plus size={16} aria-hidden="true" /> Add package
                  </button>
                ) : null}
              </div>
              {packages.length === 0 ? (
                <button type="button" className={editor.emptyTile} onClick={() => setPackages([{ name: "Party starter", description: "One hour of beginner-friendly line dancing. Three easy dances anyone can learn.", durationHours: "1", price: "" }])}>
                  <Plus size={18} aria-hidden="true" /> Add your first package, like &ldquo;Party starter, 1 hour&rdquo;
                </button>
              ) : null}
              {packages.map((item, index) => (
                <div className={editor.repeatRow} key={index}>
                  <div className={editor.repeatGrid}>
                    <label className={styles.field}><span>Name</span><input maxLength={60} value={item.name} placeholder="Party starter" onChange={(e) => setPackages((current) => current.map((row, i) => i === index ? { ...row, name: e.target.value } : row))} /></label>
                    <label className={styles.field}><span>Hours</span><input type="number" min="0.5" max="24" step="0.5" value={item.durationHours} onChange={(e) => setPackages((current) => current.map((row, i) => i === index ? { ...row, durationHours: e.target.value } : row))} /></label>
                    <label className={styles.field}><span>Price ($)</span><input type="number" min="10" max="10000" step="1" placeholder="Custom" value={item.price} onChange={(e) => setPackages((current) => current.map((row, i) => i === index ? { ...row, price: e.target.value } : row))} /></label>
                  </div>
                  <label className={styles.field}><span>What&rsquo;s included</span><textarea rows={2} maxLength={300} value={item.description} placeholder="Three easy dances, music and microphone included." onChange={(e) => setPackages((current) => current.map((row, i) => i === index ? { ...row, description: e.target.value } : row))} /></label>
                  <button type="button" className={editor.removeRow} onClick={() => setPackages((current) => current.filter((_, i) => i !== index))}><Trash2 size={15} aria-hidden="true" /> Remove package</button>
                </div>
              ))}
            </div>

            <div className={editor.subsection}>
              <div className={editor.subsectionHeader}>
                <div>
                  <h4>Past events</h4>
                  <p className={styles.help}>A few events you&rsquo;re proud of. No client names needed.</p>
                </div>
                {highlights.length < 6 ? (
                  <button type="button" className={styles.secondaryButton} onClick={() => setHighlights((current) => [...current, { title: "", detail: "" }])}>
                    <Plus size={16} aria-hidden="true" /> Add event
                  </button>
                ) : null}
              </div>
              {highlights.length === 0 ? (
                <button type="button" className={editor.emptyTile} onClick={() => setHighlights([{ title: "", detail: "" }])}>
                  <Plus size={18} aria-hidden="true" /> Add a past event, like &ldquo;Wedding reception, Austin, 150 guests&rdquo;
                </button>
              ) : null}
              {highlights.map((item, index) => (
                <div className={editor.repeatRow} key={index}>
                  <div className={editor.repeatGridTwo}>
                    <label className={styles.field}><span>Event</span><input maxLength={80} value={item.title} placeholder="Wedding reception, Austin" onChange={(e) => setHighlights((current) => current.map((row, i) => i === index ? { ...row, title: e.target.value } : row))} /></label>
                    <label className={styles.field}><span>Details (optional)</span><input maxLength={160} value={item.detail} placeholder="150 guests, taught three dances" onChange={(e) => setHighlights((current) => current.map((row, i) => i === index ? { ...row, detail: e.target.value } : row))} /></label>
                  </div>
                  <button type="button" className={editor.removeRow} onClick={() => setHighlights((current) => current.filter((_, i) => i !== index))}><Trash2 size={15} aria-hidden="true" /> Remove</button>
                </div>
              ))}
            </div>

            <div className={styles.stack}>
              <span className={styles.legend}>Equipment you can bring</span>
              <div className={editor.chips}>
                <button type="button" className={editor.chip} aria-pressed={form.provides_speakers} onClick={() => setValue("provides_speakers", !form.provides_speakers)}>Speakers</button>
                <button type="button" className={editor.chip} aria-pressed={form.provides_microphone} onClick={() => setValue("provides_microphone", !form.provides_microphone)}>Microphone</button>
                <button type="button" className={editor.chip} aria-pressed={form.provides_music_playback} onClick={() => setValue("provides_music_playback", !form.provides_music_playback)}>Music playback</button>
              </div>
            </div>

            <div className={`${styles.grid} ${styles.alignedGrid}`}>
              <label className={styles.field}>
                <span>Liability insurance</span>
                <select value={form.liability_insurance_status} onChange={(e) => setValue("liability_insurance_status", e.target.value as typeof form.liability_insurance_status)}>
                  <option value="not_provided">Not currently available</option>
                  <option value="available">I can provide a certificate</option>
                  <option value="required_per_event">I arrange it when required</option>
                </select>
              </label>
              <label className={styles.field}>
                <span>Typical response time</span>
                <select value={form.preferred_response_hours} onChange={(e) => setValue("preferred_response_hours", e.target.value)}>
                  <option value="24">Within 24 hours</option>
                  <option value="48">Within 48 hours</option>
                  <option value="72">Within 72 hours</option>
                </select>
              </label>
              <label className={styles.field}>
                <span>Favorite line dance song</span>
                <input maxLength={120} value={form.favorite_song_name} onChange={(e) => setValue("favorite_song_name", e.target.value)} />
              </label>
              <label className={styles.field}>
                <span>Spotify track link</span>
                <input type="url" value={form.favorite_song_spotify_url} onChange={(e) => setValue("favorite_song_spotify_url", e.target.value)} placeholder="https://open.spotify.com/track/..." />
              </label>
            </div>
          </section>
        ) : null}

        {step === "links" ? (
          <section className={styles.stack} aria-labelledby="step-links">
            <div>
              <h3 id="step-links">Your links and pricing</h3>
              <p className={styles.help}>Everything on this step is private. Your social links are shared with a client only after they book and pay, so bookings stay protected.</p>
            </div>
            <div className={`${styles.grid} ${styles.alignedGrid}`}>
              <label className={styles.field}><span>Instagram</span><input placeholder="@yourhandle" value={form.instagram} onChange={(e) => setValue("instagram", e.target.value)} />{form.instagram ? <small className={editor.fieldHint}>{socialProblem(cleanSocial(form.instagram, "instagram"), "instagram") ?? cleanSocial(form.instagram, "instagram")}</small> : null}</label>
              <label className={styles.field}><span>TikTok</span><input placeholder="@yourhandle" value={form.tiktok} onChange={(e) => setValue("tiktok", e.target.value)} />{form.tiktok ? <small className={editor.fieldHint}>{socialProblem(cleanSocial(form.tiktok, "tiktok"), "tiktok") ?? cleanSocial(form.tiktok, "tiktok")}</small> : null}</label>
              <label className={styles.field}><span>YouTube</span><input placeholder="youtube.com/@yourchannel" value={form.youtube} onChange={(e) => setValue("youtube", e.target.value)} />{form.youtube ? <small className={editor.fieldHint}>{socialProblem(cleanSocial(form.youtube, "youtube"), "youtube") ?? cleanSocial(form.youtube, "youtube")}</small> : null}</label>
              <label className={styles.field}><span>Website</span><input placeholder="yourwebsite.com" value={form.website} onChange={(e) => setValue("website", e.target.value)} />{form.website ? <small className={editor.fieldHint}>{socialProblem(cleanSocial(form.website, "website"), "website") ?? cleanSocial(form.website, "website")}</small> : null}</label>
            </div>
            <div className={editor.divider} />
            <div className={`${styles.grid} ${styles.alignedGrid}`}>
              <label className={styles.field}>
                <span>Typical minimum rate ($)</span>
                <input type="number" min="0" step="1" value={form.minimum_rate} onChange={(e) => setValue("minimum_rate", e.target.value)} />
              </label>
              <label className={styles.field}>
                <span>Minimum booking hours</span>
                <input type="number" min="0.5" max="24" step="0.5" value={form.minimum_hours} onChange={(e) => setValue("minimum_hours", e.target.value)} />
              </label>
              <label className={styles.field}>
                <span>Inquiry email</span>
                <input type="email" required autoComplete="email" placeholder="you@example.com" value={form.inquiry_email} onChange={(e) => setValue("inquiry_email", e.target.value)} />
                <small>Where we send new inquiries and booking alerts. We&rsquo;ll email this address to confirm it works.</small>
              </label>
            </div>
          </section>
        ) : null}
      </fieldset>

      {step === "media" ? (
        <ProfileMediaManager profile={profile} canEdit={canEdit} onMediaChange={setMedia} />
      ) : (
        <div hidden><ProfileMediaManager profile={profile} canEdit={false} onMediaChange={setMedia} /></div>
      )}

      {step === "review" ? (
        <section className={styles.stack} aria-labelledby="step-review">
          <div>
            <h3 id="step-review">{profile.status === "draft" ? "Preview and submit" : "Preview and share"}</h3>
            <p className={styles.help}>Check how planners will see you, then {profile.status === "draft" ? "submit for a quick review." : "share your link anywhere."}</p>
          </div>
          <ul className={editor.checklist}>
            {checklist.map((item) => (
              <li key={item.label}>
                {item.done ? <CheckCircle2 size={18} aria-hidden="true" className={editor.done} /> : <Circle size={18} aria-hidden="true" className={editor.todo} />}
                <span>{item.label}{item.required ? " (required)" : ""}</span>
                {!item.done ? <button type="button" className={editor.inlineLink} onClick={() => goTo(item.step)}>Add</button> : null}
              </li>
            ))}
          </ul>
          <div className={styles.buttonRow}>
            <a className={styles.secondaryButton} href={previewUrl} target="_blank" rel="noopener noreferrer"><Eye size={16} aria-hidden="true" /> Preview your profile</a>
            {publicUrl ? <a className={styles.secondaryButton} href={publicUrl} target="_blank" rel="noopener noreferrer"><ExternalLink size={16} aria-hidden="true" /> View live profile</a> : null}
          </div>
          {publicUrl ? (
            <div className={editor.shareBox}>
              <span className={styles.legend}>Your profile link</span>
              <div className={editor.inlineAdd}>
                <input readOnly value={publicUrl} onFocus={(e) => e.target.select()} aria-label="Your profile link" />
                <button type="button" className={styles.button} onClick={() => void copyLink()}><Copy size={16} aria-hidden="true" /> {copied ? "Copied" : "Copy link"}</button>
              </div>
              <small className={styles.muted}>Add it to your Instagram or TikTok bio so clients can book you with payment protection.</small>
            </div>
          ) : null}
          {canContinue && hasLifetimeAccess === false ? (
            settings?.payment_setup_completed_at ? (
              <p className={styles.help}>Your payment method is already saved securely. Choose Submit to resubmit your updated profile without entering your card again.</p>
            ) : (
              <>
                <p className={styles.help}>Stripe will save your card securely. No subscription will start and your card will not be charged before your profile is approved. The {foundingOfferLabel} who complete payment setup receive {freePeriod} free, then the membership renews at {monthlyPriceWithCurrency} per month until canceled. The {guaranteeCoverage} money-back guarantee begins when Stripe collects your first membership payment.</p>
                <p className={styles.muted}>By continuing, you agree to the <a href="/legal/terms/">Terms of Service</a>, acknowledge the <a href="/legal/privacy/">Privacy Policy</a> and <a href="/legal/refund-policy/">Refund Policy</a>, and authorize Hire Line Dancers to start your membership automatically only if your profile is approved.</p>
              </>
            )
          ) : null}
          {canContinue && hasLifetimeAccess ? <p className={styles.help}>Joining is free. Submit your profile and we&rsquo;ll review it, usually within a day. By submitting, you agree to the <a href="/legal/terms/">Terms of Service</a>. You&rsquo;ll set up payouts before sending your first quote.</p> : null}
        </section>
      ) : null}

      {message ? <p className={styles.success} role="status">{message}</p> : null}
      {error ? <p className={styles.error} role="alert">{error}</p> : null}

      <footer className={editor.footer}>
        <div className={editor.footerLeft}>
          {stepIndex > 0 ? (
            <button type="button" className={styles.secondaryButton} disabled={busy !== null} onClick={() => void next(-1)}><ArrowLeft size={16} aria-hidden="true" /> Back</button>
          ) : null}
          {canEdit ? (
            <button type="button" className={editor.textButton} disabled={busy !== null} onClick={() => void save(false)}>
              {busy === "save" ? "Saving..." : profile.status === "draft" ? "Save draft" : "Save changes"}
            </button>
          ) : null}
        </div>
        {step !== "review" ? (
          <button type="button" className={styles.button} disabled={busy !== null} onClick={() => void next(1)}>
            Next: {steps[stepIndex + 1]?.label} <ArrowRight size={16} aria-hidden="true" />
          </button>
        ) : canContinue ? (
          <button type="button" className={styles.button} disabled={busy !== null || hasLifetimeAccess === null} onClick={() => void save(true)}>
            {busy === "continue" ? "Submitting..." : hasLifetimeAccess === false && !settings?.payment_setup_completed_at ? "Continue to payment setup" : "Submit for review"}
          </button>
        ) : canEdit ? (
          <button type="button" className={styles.button} disabled={busy !== null} onClick={() => void save(false)}>
            {busy === "save" ? "Saving..." : "Save changes"}
          </button>
        ) : null}
      </footer>
    </div>
  );
}
