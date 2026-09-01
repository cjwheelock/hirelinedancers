"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { getMarketplaceClient, readableError } from "@/lib/marketplace";
import styles from "./Marketplace.module.css";

type MembershipCreditRow = {
  id: string;
  instructor_profile_id: string;
  benefit_code: string;
  source: "admin" | "referral" | "welcome_video";
  source_reference: string;
  status: string;
  admin_note: string | null;
  awarded_at: string;
  applied_at: string | null;
  consumed_at: string | null;
  voided_at: string | null;
  expires_at: string | null;
  application_id: string | null;
  application_status: string | null;
  deferred_reason: string | null;
  stripe_invoice_id: string | null;
  actual_discount_amount_cents: number | null;
  currency: string | null;
};

function creditDate(value: string | null) {
  return value ? new Date(value).toLocaleString() : "Not yet";
}

function creditStatus(value: string | null) {
  return (value || "pending").replaceAll("_", " ");
}

function money(cents: number | null, currency: string | null) {
  if (cents == null) return null;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: (currency || "usd").toUpperCase()
  }).format(cents / 100);
}

async function edgeError(error: unknown) {
  if (error && typeof error === "object" && "context" in error) {
    const context = (error as { context?: unknown }).context;
    if (context instanceof Response) {
      const payload = await context.clone().json().catch(() => null) as { error?: unknown } | null;
      if (typeof payload?.error === "string") return payload.error;
    }
  }
  return readableError(error);
}

export function MembershipCreditAdmin({
  instructorProfileId,
  isOwner
}: {
  instructorProfileId: string;
  isOwner: boolean;
}) {
  const [credits, setCredits] = useState<MembershipCreditRow[]>([]);
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const grantRequestId = useRef<string | null>(null);

  const load = useCallback(async () => {
    const client = getMarketplaceClient();
    if (!client) return;
    setLoading(true);
    setError(null);
    const { data, error: loadError } = await client.rpc("admin_list_membership_credit_entitlements", {
      p_instructor_profile_id: instructorProfileId
    });
    if (loadError) setError(loadError.message);
    else setCredits((Array.isArray(data) ? data : []) as MembershipCreditRow[]);
    setLoading(false);
  }, [instructorProfileId]);

  useEffect(() => {
    grantRequestId.current = null;
    setNote("");
    setMessage(null);
    void load();
  }, [instructorProfileId, load]);

  async function grant(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const client = getMarketplaceClient();
    if (!client || !isOwner) return;
    const requestId = grantRequestId.current ?? crypto.randomUUID();
    grantRequestId.current = requestId;
    setBusy(true);
    setError(null);
    setMessage(null);
    const { data, error: grantError } = await client.functions.invoke("grant-membership-free-month", {
      body: {
        instructorProfileId,
        source: "admin",
        sourceReference: requestId,
        idempotencyKey: requestId,
        adminNote: note.trim() || null
      },
      headers: { "Idempotency-Key": requestId }
    });
    if (grantError) {
      setError(await edgeError(grantError));
      setBusy(false);
      return;
    }
    const outcome = String(data?.outcome ?? "existing");
    setMessage(outcome === "applied"
      ? "The free month was granted and applied to the next eligible membership invoice."
      : outcome === "deferred"
        ? "The free month was granted and will apply when the membership becomes eligible."
        : "This free-month grant was already recorded."
    );
    grantRequestId.current = null;
    setNote("");
    await load();
    setBusy(false);
  }

  return (
    <section className={`${styles.card} ${styles.stack} ${styles.compactAdminCard}`}>
      <div className={styles.membershipHeader}>
        <div>
          <h3>Membership credits</h3>
          <p className={styles.muted}>Free-month grants are applied one eligible renewal at a time.</p>
        </div>
        <span className={styles.recordCount}>{credits.length}</span>
      </div>
      {error ? <p className={styles.error} role="alert">{error}</p> : null}
      {message ? <p className={styles.success} role="status">{message}</p> : null}
      {isOwner ? (
        <form className={styles.stack} onSubmit={grant}>
          <label className={styles.field}>
            <span>Internal grant note (optional)</span>
            <textarea maxLength={1000} value={note} onChange={(event) => setNote(event.target.value)} />
          </label>
          <button className={styles.button} disabled={busy} type="submit">{busy ? "Granting..." : "Grant one free month"}</button>
        </form>
      ) : <p className={styles.notice}>Membership credits are read-only for delegated administrators.</p>}
      {loading ? <p className={styles.notice}>Loading membership credits...</p> : null}
      {!loading && !credits.length ? <p className={styles.muted}>No membership credits have been granted.</p> : null}
      {credits.length ? (
        <div className={styles.creditHistory}>
          {credits.map((credit) => (
            <article key={credit.id}>
              <div className={styles.buttonRow}>
                <strong>One free month</strong>
                <span className={styles.status}>{creditStatus(credit.status)}</span>
              </div>
              <dl>
                <div><dt>Source</dt><dd>{creditStatus(credit.source)}</dd></div>
                <div><dt>Granted</dt><dd>{creditDate(credit.awarded_at)}</dd></div>
                <div><dt>Applied</dt><dd>{creditDate(credit.applied_at)}</dd></div>
                <div><dt>Consumed</dt><dd>{creditDate(credit.consumed_at)}</dd></div>
                {credit.deferred_reason ? <div><dt>Waiting for</dt><dd>{creditStatus(credit.deferred_reason)}</dd></div> : null}
                {money(credit.actual_discount_amount_cents, credit.currency) ? <div><dt>Invoice discount</dt><dd>{money(credit.actual_discount_amount_cents, credit.currency)}</dd></div> : null}
              </dl>
              {credit.admin_note ? <p>{credit.admin_note}</p> : null}
            </article>
          ))}
        </div>
      ) : null}
    </section>
  );
}
