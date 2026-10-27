"use client";

import { FormEvent, useEffect, useState } from "react";
import Image from "next/image";
import { eventTypes } from "@/data/site";
import { getMarketplaceClient, type MarketplaceInquiry } from "@/lib/marketplace";
import styles from "./Marketplace.module.css";

type Recommendation = {
  instructor_profile_id: string;
  display_name: string;
  slug: string | null;
  bio: string | null;
  city: string | null;
  region: string | null;
  headshot_path: string | null;
  headshot_url: string | null;
};

export function InquiryRecommendations({ threadId, inquiry, onSent }: {
  threadId: string;
  inquiry: MarketplaceInquiry;
  onSent: (threadId: string) => void;
}) {
  const [candidates, setCandidates] = useState<Recommendation[]>([]);
  const [candidateThreadId, setCandidateThreadId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Recommendation | null>(null);
  const [message, setMessage] = useState(inquiry.message || "");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    setSelected(null);
    setMessage(inquiry.message || "");
    const client = getMarketplaceClient();
    if (!client) { setLoading(false); return; }
    void client.rpc("get_inquiry_recommendations", { p_thread_id: threadId }).then(({ data, error: loadError }) => {
      if (!active) return;
      if (loadError) setError("We could not load other instructors. Please try again.");
      const rows: Recommendation[] = Array.isArray(data) ? data : [];
      setCandidates(rows);
      setCandidateThreadId(threadId);
      const requested = new URLSearchParams(window.location.search).get("recommend");
      setSelected(rows.find((candidate) => candidate.instructor_profile_id === requested) || null);
      setLoading(false);
    });
    return () => { active = false; };
  }, [threadId, inquiry.message, reload]);

  const showingCurrentThread = candidateThreadId === threadId;
  const currentCandidates = showingCurrentThread ? candidates : [];
  const currentSelected = showingCurrentThread ? selected : null;
  const currentError = showingCurrentThread ? error : null;
  const currentLoading = loading || !showingCurrentThread;

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const client = getMarketplaceClient();
    if (!client || !currentSelected || busy) return;
    setBusy(true);
    setError(null);
    const { data, error: sendError } = await client.rpc("contact_recommended_instructor", {
      p_thread_id: threadId,
      p_instructor_profile_id: currentSelected.instructor_profile_id,
      p_message: message.trim() || null
    });
    if (sendError) setError(sendError.message);
    else if (typeof data === "string") {
      const url = new URL(window.location.href);
      url.searchParams.delete("recommend");
      url.searchParams.set("thread", data);
      window.history.replaceState(null, "", url);
      onSent(data);
    }
    setBusy(false);
  }

  return (
    <section className={styles.recommendations} aria-label="Other instructors">
      <h3>Other instructors for your event</h3>
      <p>Your event details are saved. Choose an instructor to review and send your inquiry.</p>
      {currentLoading ? <p role="status">Finding instructors...</p> : null}
      {currentError ? <p className={styles.error} role="alert">{currentError} <button className={styles.secondaryButton} disabled={busy} type="button" onClick={() => setReload((value) => value + 1)}>Try again</button></p> : null}
      {!currentLoading && !currentError && !currentCandidates.length ? <p>We could not find another suitable instructor to recommend yet. Your request has been flagged for our team. <a href="/support/">Contact support</a></p> : null}
      <div className={styles.recommendationGrid}>
        {currentCandidates.map((candidate) => {
          const photo = candidate.headshot_path
            ? getMarketplaceClient()?.storage.from("instructor-media").getPublicUrl(candidate.headshot_path).data.publicUrl
            : candidate.headshot_url?.startsWith("https://") ? candidate.headshot_url : null;
          return (
            <article className={styles.recommendationCard} key={candidate.instructor_profile_id}>
              {photo ? <Image unoptimized src={photo} alt={candidate.display_name} width={72} height={72} onError={(event) => { event.currentTarget.hidden = true; }} /> : null}
              <h4>{candidate.display_name}</h4>
              <p className={styles.muted}>{[candidate.city, candidate.region].filter(Boolean).join(", ")}</p>
              {candidate.bio ? <p>{candidate.bio}</p> : null}
              <button className={styles.button} type="button" disabled={busy} onClick={() => { setSelected(candidate); setError(null); }}>Reach Out</button>
            </article>
          );
        })}
      </div>
      {currentSelected ? (
        <form className={`${styles.card} ${styles.stack}`} onSubmit={send}>
          <h4>Send your inquiry to {currentSelected.display_name}</h4>
          <dl className={styles.savedEventDetails}>
            <div><dt>Event</dt><dd>{eventTypes.find((type) => type.slug === inquiry.event_type)?.label || inquiry.event_type}</dd></div>
            <div><dt>Date</dt><dd>{inquiry.event_date}{inquiry.event_start_time ? ` at ${inquiry.event_start_time.slice(0, 5)}` : ""}</dd></div>
            <div><dt>Location</dt><dd>{[inquiry.venue_name, inquiry.event_city, inquiry.event_region, inquiry.event_postal_code].filter(Boolean).join(", ")}</dd></div>
            {inquiry.guest_count ? <div><dt>Attendees</dt><dd>{inquiry.guest_count}</dd></div> : null}
            {inquiry.budget_range ? <div><dt>Budget</dt><dd>{({ "under-500": "Under $500", "500-999": "$500 to $999", "1000-1999": "$1,000 to $1,999", "2000-plus": "$2,000 or more" } as Record<string, string>)[inquiry.budget_range] || inquiry.budget_range}</dd></div> : null}
            {inquiry.music_requests ? <div><dt>Music requests</dt><dd>{inquiry.music_requests}</dd></div> : null}
            <div><dt>Venue speakers</dt><dd>{inquiry.venue_has_speakers == null ? "Not sure" : inquiry.venue_has_speakers ? "Yes" : "No"}</dd></div>
            <div><dt>Venue microphone</dt><dd>{inquiry.venue_has_microphone == null ? "Not sure" : inquiry.venue_has_microphone ? "Yes" : "No"}</dd></div>
          </dl>
          <label className={styles.field}><span>Message</span><textarea value={message} maxLength={4000} onChange={(event) => setMessage(event.target.value)} /></label>
          <p className={styles.help}>This sends your event details and message in a new private conversation. The instructor will confirm availability and pricing.</p>
          <div className={styles.buttonRow}>
            <button className={styles.button} disabled={busy} type="submit">{busy ? "Sending inquiry..." : "Send inquiry"}</button>
            <button className={styles.secondaryButton} disabled={busy} type="button" onClick={() => setSelected(null)}>Cancel</button>
          </div>
        </form>
      ) : null}
    </section>
  );
}
