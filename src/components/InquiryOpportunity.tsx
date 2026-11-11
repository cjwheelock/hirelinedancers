"use client";

import { useState } from "react";
import Link from "next/link";
import { CheckCircle2, Clock3, Users } from "lucide-react";
import { getMarketplaceClient } from "@/lib/marketplace";
import { money, displayDateTime } from "@/lib/booking";
import styles from "./Marketplace.module.css";

export type InquiryOpportunityState = {
  enabled: boolean;
  phase: "waiting" | "open" | "finalizing" | "confirmed" | "closed";
  shared_at: string | null;
  response_due_at: string | null;
  expires_at: string | null;
  payment_processing: boolean;
  own_selected?: boolean;
  own_availability: "awaiting" | "available" | "unavailable";
  candidates?: Array<{
    thread_id: string;
    display_name: string;
    slug: string | null;
    city: string | null;
    region: string | null;
    availability: "awaiting" | "available" | "unavailable";
    responded: boolean;
    quote_total: number | null;
    selected: boolean;
  }>;
};

export function InquiryOpportunity({ threadId, perspective, state, onOpen, onChanged }: {
  threadId: string;
  perspective: "organizer" | "instructor" | "admin";
  state: InquiryOpportunityState | null;
  onOpen: (threadId: string, quote: boolean) => void;
  onChanged: () => Promise<void>;
}) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!state?.enabled) return null;
  const stale = false;
  const canApply = ["waiting", "open"].includes(state.phase);
  const candidates = state.candidates ?? [];
  const available = candidates.filter(candidate => candidate.availability === "available");
  const phaseLabel = perspective === "instructor" && state.phase === "open" ? "Respond to this event" : perspective === "instructor" && state.phase === "waiting" ? "Response requested" : perspective === "instructor" && state.phase === "confirmed" && !state.own_selected ? "Opportunity closed" : { waiting: "Waiting for a response", open: "Finding your instructor", finalizing: "Finalizing booking", confirmed: "Booking confirmed", closed: "Opportunity closed" }[state.phase];

  async function availableForEvent() {
    const client = getMarketplaceClient();
    if (!client || stale || busy) return;
    setBusy(true);
    setError(null);
    const { error: updateError } = await client.rpc("set_inquiry_availability", { p_thread_id: threadId });
    if (updateError) setError(updateError.message);
    else await onChanged();
    setBusy(false);
  }

  return <section className={styles.opportunity} aria-label="Event opportunity" aria-busy={stale}>
    <header className={styles.opportunityHeader}>
      <div><p className={styles.eyebrow}>{perspective === "instructor" ? "Event opportunity" : "Your event"}</p><h3>{phaseLabel}</h3></div>
      {state.phase === "confirmed" ? <CheckCircle2 size={24} aria-hidden="true" /> : state.phase === "finalizing" ? <Clock3 size={24} aria-hidden="true" /> : <Users size={24} aria-hidden="true" />}
    </header>
    {state.phase === "waiting" ? <p>We ask instructors to respond within 48 hours.{state.response_due_at ? <> Response due by <strong>{displayDateTime(state.response_due_at)}</strong>.</> : null} If there is no reply, or the instructor is unavailable, we will invite other matching instructors to respond.</p> : null}
    {state.phase === "open" && perspective !== "instructor" ? <p>{state.shared_at && candidates.length < 2 ? "No other matching instructors could be invited. Your event has been flagged for our team. You can contact support for help." : state.shared_at ? "Matching instructors have been invited to your event. Compare profiles and responses, then choose who to book." : "Review the instructor’s response and profile, then agree on the details before booking."}</p> : null}
    {state.phase === "open" && perspective === "instructor" ? <p>Let the organizer know if you are available. They will choose an instructor after reviewing the responses.</p> : null}
    {state.phase === "finalizing" ? <p>{state.payment_processing ? "Payment is clearing. The booking will be confirmed when it succeeds." : <>The agreement is signed and payment is pending.{state.expires_at ? <> Payment is due before the quote expires on <strong>{displayDateTime(state.expires_at)}</strong>.</> : null}</>} New availability responses are paused until the booking is confirmed or the selection is released.</p> : null}
    {state.phase === "confirmed" ? <p>{perspective === "instructor" && state.own_selected ? "Your booking is confirmed. You can continue coordinating with the organizer in this conversation." : perspective === "instructor" ? "The organizer has booked an instructor for this event. This opportunity is now closed. Thank you for your interest." : "Your booking is confirmed. Other interested instructors have been notified, and this opportunity is closed."}</p> : null}
    {state.phase === "closed" ? <p>This opportunity is no longer available.</p> : null}
    {perspective === "instructor" && canApply ? <div className={styles.availabilityRow}>
      {state.own_availability === "available" ? <span className={styles.availabilityStatus}><CheckCircle2 size={17} aria-hidden="true" /> You marked yourself available</span> : state.own_availability === "unavailable" ? <p>You marked yourself unavailable. You can still message the organizer.</p> : <button className={styles.button} disabled={busy || stale} type="button" onClick={() => void availableForEvent()}>{busy ? "Updating..." : "Confirm availability"}</button>}
    </div> : null}
    {perspective !== "instructor" && !["waiting", "closed"].includes(state.phase) ? <>
      <p className={styles.opportunityCount}>{available.length} {available.length === 1 ? "instructor has" : "instructors have"} confirmed availability</p>
      <div className={styles.opportunityCandidates}>
        {candidates.map(candidate => <article className={styles.opportunityCandidate} key={candidate.thread_id}>
          <div className={styles.opportunityAvatar} aria-hidden="true">{candidate.display_name.split(" ").map(part => part[0]).slice(0, 2).join("")}</div>
          <div className={styles.opportunityIdentity}>
            <h4>{candidate.display_name}</h4><p>{[candidate.city, candidate.region].filter(Boolean).join(", ")}</p>
            <span className={candidate.availability === "available" ? styles.availabilityStatus : styles.muted}>{candidate.selected ? state.phase === "confirmed" ? "Booked" : "Selected" : candidate.availability === "available" ? "Available" : candidate.availability === "unavailable" ? "Unavailable" : candidate.responded ? "Replied" : "Awaiting response"}</span>
          </div>
          <div className={styles.opportunityActions}>
            {candidate.quote_total !== null ? <strong>{money(candidate.quote_total)} <small>total</small></strong> : null}
            <div className={styles.buttonRow}>
              {candidate.slug ? <Link href={`/profile/?instructor=${encodeURIComponent(candidate.slug)}`} className={styles.opportunityProfile}>View profile</Link> : null}
              <button className={styles.secondaryButton} disabled={stale} type="button" onClick={() => onOpen(candidate.thread_id, candidate.quote_total !== null)}>{candidate.quote_total !== null ? "View quote" : "Message"}</button>
            </div>
          </div>
        </article>)}
      </div>
      {state.phase === "open" && !available.length ? <p>We will notify you when an instructor responds. You can also <Link href="/support/">contact support</Link>.</p> : null}
    </> : null}
    {error ? <p className={styles.error} role="alert">{error}</p> : null}
  </section>;
}
