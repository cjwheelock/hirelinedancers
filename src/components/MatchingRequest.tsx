"use client";

import { FormEvent, useEffect, useState } from "react";
import { Check } from "lucide-react";
import { eventTypes } from "@/data/site";
import { getMarketplaceClient, readableError } from "@/lib/marketplace";
import { placeFromQuery } from "./matchingPlace";
import styles from "./Marketplace.module.css";
import contactStyles from "./ContactInstructor.module.css";
import own from "./MatchingRequest.module.css";

function booleanOrNull(value: string) {
  if (value === "yes") return true;
  if (value === "no") return false;
  return null;
}

export function MatchingRequest() {
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentPlace, setSentPlace] = useState<string | null>(null);
  const [form, setForm] = useState({
    eventType: "weddings",
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
    message: "",
    name: "",
    email: "",
    phone: "",
    website: ""
  });

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const city = params.get("city")?.trim().slice(0, 200) ?? "";
    const event = params.get("event")?.trim() ?? "";
    const place = placeFromQuery(city);
    setQuery(city);
    setForm((current) => ({
      ...current,
      city: place?.city ?? current.city,
      region: place?.region ?? current.region,
      eventType: eventTypes.some((item) => item.slug === event) ? event : current.eventType
    }));
  }, []);

  const place = placeFromQuery(query) ?? placeFromQuery([form.city, form.region].filter(Boolean).join(", "));
  const short = place?.short;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const client = getMarketplaceClient();
    if (!client) {
      setError("Something went wrong. Please try again.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { error: submitError } = await client.rpc("submit_matching_request", {
        p_event_type: form.eventType,
        p_event_date: form.eventDate,
        p_event_city: form.city,
        p_event_region: form.region,
        p_contact_name: form.name,
        p_contact_email: form.email,
        p_contact_phone: form.phone || null,
        p_event_start_time: form.startTime || null,
        p_time_zone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        p_venue_name: form.venueName || null,
        p_event_postal_code: form.postalCode || null,
        p_guest_count: form.guestCount ? Number(form.guestCount) : null,
        p_budget_range: form.budget === "" ? null : Number(form.budget).toLocaleString("en-US", { style: "currency", currency: "USD" }),
        p_music_requests: form.musicRequests || null,
        p_venue_has_speakers: booleanOrNull(form.venueHasSpeakers),
        p_venue_has_microphone: booleanOrNull(form.venueHasMicrophone),
        p_message: form.message || null,
        p_search_query: query || null,
        p_website: form.website || null
      });
      if (submitError) throw submitError;
      setSentPlace(placeFromQuery(`${form.city}, ${form.region}`)?.short ?? short ?? form.city);
      window.scrollTo({ top: 0 });
    } catch (submitError) {
      setError(readableError(submitError));
    } finally {
      setBusy(false);
    }
  }

  if (sentPlace) {
    return (
      <section className={`${styles.shell} ${styles.narrow}`}>
        <div className={styles.stack}>
          <span className={own.check} aria-hidden="true"><Check size={30} /></span>
          <p className={styles.eyebrow}>Request received</p>
          <h1 className={styles.title}>We&apos;re on it. Let&apos;s find your {sentPlace} instructor.</h1>
          <p className={styles.subtitle}>We sent a copy of your event details to your email. Here&apos;s what happens next.</p>
          <ul className={own.next}>
            <li><span className={own.dot} style={{ background: "#b8482a" }} aria-hidden="true" /><span><strong>Within 2 business days</strong> you&apos;ll hear from us with an update, even if we&apos;re still searching.</span></li>
            <li><span className={own.dot} style={{ background: "#e9a94b" }} aria-hidden="true" /><span><strong>When we find someone available</strong>, we&apos;ll introduce you and you can message them directly.</span></li>
            <li><span className={own.dot} style={{ background: "#1f6f6b" }} aria-hidden="true" /><span><strong>You decide.</strong> No obligation to book, and you only pay if you do.</span></li>
          </ul>
          <p className={styles.subtitle}>Questions or a tight timeline? Reply to the confirmation email and it comes straight to CJ.</p>
        </div>
      </section>
    );
  }

  return (
    <section className={styles.shell}>
      <div className={own.layout}>
        <div className={own.intro}>
          <div>
            <p className={styles.eyebrow}>Personal matching{place ? ` · ${place.full}` : ""}</p>
            <h1 className={styles.title}>Tell us about your event. We&apos;ll find your instructor.</h1>
            {short ? (
              <p className={styles.subtitle}>We don&apos;t have a listed instructor in {short} yet, but that doesn&apos;t mean there isn&apos;t a great one nearby. We&apos;ll go find them for you.</p>
            ) : null}
          </div>
          <ol className={own.steps}>
            <li><span className={own.num}>1</span><span><strong>You share the details</strong> using this form.</span></li>
            <li><span className={own.num}>2</span><span><strong>We reach out</strong> to instructors near {short ?? "you"} and confirm who&apos;s available on your date.</span></li>
            <li><span className={own.num}>3</span><span><strong>You get introductions</strong> and decide who to book. No obligation.</span></li>
          </ol>
          <figure className={own.note}>
            &ldquo;I read every one of these myself. Line dancing is one of the few things that gets three generations on the same floor, and I&apos;d love to help you make that happen{short ? ` in ${short}` : ""}.&rdquo;
            <strong>CJ, founder of Hire Line Dancers</strong>
          </figure>
        </div>

        <form className={`${styles.card} ${styles.stack} ${contactStyles.form} ${own.form}`} onSubmit={submit}>
          <h2 className={own.sectionTitle}>Your event</h2>
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

          <div className={own.divider} />
          <h2 className={own.sectionTitle}>How we reach you</h2>
          <div className={styles.grid}>
            <label className={styles.field}>
              <span>Your name</span>
              <input required autoComplete="name" maxLength={200} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </label>
            <label className={styles.field}>
              <span>Phone (optional)</span>
              <input type="tel" autoComplete="tel" maxLength={40} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            </label>
          </div>
          <label className={styles.field}>
            <span>Email</span>
            <input required type="email" autoComplete="email" maxLength={320} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </label>
          <label className={own.honeypot} aria-hidden="true">
            Website
            <input tabIndex={-1} autoComplete="off" value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })} />
          </label>

          {error ? <p className={styles.error}>{error}</p> : null}
          <button className={styles.button} disabled={busy} type="submit">{busy ? "Sending..." : "Find my instructor"}</button>
          <p className={styles.help}>Free to request, no account needed. We&apos;ll only share your event details with instructors we contact on your behalf. You only pay if you book.</p>
        </form>
      </div>
    </section>
  );
}
