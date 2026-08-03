"use client";

import { FormEvent, useEffect, useState } from "react";
import { eventTypes, instructors } from "@/data/site";
import { useMarketplaceSession } from "@/hooks/useMarketplaceSession";
import { getMarketplaceClient, loginUrl, readableError, type InstructorProfile } from "@/lib/marketplace";
import styles from "./Marketplace.module.css";

type ContactProfile = Pick<InstructorProfile, "id" | "slug" | "display_name" | "business_name" | "city" | "region"> & {
  isStaticListing: boolean;
};

export function ContactInstructor() {
  const { session, account, loading: authLoading } = useMarketplaceSession();
  const [profile, setProfile] = useState<ContactProfile | null>(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successId, setSuccessId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    eventType: "corporate-events",
    eventDate: "",
    startTime: "",
    venueName: "",
    city: "",
    region: "",
    postalCode: "",
    guestCount: "",
    budgetRange: "",
    musicRequests: "",
    venueHasSpeakers: "unknown",
    venueHasMicrophone: "unknown",
    message: ""
  });

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

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const client = getMarketplaceClient();
    if (!client || !profile) return;
    setBusy(true);
    setError(null);
    setSuccessId(null);

    try {
      const { data, error: submitError } = await client.rpc("submit_inquiry", {
        p_instructor_profile_id: profile.id || null,
        p_instructor_slug: profile.slug,
        p_event_type: form.eventType,
        p_event_date: form.eventDate,
        p_event_start_time: form.startTime || null,
        p_time_zone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        p_venue_name: form.venueName || null,
        p_event_city: form.city || null,
        p_event_region: form.region || null,
        p_event_postal_code: form.postalCode || null,
        p_guest_count: form.guestCount ? Number(form.guestCount) : null,
        p_budget_range: form.budgetRange || null,
        p_music_requests: form.musicRequests || null,
        p_venue_has_speakers: booleanOrNull(form.venueHasSpeakers),
        p_venue_has_microphone: booleanOrNull(form.venueHasMicrophone),
        p_message: form.message || null
      });
      if (submitError) throw submitError;
      setSuccessId(String(data));
    } catch (submitError) {
      setError(readableError(submitError));
    } finally {
      setBusy(false);
    }
  }

  if (authLoading || profileLoading) return <div className={styles.loading}>Preparing your inquiry...</div>;

  if (!session) {
    const next = `${window.location.pathname}${window.location.search}`;
    return (
      <section className={`${styles.shell} ${styles.narrow}`}>
        <p className={styles.eyebrow}>Contact an instructor</p>
        <h1 className={styles.title}>Sign in to send your inquiry</h1>
        <p className={styles.subtitle}>Profiles are open to everyone. An account is required only when you are ready to contact an instructor.</p>
        <div className={styles.buttonRow} style={{ marginTop: 28 }}>
          <a className={styles.button} href={loginUrl(next)}>Sign in and continue</a>
        </div>
      </section>
    );
  }

  if (!account?.role) {
    return (
      <section className={`${styles.shell} ${styles.narrow}`}>
        <h1 className={styles.title}>Finish your account first</h1>
        <p className={styles.subtitle}>Tell us that you are planning an event, then return to this inquiry.</p>
        <a className={styles.button} href="/account/">Finish account setup</a>
      </section>
    );
  }

  if (account.role !== "organizer") {
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
        <a className={styles.button} href="/#find">Find an instructor</a>
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
            : "We sent the instructor an email and queued a text alert if they enabled texts. They will reply directly to your account email."}
        </p>
        <p className={styles.subtitle}>Ask the instructor about availability, final pricing, contracts, insurance, payment terms, and any venue requirements.</p>
        <div className={styles.buttonRow} style={{ marginTop: 26 }}>
          <a className={styles.button} href="/account/">View my inquiries</a>
          <a className={styles.secondaryButton} href="/#find">Browse more instructors</a>
        </div>
      </section>
    );
  }

  return (
    <section className={`${styles.shell} ${styles.narrow}`}>
      <p className={styles.eyebrow}>Contact {profile?.display_name}</p>
      <h1 className={styles.title}>Tell the instructor about your event</h1>
      <p className={styles.subtitle}>This is an inquiry, not a booking. The instructor will confirm availability, rates, and terms by email.</p>
      <form className={`${styles.card} ${styles.stack}`} onSubmit={submit}>
        <div className={styles.grid}>
          <label className={styles.field}>
            <span>Event type</span>
            <select required value={form.eventType} onChange={(e) => setForm({ ...form, eventType: e.target.value })}>
              {eventTypes.map((item) => <option key={item.slug} value={item.slug}>{item.label}</option>)}
            </select>
          </label>
          <label className={styles.field}>
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
            <select value={form.budgetRange} onChange={(e) => setForm({ ...form, budgetRange: e.target.value })}>
              <option value="">Prefer to discuss</option>
              <option value="under-500">Under $500</option>
              <option value="500-999">$500 to $999</option>
              <option value="1000-1999">$1,000 to $1,999</option>
              <option value="2000-plus">$2,000 or more</option>
            </select>
          </label>
        </div>
        <div className={styles.grid}>
          <label className={styles.field}>
            <span>Does the venue have speakers?</span>
            <select value={form.venueHasSpeakers} onChange={(e) => setForm({ ...form, venueHasSpeakers: e.target.value })}>
              <option value="unknown">Not sure</option><option value="yes">Yes</option><option value="no">No</option>
            </select>
          </label>
          <label className={styles.field}>
            <span>Does the venue have a microphone?</span>
            <select value={form.venueHasMicrophone} onChange={(e) => setForm({ ...form, venueHasMicrophone: e.target.value })}>
              <option value="unknown">Not sure</option><option value="yes">Yes</option><option value="no">No</option>
            </select>
          </label>
        </div>
        <label className={styles.field}>
          <span>Music or song requests (optional)</span>
          <textarea value={form.musicRequests} onChange={(e) => setForm({ ...form, musicRequests: e.target.value })} />
        </label>
        <label className={styles.field}>
          <span>Anything else the instructor should know?</span>
          <textarea maxLength={3000} value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} />
        </label>
        {error ? <p className={styles.error}>{error}</p> : null}
        <button className={styles.button} disabled={busy} type="submit">{busy ? "Sending inquiry..." : "Send inquiry"}</button>
      </form>
    </section>
  );
}
