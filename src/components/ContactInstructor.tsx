"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { eventTypes, instructors } from "@/data/site";
import { useMarketplaceSession } from "@/hooks/useMarketplaceSession";
import { callbackUrl, getMarketplaceClient, readableError, type InstructorProfile } from "@/lib/marketplace";
import { clearInquiryDraft, readInquiryDraft, saveInquiryDraft, type InquiryDraftForm } from "@/lib/inquiryDraft";
import styles from "./Marketplace.module.css";
import contactStyles from "./ContactInstructor.module.css";
import loginStyles from "./LoginScreen.module.css";

export const GUEST_INQUIRY_NOTE = "We'll email you when an instructor replies. Sign in with this email to read and respond.";
const turnstileSiteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim() || "";

type TurnstileApi = {
  render: (element: HTMLElement, options: { sitekey: string; callback: (token: string) => void; "expired-callback": () => void; "error-callback": () => void }) => string;
  reset: (widgetId?: string) => void;
  remove: (widgetId: string) => void;
};

/** Cloudflare Turnstile, rendered only when a site key is configured. */
function TurnstileWidget({ onToken, resetKey }: { onToken: (token: string | null) => void; resetKey: number }) {
  const container = useRef<HTMLDivElement>(null);
  const widget = useRef<string | null>(null);
  useEffect(() => {
    if (!turnstileSiteKey) return;
    let cancelled = false;
    const win = window as typeof window & { turnstile?: TurnstileApi };
    function mount() {
      if (cancelled || !container.current || !win.turnstile || widget.current) return;
      widget.current = win.turnstile.render(container.current, {
        sitekey: turnstileSiteKey,
        callback: (token) => onToken(token),
        "expired-callback": () => onToken(null),
        "error-callback": () => onToken(null)
      });
    }
    if (win.turnstile) {
      mount();
    } else {
      let script = document.querySelector<HTMLScriptElement>("script[data-turnstile]");
      if (!script) {
        script = document.createElement("script");
        script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
        script.async = true;
        script.dataset.turnstile = "true";
        document.head.appendChild(script);
      }
      script.addEventListener("load", mount);
    }
    return () => {
      cancelled = true;
      if (widget.current && win.turnstile) win.turnstile.remove(widget.current);
      widget.current = null;
    };
  }, [onToken]);
  useEffect(() => {
    const win = window as typeof window & { turnstile?: TurnstileApi };
    if (resetKey > 0 && widget.current && win.turnstile) win.turnstile.reset(widget.current);
  }, [resetKey]);
  if (!turnstileSiteKey) return null;
  return <div ref={container} />;
}

async function functionErrorMessage(error: unknown): Promise<string> {
  const context = (error as { context?: Response } | null)?.context;
  if (context && typeof context.json === "function") {
    const parsed = await context.json().catch(() => null) as { error?: string } | null;
    if (parsed?.error) return parsed.error;
  }
  return readableError(error);
}

type ContactProfile = Pick<InstructorProfile, "id" | "slug" | "display_name" | "business_name" | "city" | "region"> & {
  isStaticListing: boolean;
};

/** Query parameter that marks the return from Google sign-in with a saved draft. */
export const SEND_AFTER_SIGN_IN_PARAM = "send";

