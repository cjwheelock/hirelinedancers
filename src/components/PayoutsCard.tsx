"use client";

import { FormEvent, useEffect, useState } from "react";
import { Banknote, ExternalLink } from "lucide-react";
import {
  bookingTerms,
  cancellationLines,
  clientFeeLabel,
  instructorFeeLabel,
  invokeBookingFunction,
  money,
  previewAmounts,
  validCancellationWindows,
  type CancellationWindow
} from "@/lib/booking";
import { getMarketplaceClient, type InstructorPrivateSettings } from "@/lib/marketplace";
import { WindowsEditor } from "./BookingPanel";
import styles from "./Marketplace.module.css";

type PayoutStatus = {
  hasAccount: boolean;
  payoutsReady: boolean;
  detailsSubmitted: boolean;
  requirementsCurrentlyDue: string[];
};

type BookingSettings = InstructorPrivateSettings & {
  hourly_rate_cents?: number | null;
  default_cancellation_policy?: "standard" | "custom";
  custom_cancellation_windows?: CancellationWindow[] | null;
};

const standardWindows = bookingTerms.standardCancellationWindows as CancellationWindow[];

export function PayoutsCard({
  profileId,
  settings,
  onSaved
}: {
  profileId: string;
  settings: BookingSettings | null;
  onSaved: () => void;
}) {
  const [status, setStatus] = useState<PayoutStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function refresh(silent = false) {
    if (!silent) setLoading(true);
    try {
      const result = await invokeBookingFunction<PayoutStatus>("booking-payouts", { action: "status" });
      setStatus(result);
      setError(null);
    } catch (statusError) {
      setError(statusError instanceof Error ? statusError.message : "Unable to load payout setup.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const returned = params.get("payouts");
    void refresh().then(() => {
      if (returned === "returned") setNotice("Welcome back. Your payout setup status is shown below.");
      if (returned === "refresh") setNotice("Your setup link expired. Choose Continue payout setup to get a new one.");
      if (returned) {
        const url = new URL(window.location.href);
        url.searchParams.delete("payouts");
        window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
      }
    });
  }, [profileId]);

  async function open(action: "onboard" | "dashboard") {
    setBusy(action);
    setError(null);
    try {
      const result = await invokeBookingFunction<{ url?: string }>("booking-payouts", { action });
      if (result.url) window.location.assign(result.url);
    } catch (openError) {
      setError(openError instanceof Error ? openError.message : "Unable to open Stripe.");
      setBusy(null);
    }
  }

  const example = previewAmounts(40000);

  return (
    <>
      <div className={styles.card}>
        <p className={styles.eyebrow}><Banknote aria-hidden="true" size={15} /> Payouts</p>
        <h2>Get paid for bookings</h2>
        <p>Joining Hire Line Dancers is free. Clients pay through Hire Line Dancers when they sign your quote. We hold the payment and send your share to your bank account {bookingTerms.payoutDelayHours} hours after the event.</p>
        <p className={styles.help}>Example: on a {money(example.priceCents)} booking, the client pays {money(example.totalCents)} including a {clientFeeLabel} service fee, and you receive {money(example.instructorPayoutCents)} after the {instructorFeeLabel} platform fee.</p>

        <div className={styles.payoutStatus}>
          {loading ? <p className={styles.muted}>Checking payout setup...</p> : null}
          {notice ? <p className={styles.notice} role="status">{notice}</p> : null}
          {error ? <p className={styles.error} role="alert">{error}</p> : null}
          {!loading && status?.payoutsReady ? (
            <>
              <p className={styles.success}>Payouts are ready. You can send quotes from any conversation.</p>
              <div className={styles.buttonRow}>
                <button className={styles.secondaryButton} type="button" disabled={busy !== null} onClick={() => void open("dashboard")}>
                  <ExternalLink aria-hidden="true" size={16} /> {busy === "dashboard" ? "Opening..." : "View payouts and bank details"}
                </button>
              </div>
            </>
          ) : null}
          {!loading && status && !status.payoutsReady ? (
            <>
              <p className={styles.notice}>
                {status.hasAccount
                  ? status.detailsSubmitted
                    ? "Stripe is verifying your details. This usually takes a few minutes."
                    : "Your payout setup is not finished yet."
                  : "Set up payouts before sending your first quote. Stripe asks for your legal name, date of birth, address, Social Security number or EIN, and a bank account or debit card. It takes about 5 minutes."}
              </p>
              {status.requirementsCurrentlyDue.length ? <p className={styles.help}>Stripe still needs {status.requirementsCurrentlyDue.length} item{status.requirementsCurrentlyDue.length === 1 ? "" : "s"} from you.</p> : null}
              <div className={styles.buttonRow}>
                <button className={styles.button} type="button" disabled={busy !== null} onClick={() => void open("onboard")}>
                  {busy === "onboard" ? "Opening Stripe..." : status.hasAccount ? "Continue payout setup" : "Set up payouts"}
                </button>
                {status.hasAccount ? <button className={styles.secondaryButton} type="button" disabled={busy !== null || loading} onClick={() => void refresh()}>Check again</button> : null}
              </div>
              <p className={styles.muted}>Stripe securely stores your tax ID and bank details. Hire Line Dancers never sees them. Stripe sends a 1099 tax form when federal or state rules require one.</p>
            </>
          ) : null}
        </div>
      </div>
      <BookingPreferencesCard profileId={profileId} settings={settings} onSaved={onSaved} />
    </>
  );
}

function BookingPreferencesCard({ profileId, settings, onSaved }: { profileId: string; settings: BookingSettings | null; onSaved: () => void }) {
  const [hourlyRate, setHourlyRate] = useState(settings?.hourly_rate_cents ? String(settings.hourly_rate_cents / 100) : "");
  const [minimumHours, setMinimumHours] = useState(settings?.minimum_hours ? String(settings.minimum_hours) : "2");
  const [policy, setPolicy] = useState<"standard" | "custom">(settings?.default_cancellation_policy ?? "standard");
  const [windows, setWindows] = useState<CancellationWindow[]>(settings?.custom_cancellation_windows ?? [{ minDaysBeforeEvent: 14, refundPercent: 100 }]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setMessage(null);
    const rate = hourlyRate.trim() ? Math.round(Number(hourlyRate) * 100) : null;
    const hours = minimumHours.trim() ? Number(minimumHours) : null;
    if (rate !== null && (!Number.isFinite(rate) || rate < 1000 || rate > 500000)) return setError("Enter an hourly rate between $10 and $5,000.");
    if (hours !== null && (!Number.isFinite(hours) || hours < 0.5 || hours > 24)) return setError("Enter a minimum between 0.5 and 24 hours.");
    if (policy === "custom" && !validCancellationWindows(windows)) return setError("Fix the custom cancellation windows before saving.");
    const client = getMarketplaceClient();
    if (!client) return;
    setBusy(true);
    const { error: saveError } = await client
      .from("instructor_private_settings")
      .update({
        hourly_rate_cents: rate,
        minimum_hours: hours,
        default_cancellation_policy: policy,
        custom_cancellation_windows: policy === "custom" ? windows : settings?.custom_cancellation_windows ?? null
      })
      .eq("instructor_profile_id", profileId);
    setBusy(false);
    if (saveError) setError(saveError.message);
    else {
      setMessage("Booking defaults saved. New quotes start with these values, and you can change them on any quote.");
      onSaved();
    }
  }

  return (
    <form className={styles.card} onSubmit={save}>
      <p className={styles.eyebrow}>Booking defaults</p>
      <h2>Your rates and policies</h2>
      <p className={styles.help}>These are private and prefill your quotes. You set your own rate and minimum; many instructors choose a 2-hour minimum.</p>
      <div className={styles.bookingFormGrid}>
        <label className={styles.field}><span>Hourly rate ($)</span><input type="number" min="10" max="5000" step="0.01" value={hourlyRate} onChange={(event) => setHourlyRate(event.target.value)} /></label>
        <label className={styles.field}><span>Minimum hours</span><input type="number" min="0.5" max="24" step="0.5" value={minimumHours} onChange={(event) => setMinimumHours(event.target.value)} /></label>
      </div>
      <fieldset className={styles.bookingFieldset}>
        <legend className={styles.legend}>Default cancellation policy</legend>
        <label className={styles.check}><input type="radio" checked={policy === "standard"} onChange={() => setPolicy("standard")} /> Standard: {cancellationLines(standardWindows).join("; ")}</label>
        <label className={styles.check}><input type="radio" checked={policy === "custom"} onChange={() => setPolicy("custom")} /> Custom</label>
        {policy === "custom" ? <WindowsEditor windows={windows} onChange={setWindows} /> : null}
      </fieldset>
      {message ? <p className={styles.success}>{message}</p> : null}
      {error ? <p className={styles.error}>{error}</p> : null}
      <div className={styles.buttonRow}>
        <button className={styles.button} type="submit" disabled={busy}>{busy ? "Saving..." : "Save booking defaults"}</button>
      </div>
    </form>
  );
}
