"use client";

import { useCallback, useEffect, useState } from "react";
import { getMarketplaceClient, readableError } from "@/lib/marketplace";
import { StarRating } from "./Reviews";
import adminStyles from "./AdminShell.module.css";
import styles from "./Marketplace.module.css";

export type OnboardingProgress = {
  instructor_profile_id: string;
  furthest_step: number;
  furthest_step_key: string;
  furthest_step_at: string;
};

export const onboardingStepLabels: Record<string, string> = {
  basics: "Basics",
  media: "Photos & videos",
  services: "Services",
  links: "Links & pricing",
  review: "Preview & submit",
  payouts: "Payouts"
};

/** Furthest onboarding step per instructor profile, for the admin profiles table. */
export function useOnboardingProgress(reloadKey: unknown) {
  const [progress, setProgress] = useState<Record<string, OnboardingProgress>>({});
  useEffect(() => {
    const client = getMarketplaceClient();
    if (!client) return;
    let active = true;
    void client
      .from("instructor_onboarding_progress")
      .select("instructor_profile_id,furthest_step,furthest_step_key,furthest_step_at")
      .then(({ data }) => {
        if (!active || !data) return;
        setProgress(Object.fromEntries((data as OnboardingProgress[]).map((row) => [row.instructor_profile_id, row])));
      }, () => undefined);
    return () => { active = false; };
  }, [reloadKey]);
  return progress;
}

export function OnboardingStepCell({ progress }: { progress: OnboardingProgress | undefined }) {
  if (!progress) return <span className={styles.muted}>Not recorded</span>;
  return (
    <>
      <span className={styles.status}>{progress.furthest_step}. {onboardingStepLabels[progress.furthest_step_key] ?? progress.furthest_step_key}</span>
      <small>{new Date(progress.furthest_step_at).toLocaleString()}</small>
    </>
  );
}

type AdminReview = {
  id: string;
  rating: number;
  note: string | null;
  created_at: string;
  hidden_at: string | null;
  instructor_name: string | null;
  organizer_name: string | null;
};

export function AdminReviewsCard() {
  const [reviews, setReviews] = useState<AdminReview[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const client = getMarketplaceClient();
    if (!client) return;
    const { data, error: loadError } = await client.rpc("admin_list_instructor_reviews", { p_limit: 100 });
    if (loadError) setError(readableError(loadError));
    else { setReviews((data as AdminReview[] | null) ?? []); setError(null); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function setHidden(review: AdminReview, hidden: boolean) {
    const client = getMarketplaceClient();
    if (!client) return;
    setBusyId(review.id);
    const { error: saveError } = await client.rpc("admin_set_instructor_review_hidden", { p_review_id: review.id, p_hidden: hidden });
    setBusyId(null);
    if (saveError) setError(readableError(saveError));
    else await load();
  }

  return (
    <section className={adminStyles.card}>
      <div className={styles.compactSectionHeader}><h2>Organizer reviews</h2><span className={styles.recordCount}>{reviews.length} total</span></div>
      {error ? <p className={styles.error}>{error}</p> : null}
      {reviews.length ? (
        <div className={adminStyles.tableWrap}>
          <table className={adminStyles.table}>
            <thead><tr><th>Instructor</th><th>Rating</th><th>Note</th><th>From</th><th>Status</th><th>Action</th></tr></thead>
            <tbody>{reviews.map((review) => (
              <tr key={review.id}>
                <td>{review.instructor_name}</td>
                <td><StarRating value={review.rating} /></td>
                <td>{review.note || <span className={styles.muted}>No note</span>}</td>
                <td>{review.organizer_name}<small>{new Date(review.created_at).toLocaleDateString()}</small></td>
                <td><span className={styles.status}>{review.hidden_at ? "Hidden" : "Public"}</span></td>
                <td>
                  <button className={styles.secondaryButton} type="button" disabled={busyId === review.id} onClick={() => void setHidden(review, !review.hidden_at)}>
                    {review.hidden_at ? "Show" : "Hide"}
                  </button>
                </td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      ) : <p className={styles.muted}>No reviews yet.</p>}
    </section>
  );
}