export function ContactInstructor() {
  const { session, account, isAdmin, loading: authLoading, refresh } = useMarketplaceSession();
  const [profile, setProfile] = useState<ContactProfile | null>(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successId, setSuccessId] = useState<string | null>(null);
  const [successThreadId, setSuccessThreadId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState<"form" | "signin" | "emailSent">("form");
  const [resuming, setResuming] = useState(false);
  const resumeStarted = useRef(false);
  const [guest, setGuest] = useState({ firstName: "", lastName: "", email: "", website: "" });
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [turnstileReset, setTurnstileReset] = useState(0);
  const [form, setForm] = useState<InquiryDraftForm>({
    eventType: "corporate-events",
    eventDate: "",
    startTime: "",
    venueName: "",
    city: "",
    region: "",
    postalCode: "",
    guestCount: "",
    budget: "",
    musicRequests: "",
    venueHasSpeakers: "unknown",
    venueHasMicrophone: "unknown",
    message: ""
  });

  useEffect(() => {
    const packageName = new URLSearchParams(window.location.search).get("package")?.trim().slice(0, 60);
    if (packageName) {
      setForm((current) => current.message ? current : { ...current, message: `I'm interested in your "${packageName}" package.` });
    }
  }, []);

  useEffect(() => {
    async function loadProfile() {
      const client = getMarketplaceClient();
      const identifier = new URLSearchParams(window.location.search).get("instructor");
      if (!client || !identifier) {
        setError("Choose an instructor before starting an inquiry.");
        setProfileLoading(false);
        return;
      }

      let query = client
        .from("instructor_directory_profiles")
        .select("id,slug,display_name,business_name,city,region");
      query = /^[0-9a-f-]{36}$/i.test(identifier) ? query.eq("id", identifier) : query.eq("slug", identifier);
      const { data, error: loadError } = await query.maybeSingle();
      if (loadError) {
        setError(loadError.message);
      } else if (data) {
        setProfile({ ...(data as Omit<ContactProfile, "isStaticListing">), isStaticListing: false });
      } else {
        const staticInstructor = instructors.find((item) => item.slug === identifier);
        if (staticInstructor) {
          setProfile({
            id: "",
            slug: staticInstructor.slug,
            display_name: staticInstructor.name,
            business_name: staticInstructor.business,
            city: staticInstructor.city,
            region: staticInstructor.state,
            isStaticListing: true
          });
        } else {
          setError("This instructor is not accepting inquiries yet.");
        }
      }
      setProfileLoading(false);
    }
    void loadProfile();
  }, []);

  function booleanOrNull(value: string) {
    if (value === "yes") return true;
    if (value === "no") return false;
    return null;
  }

  function budgetText(budget: string) {
    return budget === "" ? null : Number(budget).toLocaleString("en-US", { style: "currency", currency: "USD" });
  }

  function instructorKey() {
    return profile?.slug || profile?.id || "";
  }

  async function sendSignedIn(values: InquiryDraftForm) {
    const client = getMarketplaceClient();
    if (!client || !profile) return;
    setBusy(true);
    setError(null);
    setSuccessId(null);
    setSuccessThreadId(null);
    try {
      const { data, error: submitError } = await client.rpc("submit_inquiry", {
        p_instructor_profile_id: profile.id || null,
        p_instructor_slug: profile.slug,
        p_event_type: values.eventType,
        p_event_date: values.eventDate,
        p_event_start_time: values.startTime || null,
        p_time_zone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        p_venue_name: values.venueName || null,
        p_event_city: values.city || null,
        p_event_region: values.region || null,
        p_event_postal_code: values.postalCode || null,
        p_guest_count: values.guestCount ? Number(values.guestCount) : null,
        p_budget_range: budgetText(values.budget),
        p_music_requests: values.musicRequests || null,
        p_venue_has_speakers: booleanOrNull(values.venueHasSpeakers),
        p_venue_has_microphone: booleanOrNull(values.venueHasMicrophone),
        p_message: values.message || null,
        p_fallback_consent: true
      });
      if (submitError) throw submitError;
      const inquiryId = String(data);
      setSuccessId(inquiryId);
      const { data: threadId } = await client.rpc("get_inquiry_primary_thread", {
        p_inquiry_id: inquiryId
      });
      if (typeof threadId === "string") setSuccessThreadId(threadId);
    } catch (submitError) {
      setError(readableError(submitError));
    } finally {
      setBusy(false);
    }
  }

  // Back from Google sign-in: send the saved draft once, then forget it.
  useEffect(() => {
    if (authLoading || profileLoading || !profile || !session || resumeStarted.current) return;
    const url = new URL(window.location.href);
    if (!url.searchParams.has(SEND_AFTER_SIGN_IN_PARAM)) return;
    resumeStarted.current = true;
    url.searchParams.delete(SEND_AFTER_SIGN_IN_PARAM);
    window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
    const key = profile.slug || profile.id || "";
    const draft = readInquiryDraft(key);
    if (!draft) return;
    setForm(draft.form);
    setGuest((current) => ({ ...current, firstName: draft.firstName, lastName: draft.lastName }));
    // Instructor accounts cannot send inquiries; keep the draft and show the usual message.
    if (account?.role && account.role !== "organizer" && !isAdmin) return;
    // Clear before sending so a refresh can never send twice.
    clearInquiryDraft(key);
    void (async () => {
      setResuming(true);
      try {
        if (!account?.role && !isAdmin) {
          const client = getMarketplaceClient();
          if (!client) return;
          const metadata = session.user.user_metadata ?? {};
          const firstName = draft.firstName.trim() || String(metadata.given_name ?? "").trim();
          const lastName = draft.lastName.trim() || String(metadata.family_name ?? "").trim();
          const { error: onboardingError } = await client.rpc("complete_account_onboarding_with_names", {
            p_role: "organizer",
            p_first_name: firstName,
            p_last_name: lastName,
            p_company_name: null,
            p_invitation_token_hash: null
          });
          if (onboardingError) throw onboardingError;
          await refresh();
        }
        await sendSignedIn(draft.form);
      } catch (resumeError) {
        setError(readableError(resumeError));
      } finally {
        setResuming(false);
      }
    })();
    // Runs once per page load when the session and profile are ready.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, profileLoading, profile, session, account?.role, isAdmin]);

  async function continueWithGoogle() {
    const client = getMarketplaceClient();
    if (!client || !profile) return;
    setError(null);
    saveInquiryDraft({ v: 1, instructor: instructorKey(), form, firstName: guest.firstName, lastName: guest.lastName, savedAt: Date.now() });
    const back = new URL(window.location.href);
    back.searchParams.set(SEND_AFTER_SIGN_IN_PARAM, "1");
    setBusy(true);
    const { error: authError } = await client.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: callbackUrl(`${back.pathname}${back.search}`),
        queryParams: { prompt: "select_account" }
      }
    });
    if (authError) {
      setError(readableError(authError));
      setBusy(false);
    }
  }

  async function submitGuest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const client = getMarketplaceClient();
    if (!client || !profile) return;
    if (turnstileSiteKey && !turnstileToken) {
      setError("Please complete the verification and try again.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { data, error: invokeError } = await client.functions.invoke("guest-inquiry", {
        body: {
          email: guest.email,
          firstName: guest.firstName,
          lastName: guest.lastName || null,
          website: guest.website,
          turnstileToken,
          instructorProfileId: profile.id || null,
          instructorSlug: profile.slug,
          eventType: form.eventType,
          eventDate: form.eventDate,
          startTime: form.startTime || null,
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          venueName: form.venueName || null,
          city: form.city || null,
          region: form.region || null,
          postalCode: form.postalCode || null,
          guestCount: form.guestCount ? Number(form.guestCount) : null,
          budgetRange: budgetText(form.budget),
          musicRequests: form.musicRequests || null,
          venueHasSpeakers: booleanOrNull(form.venueHasSpeakers),
          venueHasMicrophone: booleanOrNull(form.venueHasMicrophone),
          message: form.message || null
        }
      });
      if (invokeError) throw invokeError;
      if (!data?.ok || !data?.held) throw new Error("We could not send your inquiry. Please try again.");
      setStep("emailSent");
    } catch (submitError) {
      setError(await functionErrorMessage(submitError));
      setTurnstileToken(null);
      setTurnstileReset((value) => value + 1);
    } finally {
      setBusy(false);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!session) {
      // The browser already checked the required fields. Ask how to sign in next.
      setError(null);
      setStep("signin");
      if (typeof window.scrollTo === "function") window.scrollTo({ top: 0 });
      return;
    }
    await sendSignedIn(form);
  }

  if (authLoading || profileLoading) return <div className={styles.loading}>Preparing your inquiry...</div>;
  if (resuming) return <div className={styles.loading}>Sending inquiry...</div>;

  if (!session && step === "emailSent") {
    return (
      <section className={`${styles.shell} ${styles.narrow}`}>
        <p className={styles.eyebrow}>Almost done</p>
        <h1 className={styles.title}>Check your email to send it</h1>
        <p className={styles.success}>We sent a link to {guest.email.trim()}. Click it to send your inquiry to {profile?.display_name || "the instructor"}. Nothing is sent until you do.</p>
        <p className={styles.subtitle}>{GUEST_INQUIRY_NOTE}</p>
        <div className={styles.buttonRow} style={{ marginTop: 26 }}>
          <Link className={styles.secondaryButton} href="/instructors/">Browse more instructors</Link>
        </div>
      </section>
    );
  }

  if (session && !account?.role) {
    return (
      <section className={`${styles.shell} ${styles.narrow}`}>
        <h1 className={styles.title}>Finish your account first</h1>
        <p className={styles.subtitle}>Tell us that you are planning an event, then return to this inquiry.</p>
        <a className={styles.button} href="/account/">Finish account setup</a>
      </section>
    );
  }

  if (session && account?.role !== "organizer" && !isAdmin) {
    return (
      <section className={`${styles.shell} ${styles.narrow}`}>
        <h1 className={styles.title}>Planner account required</h1>
        <p className={styles.subtitle}>This account is set up as an instructor. Contact support if you also need a planner workspace.</p>
      </section>
    );
  }

  if (error && !profile) {
    return (
      <section className={`${styles.shell} ${styles.narrow}`}>
        <h1 className={styles.title}>We could not start this inquiry</h1>
        <p className={styles.error}>{error}</p>
        <Link className={styles.button} href="/instructors/">Find an instructor</Link>
      </section>
    );
  }

  if (successId) {
    return (
      <section className={`${styles.shell} ${styles.narrow}`}>
        <p className={styles.eyebrow}>Inquiry sent</p>
        <h1 className={styles.title}>{profile?.display_name} has your event details</h1>
        <p className={styles.success}>
          {profile?.isStaticListing
            ? "Our team received your inquiry and will confirm that this launch listing is available before connecting you."
            : "Your inquiry is saved in Messages. We will notify the instructor with a link to read and reply."}
        </p>
        <p className={styles.subtitle}>Ask about availability, pricing, insurance, and venue needs. When you agree, the instructor sends a quote you can sign and pay in the conversation.</p>
        <p className={styles.subtitle}>When you book, you pay the full price plus the service fee upfront. We release the instructor’s payout to Stripe 24 hours after the event ends, unless a reported problem or payment dispute puts the payout on hold. Bank delivery may take additional business days.</p>
        <p className={styles.subtitle}>We ask instructors to respond within 48 hours. If you haven’t heard back by then, we’ll invite other matching instructors to respond to your event. You can compare their profiles and choose who to book.</p>
        <div className={styles.buttonRow} style={{ marginTop: 26 }}>
          <a className={styles.button} href={successThreadId ? `/account/?tab=inquiries&inquiry=${encodeURIComponent(successId)}&thread=${encodeURIComponent(successThreadId)}` : "/account/?tab=inquiries"}>View messages</a>
          <Link className={styles.secondaryButton} href="/instructors/">Browse more instructors</Link>
        </div>
      </section>
    );
  }

  if (!session && step === "signin") {
    const name = profile?.display_name || "the instructor";
    return (
      <section className={`${styles.shell} ${styles.narrow}`}>
        <p className={styles.eyebrow}>Contact {profile?.display_name}</p>
        <h1 className={styles.title}>One more step to send your inquiry</h1>
        <p className={styles.subtitle}>Sign in so {name} can reply to you. Your event details are saved.</p>
        <div className={`${styles.card} ${loginStyles.card}`}>
          <button className={loginStyles.googleButton} type="button" disabled={busy} onClick={() => void continueWithGoogle()}>
            {busy ? "Connecting to Google..." : "Continue with Google"}
          </button>
          <div className={loginStyles.divider}>or use your email</div>
          <form className={loginStyles.stack} onSubmit={submitGuest}>
            <label className={loginStyles.field}>
              <span>Email address</span>
              <input required type="email" autoComplete="email" maxLength={254} placeholder="you@company.com" value={guest.email} onChange={(e) => setGuest({ ...guest, email: e.target.value })} />
            </label>
            <TurnstileWidget onToken={setTurnstileToken} resetKey={turnstileReset} />
            <button className={loginStyles.button} type="submit" disabled={busy}>{busy ? "Sending link..." : "Email me a link to send it"}</button>
          </form>
          {error ? <p className={loginStyles.error} role="alert">{error}</p> : null}
          <p className={loginStyles.help}>{GUEST_INQUIRY_NOTE}</p>
        </div>
        <div className={styles.buttonRow} style={{ marginTop: 18 }}>
          <button className={styles.quietLink} type="button" disabled={busy} onClick={() => { setError(null); setStep("form"); }}>Edit event details</button>
        </div>
      </section>
    );
  }

  return (
    <section className={`${styles.shell} ${styles.narrow}`}>
      <p className={styles.eyebrow}>Contact {profile?.display_name}</p>
      <h1 className={styles.title}>Tell the instructor about your event</h1>
      <p className={styles.subtitle}>Send your event details and message through Hire Line Dancers. The instructor will confirm availability, rates, and terms. We ask instructors to respond within 48 hours. If there is no reply, or they are unavailable, we will invite other matching instructors to respond.</p>
      <form className={`${styles.card} ${styles.stack} ${contactStyles.form}`} onSubmit={submit}>
        {!session ? (
          <>
            <div className={styles.grid}>
              <label className={styles.field}>
                <span>First name</span>
                <input required autoComplete="given-name" maxLength={80} value={guest.firstName} onChange={(e) => setGuest({ ...guest, firstName: e.target.value })} />
              </label>
              <label className={styles.field}>
                <span>Last name</span>
                <input required autoComplete="family-name" maxLength={80} value={guest.lastName} onChange={(e) => setGuest({ ...guest, lastName: e.target.value })} />
              </label>
            </div>
            <label className={styles.honeypot} aria-hidden="true">
              <span>Website</span>
              <input tabIndex={-1} autoComplete="off" value={guest.website} onChange={(e) => setGuest({ ...guest, website: e.target.value })} />
            </label>
          </>
        ) : null}
        <label className={styles.field}>
          <span>Event type</span>
          <select required value={form.eventType} onChange={(e) => setForm({ ...form, eventType: e.target.value })}>
            {eventTypes.map((item) => <option key={item.slug} value={item.slug}>{item.label}</option>)}
          </select>
        </label>
        <div className={styles.grid}>
          <label className={`${styles.field} ${contactStyles.eventDate}`}>
            <span>Event date</span>
            <input required type="date" min={new Date().toISOString().slice(0, 10)} value={form.eventDate} onChange={(e) => setForm({ ...form, eventDate: e.target.value })} />
          </label>
          <label className={styles.field}>
            <span>Approximate start time</span>
            <input type="time" value={form.startTime} onChange={(e) => setForm({ ...form, startTime: e.target.value })} />
          </label>
          <label className={styles.field}>
            <span>Expected attendees</span>
            <input type="number" min="1" max="10000" value={form.guestCount} onChange={(e) => setForm({ ...form, guestCount: e.target.value })} />
          </label>
        </div>
        <label className={styles.field}>
          <span>Venue name (optional)</span>
          <input value={form.venueName} onChange={(e) => setForm({ ...form, venueName: e.target.value })} />
        </label>
        <div className={styles.grid}>
          <label className={styles.field}>
            <span>City</span>
            <input required value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
          </label>
          <label className={styles.field}>
            <span>State</span>
            <input required maxLength={2} value={form.region} onChange={(e) => setForm({ ...form, region: e.target.value.toUpperCase() })} />
          </label>
          <label className={styles.field}>
            <span>ZIP code</span>
            <input value={form.postalCode} onChange={(e) => setForm({ ...form, postalCode: e.target.value })} />
          </label>
          <label className={styles.field}>
            <span>Approximate budget (optional)</span>
            <div className={contactStyles.currencyInput}>
              <span aria-hidden="true">$</span>
              <input type="number" inputMode="decimal" min="0" step="0.01" aria-label="Approximate budget in dollars (optional)" value={form.budget} onChange={(e) => setForm({ ...form, budget: e.target.value })} />
            </div>
          </label>
        </div>
        <div className={styles.grid}>
          {([
            ["venueHasSpeakers", "Does the venue have speakers?"],
            ["venueHasMicrophone", "Does the venue have a microphone?"]
          ] as const).map(([field, label]) => (
            <fieldset className={contactStyles.equipmentField} key={field}>
              <legend className={styles.legend}>{label}</legend>
              <div className={contactStyles.choices}>
                {([["yes", "Yes"], ["no", "No"], ["unknown", "Not sure"]] as const).map(([value, text]) => (
                  <label className={contactStyles.choice} key={value}>
                    <input type="radio" name={field} value={value} checked={form[field] === value} onChange={() => setForm({ ...form, [field]: value })} />
                    <span>{text}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          ))}
        </div>
        <label className={styles.field}>
          <span>Music or song requests (optional)</span>
          <textarea value={form.musicRequests} onChange={(e) => setForm({ ...form, musicRequests: e.target.value })} />
        </label>
        <label className={styles.field}>
          <span>Anything else the instructor should know?</span>
          <textarea maxLength={3000} value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} />
        </label>
        <p className={styles.help}>Your inquiry goes to this instructor first. If they do not respond within 48 hours or mark themselves unavailable, we will share your full event details with other matching instructors. Your email and phone number stay private until you book. Your private conversations are not shared. You choose who to book.</p>
        <p className={styles.help}>Messages are handled through Hire Line Dancers. Authorized administrators can view them to support the inquiry.</p>
        {error ? <p className={styles.error}>{error}</p> : null}
        <button className={styles.button} disabled={busy} type="submit">{busy ? "Sending inquiry..." : "Send inquiry"}</button>
      </form>
    </section>
  );
}
