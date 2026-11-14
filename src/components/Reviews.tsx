"use client";

import { FormEvent, useEffect, useState } from "react";
import { Star } from "lucide-react";
import { getMarketplaceClient, readableError } from "@/lib/marketplace";
import styles from "./Marketplace.module.css";

export const REVIEW_NOTE_LIMIT = 1000;

export function StarRating({ value, size = 16 }: { value: number; size?: number }) {
  const rounded = Math.round(value);
  return (
    <span className={styles.stars} role="img" aria-label={`${value} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star key={n} size={size} aria-hidden="true" className={n <= rounded ? styles.starFilled : styles.muted} fill={n <= rounded ? "currentColor" : "none"} />
      ))}
    </span>
  );
}

function StarInput({ value, onChange, disabled }: { value: number; onChange: (value: number) => void; disabled?: boolean }) {
  return (
    <span className={styles.stars} role="radiogroup" aria-label="Rating">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          role="radio"
          aria-checked={value === n}
          aria-label={`${n} star${n === 1 ? "" : "s"}`}
          className={`${styles.starButton} ${n <= value ? styles.starFilled : ""}`}
          disabled={disabled}
          onClick={() => onChange(n)}
        >
          <Star size={26} aria-hidden="true" fill={n <= value ? "currentColor" : "none"} />
        </button>
      ))}
    </span>
  );
}

type BookingReviewState = {
  booking_id?: string;
  can_review: boolean;
  review: { rating: number; note: string | null; created_at: string } | null;
};

/** Shown to the organizer in a conversation once a paid booking is complete. */
export function BookingReviewForm({ threadId, autoFocus = false }: { threadId: string; autoFocus?: boolean }) {
  const [state, setState] = useState<BookingReviewState | null>(null);
  const [rating, setRating] = useState(0);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const client = getMarketplaceClient();
    if (!client) return;
    let active = true;
    void client.rpc("get_booking_review", { p_thread_id: threadId }).then(({ data }) => {
      if (active) setState((data as BookingReviewState | null) ?? null);
    }, () => undefined);
    return () => { active = false; };
  }, [threadId]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!state?.booking_id) return;
    if (rating < 1) {
      setError("Choose a rating from 1 to 5");
      return;
    }
    const client = getMarketplaceClient();
    if (!client) return;
    setBusy(true);
    setError(null);
    const { error: saveError } = await client.rpc("submit_instructor_review", { p_booking_id: state.booking_id, p_rating: rating, p_note: note.trim() || null });
    setBusy(false);
    if (saveError) {
      setError(readableError(saveError));
      return;
    }
    setState({ ...state, can_review: false, review: { rating, note: note.trim() || null, created_at: new Date().toISOString() } });
  }

  if (!state?.booking_id) return null;
  if (state.review) {
    return (
      <section className={styles.card} aria-label="Your review">
        <p className={styles.eyebrow}>Your review</p>
        <StarRating value={state.review.rating} />
        {state.review.note ? <p>{state.review.note}</p> : null}
        <p className={styles.success} role="status">Thanks for your review.</p>
      </section>
    );
  }
  if (!state.can_review) return null;
  return (
    <form className={`${styles.card} ${styles.stack}`} onSubmit={submit} aria-labelledby={`review-${threadId}`}>
      <div>
        <h3 id={`review-${threadId}`}>How did it go?</h3>
        <p className={styles.help}>Your review appears on the instructor&rsquo;s public profile and helps other planners choose.</p>
      </div>
      <StarInput value={rating} onChange={setRating} disabled={busy} />
      <label className={styles.field}>
        <span>Add a note (optional)</span>
        <textarea autoFocus={autoFocus} maxLength={REVIEW_NOTE_LIMIT} value={note} onChange={(event) => setNote(event.target.value)} />
      </label>
      {error ? <p className={styles.error} role="alert">{error}</p> : null}
      <div className={styles.buttonRow}>
        <button className={styles.button} type="submit" disabled={busy}>{busy ? "Sending..." : "Submit review"}</button>
      </div>
    </form>
  );
}

type PublicReviewData = {
  count: number;
  average: number | null;
  reviews: { id: string; rating: number; note: string | null; created_at: string; reviewer_name: string; event_type: string | null }[];
};

/** Organizer reviews on a public instructor profile. Renders nothing until there is at least one. */
export function PublicReviews({ profileId, eventTypeLabel, sectionClassName, kickerClassName }: {
  profileId: string;
  eventTypeLabel?: (slug: string) => string;
  sectionClassName?: string;
  kickerClassName?: string;
}) {
  const [data, setData] = useState<PublicReviewData | null>(null);
  useEffect(() => {
    const client = getMarketplaceClient();
    if (!client || !profileId) return;
    let active = true;
    void client.rpc("get_instructor_reviews", { p_instructor_profile_id: profileId }).then(({ data: result }) => {
      if (active) setData((result as PublicReviewData | null) ?? null);
    }, () => undefined);
    return () => { active = false; };
  }, [profileId]);

  if (!data || !data.count) return null;
  return (
    <section className={sectionClassName} aria-labelledby="profile-reviews">
      <p className={kickerClassName}>Reviews</p>
      <h2 id="profile-reviews">What planners say</h2>
      <p>
        <StarRating value={Number(data.average ?? 0)} /> <strong>{data.average}</strong> <span className={styles.muted}>({data.count} review{data.count === 1 ? "" : "s"})</span>
      </p>
      <ul className={styles.reviewList}>
        {data.reviews.map((review) => (
          <li className={styles.reviewItem} key={review.id}>
            <StarRating value={review.rating} />
            {review.note ? <p>{review.note}</p> : null}
            <small className={styles.muted}>
              {review.reviewer_name}
              {review.event_type ? ` · ${eventTypeLabel ? eventTypeLabel(review.event_type) : review.event_type}` : ""}
              {` · ${new Date(review.created_at).toLocaleDateString("en-US", { month: "long", year: "numeric" })}`}
            </small>
          </li>
        ))}
      </ul>
    </section>
  );
}
