"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { CalendarCheck, FileSignature, ShieldCheck } from "lucide-react";
import {
  bookingStatusLabels,
  bookingTerms,
  cancellationLines,
  clientFeeLabel,
  displayDate,
  displayDateTime,
  displayTime,
  instructorFeeLabel,
  invokeBookingFunction,
  money,
  nextStepText,
  openBookingStatuses,
  paidBookingStatuses,
  previewAmounts,
  validCancellationWindows,
  type Booking,
  type BookingDefaults,
  type CancellationWindow,
  type ThreadBookingState
} from "@/lib/booking";
import { getMarketplaceClient, type InstructorSocialLinks, type ProfilePackage } from "@/lib/marketplace";
import { BookingAgreementReview } from "./BookingAgreementReview";
import styles from "./Marketplace.module.css";

const timeZones = [
  ["America/New_York", "Eastern"],
  ["America/Chicago", "Central"],
  ["America/Denver", "Mountain"],
  ["America/Phoenix", "Arizona"],
  ["America/Los_Angeles", "Pacific"],
  ["America/Anchorage", "Alaska"],
  ["Pacific/Honolulu", "Hawaii"]
] as const;

type Panel = "none" | "quote" | "review" | "cancel" | "problem" | "resolve";

export function BookingPanel({
  threadId,
  state,
  loading,
  onChanged
}: {
  threadId: string;
  state: ThreadBookingState | null;
  loading: boolean;
  onChanged: () => void | Promise<void>;
}) {
  const [panel, setPanel] = useState<Panel>("none");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showAgreement, setShowAgreement] = useState(false);
  const [confirmingPayment, setConfirmingPayment] = useState(false);

  useEffect(() => {
    setPanel("none");
    setError(null);
    setNotice(null);
    setShowAgreement(false);
  }, [threadId]);

  // Returning from Stripe Checkout.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const outcome = params.get("booking");
    if (!outcome || params.get("thread") !== threadId) return;
    const clear = () => {
      const url = new URL(window.location.href);
      url.searchParams.delete("booking");
      url.searchParams.delete("session_id");
      window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
    };
    if (outcome === "payment_canceled") {
      setNotice("Payment was not completed. Your signature is saved, so you can finish payment any time before the quote expires.");
      clear();
      return;
    }
    if (outcome !== "paid") return;
    setConfirmingPayment(true);
    let attempts = 0;
    let timer: number | undefined;
    const poll = async () => {
      attempts += 1;
      await onChanged();
      if (attempts < 8) timer = window.setTimeout(() => void poll(), 2000);
      else {
        setConfirmingPayment(false);
        clear();
      }
    };
    timer = window.setTimeout(() => void poll(), 1200);
    return () => { if (timer) window.clearTimeout(timer); };
    // onChanged is stable enough for this one-time return check.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadId]);

  useEffect(() => {
    if (!confirmingPayment || !state?.booking) return;
    if (paidBookingStatuses.includes(state.booking.status)) {
      setConfirmingPayment(false);
      setNotice(state.booking.status === "payment_processing"
        ? "Your bank payment started. The booking is confirmed as soon as it clears, usually in about 4 business days."
        : "Payment received. Your booking is confirmed.");
      const url = new URL(window.location.href);
      url.searchParams.delete("booking");
      url.searchParams.delete("session_id");
      window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
    }
  }, [confirmingPayment, state?.booking]);

  async function run(label: string, action: () => Promise<string | void>) {
    setBusy(label);
    setError(null);
    setNotice(null);
    try {
      const message = await action();
      if (message) setNotice(message);
      setPanel("none");
      await onChanged();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Something went wrong. Please try again.");
    } finally {
      setBusy(null);
    }
  }

  async function rpc(name: string, args: Record<string, unknown>) {
    const client = getMarketplaceClient();
    if (!client) throw new Error("Hire Line Dancers is not connected in this build.");
    const { error: rpcError } = await client.rpc(name, args);
    if (rpcError) throw new Error(rpcError.message);
  }

  if (loading && !state) return <section className={styles.bookingPanel} aria-busy="true"><p className={styles.muted}>Loading booking details...</p></section>;
  if (!state) return null;

  const booking = state.booking;
  const role = state.role;
  const compactQuote = role === "organizer" && booking && ["quote_sent", "awaiting_payment"].includes(booking.status);
  const open = booking ? openBookingStatuses.includes(booking.status) : false;
  const canQuote = role === "instructor"
    && state.is_current_assignment
    && ["awaiting_response", "active"].includes(state.thread_status)
    && (!booking || ["quote_sent", "awaiting_payment", "expired", "withdrawn", "declined", "payment_failed", "cancelled", "paid_out"].includes(booking.status));
  const nextStep = nextStepText(state);

  return (
    <section className={`${styles.bookingPanel} ${compactQuote ? styles.organizerQuote : ""}`} aria-label="Booking">
      <header className={styles.bookingHeader}>
        <div>
          <p className={styles.eyebrow}><CalendarCheck aria-hidden="true" size={15} /> Booking</p>
          <h3>{compactQuote ? "Booking agreement" : booking ? `${money(booking.total_cents)} · ${displayDate(booking.event_date)}` : "No quote yet"}</h3>
          {nextStep ? <p className={styles.bookingNext}>{nextStep}</p> : null}
        </div>
        {booking ? <div className={styles.bookingHeaderAside}>{compactQuote ? <><span className={styles.muted}>Total</span><strong className={styles.quoteTotal}>{money(booking.total_cents)}</strong></> : null}<span className={`${styles.status} ${styles[`booking_${booking.status}`] ?? ""}`}>{bookingStatusLabels[booking.status]}</span></div> : null}
      </header>

      {confirmingPayment ? <p className={styles.notice} role="status">Payment received by Stripe. Confirming your booking...</p> : null}
      {notice ? <p className={styles.success} role="status">{notice}</p> : null}
      {error ? <p className={styles.error} role="alert">{error}</p> : null}

      {role === "instructor" && state.payouts_ready === false ? (
        <div className={styles.bookingCallout}>
          <p><strong>Set up payouts to send quotes.</strong> Clients pay through Hire Line Dancers, and your share goes to your bank account {bookingTerms.payoutDelayHours} hours after each event.</p>
          <Link className={styles.secondaryButton} href="/account/?tab=payouts">Set up payouts</Link>
        </div>
      ) : null}

      {booking ? <BookingSummary booking={booking} role={role} showAgreement={showAgreement} onToggleAgreement={() => setShowAgreement((value) => !value)} /> : null}
      {booking?.paid_at && role === "organizer" ? <InstructorLinks threadId={threadId} /> : null}
      {showAgreement && booking && panel !== "review" ? <BookingAgreementReview booking={booking} onClose={() => setShowAgreement(false)} /> : null}

      <div className={styles.buttonRow}>
        {canQuote && state.payouts_ready ? (
          <button className={booking && open ? styles.secondaryButton : styles.button} type="button" disabled={busy !== null} onClick={() => setPanel(panel === "quote" ? "none" : "quote")}>
            <FileSignature aria-hidden="true" size={17} /> {booking && ["quote_sent", "awaiting_payment"].includes(booking.status) ? "Send updated quote" : "Send a quote"}
          </button>
        ) : null}
        {role === "instructor" && booking && ["quote_sent", "awaiting_payment"].includes(booking.status) ? (
          <button className={styles.dangerButton} type="button" disabled={busy !== null} onClick={() => void run("withdraw", async () => {
            if (!window.confirm("Withdraw this quote? The organizer will no longer be able to sign it.")) return;
            await rpc("withdraw_booking_quote", { p_booking_id: booking.id });
            return "Quote withdrawn.";
          })}>{busy === "withdraw" ? "Withdrawing..." : "Withdraw quote"}</button>
        ) : null}
        {role === "organizer" && booking?.status === "quote_sent" ? (
          <>
            <button className={`${styles.button} ${styles.quoteReviewButton}`} type="button" disabled={busy !== null} onClick={() => setPanel("review")}>
              <FileSignature aria-hidden="true" size={17} /> Review, sign, and pay
            </button>
            <button className={styles.dangerButton} type="button" disabled={busy !== null} onClick={() => void run("decline", async () => {
              const reason = window.prompt("Decline this quote? You can add a short reason for the instructor (optional).");
              if (reason === null) return;
              await rpc("decline_booking_quote", { p_booking_id: booking.id, p_reason: reason || null });
              return "Quote declined. The instructor can send a revised quote.";
            })}>{busy === "decline" ? "Declining..." : "Decline quote"}</button>
          </>
        ) : null}
        {role === "organizer" && booking?.status === "awaiting_payment" ? (
          <button className={styles.button} type="button" disabled={busy !== null} onClick={() => void run("pay", async () => {
            const result = await invokeBookingFunction<{ url?: string }>("booking-checkout", { bookingId: booking.id });
            if (result.url) window.location.assign(result.url);
          })}>{busy === "pay" ? "Opening payment..." : `Finish payment of ${money(booking.total_cents)}`}</button>
        ) : null}
        {booking?.can_cancel && role !== "admin" ? (
          <button className={styles.dangerButton} type="button" disabled={busy !== null} onClick={() => setPanel(panel === "cancel" ? "none" : "cancel")}>Cancel booking</button>
        ) : null}
        {role === "organizer" && booking?.problem_report_open ? (
          <button className={styles.secondaryButton} type="button" disabled={busy !== null} onClick={() => setPanel(panel === "problem" ? "none" : "problem")}>Report a problem</button>
        ) : null}
        {role === "admin" && booking?.problem_reported_at && !booking.problem_resolved_at ? (
          <button className={styles.button} type="button" disabled={busy !== null} onClick={() => setPanel(panel === "resolve" ? "none" : "resolve")}>Resolve problem</button>
        ) : null}
        {role === "admin" && booking && booking.status === "confirmed" ? (
          <button className={styles.dangerButton} type="button" disabled={busy !== null} onClick={() => void run("admin-cancel", async () => {
            const reason = window.prompt("Cancel this booking and refund the organizer in full? Enter a reason for the record.");
            if (!reason) return;
            const result = await invokeBookingFunction<{ refundStatus?: string; message?: string }>("booking-cancel", { bookingId: booking.id, reason, asAdmin: true });
            return result.message ?? "Booking cancelled and refunded in full.";
          })}>Cancel and refund</button>
        ) : null}
      </div>

      {panel === "quote" && state.defaults ? (
        <QuoteForm
          defaults={state.defaults}
          previous={booking && ["quote_sent", "awaiting_payment"].includes(booking.status) ? booking : null}
          busy={busy === "quote"}
          onCancel={() => setPanel("none")}
          onSubmit={(quote) => void run("quote", async () => {
            await invokeBookingFunction("booking-quote", { threadId, quote });
            return "Quote sent. The organizer will be notified to review, sign, and pay.";
          })}
        />
      ) : null}

      {panel === "review" && booking ? (
        <BookingAgreementReview
          booking={booking}
          busy={busy === "sign"}
          error={error}
          onClose={() => setPanel("none")}
          onSubmit={(typedName) => void run("sign", async () => {
            const result = await invokeBookingFunction<{ url?: string }>("booking-checkout", {
              bookingId: booking.id,
              typedName,
              agreementSha256: booking.agreement_sha256,
              consent: true
            });
            if (result.url) window.location.assign(result.url);
          })}
        />
      ) : null}

      {panel === "cancel" && booking ? (
        <CancelForm
          booking={booking}
          role={role}
          busy={busy === "cancel"}
          onCancel={() => setPanel("none")}
          onSubmit={(reason) => void run("cancel", async () => {
            const result = await invokeBookingFunction<{ message?: string; refundCents?: number }>("booking-cancel", { bookingId: booking.id, reason });
            return result.message ?? `Booking cancelled.${result.refundCents ? ` ${money(result.refundCents)} is being refunded.` : ""}`;
          })}
        />
      ) : null}

      {panel === "problem" && booking ? (
        <ProblemForm
          busy={busy === "problem"}
          onCancel={() => setPanel("none")}
          onSubmit={(details) => void run("problem", async () => {
            await rpc("report_booking_problem", { p_booking_id: booking.id, p_details: details });
            return "Problem reported. The payout is paused while Hire Line Dancers reviews it.";
          })}
        />
      ) : null}

      {panel === "resolve" && booking ? (
        <ResolveForm
          booking={booking}
          busy={busy === "resolve"}
          onCancel={() => setPanel("none")}
          onSubmit={(refundCents, note) => void run("resolve", async () => {
            await invokeBookingFunction("booking-admin", { action: "resolve_problem", bookingId: booking.id, refundCents, note });
            return refundCents ? `${money(refundCents)} refund issued.` : "Payout released.";
          })}
        />
      ) : null}
    </section>
  );
}

function BookingSummary({
  booking,
  role,
  showAgreement,
  onToggleAgreement
}: {
  booking: Booking;
  role: ThreadBookingState["role"];
  showAgreement: boolean;
  onToggleAgreement: () => void;
}) {
  const compact = role === "organizer" && ["quote_sent", "awaiting_payment"].includes(booking.status);
  const instructorSignature = booking.signatures.find((signature) => signature.party_role === "instructor");
  const organizerSignature = booking.signatures.find((signature) => signature.party_role === "organizer");
  return (
    <div className={styles.bookingSummary}>
      {compact ? <>
        <p className={styles.quoteDescription}>{booking.service_description}</p>
        <p className={styles.quoteWhen}>{displayDate(booking.event_date)}, {displayTime(booking.start_time)} to {displayTime(booking.end_time)} ({booking.time_zone})</p>
        <dl className={styles.quoteFacts}>
          <div><dt>Instructor price</dt><dd>{money(booking.price_cents)}</dd></div>
          <div><dt>Service fee ({clientFeeLabel})</dt><dd>{money(booking.client_fee_cents)}</dd></div>
          <div><dt>Cancellation</dt><dd>{booking.cancellation_policy === "standard" ? "Standard" : "Custom"}</dd></div>
        </dl>
      </> : <dl className={styles.bookingFacts}>
        <div><dt>When</dt><dd>{displayDate(booking.event_date)}, {displayTime(booking.start_time)} to {displayTime(booking.end_time)}</dd></div>
        <div><dt>Where</dt><dd>{booking.venue_name ? `${booking.venue_name}, ` : ""}{booking.venue_address}</dd></div>
        <div><dt>Services</dt><dd>{booking.service_description}</dd></div>
        <div>
          <dt>Price</dt>
          <dd>
            {booking.pricing_mode === "hourly" ? `${money(booking.hourly_rate_cents)}/hour × ${booking.hours} hours` : `Flat ${money(booking.flat_price_cents)}`}
            {booking.travel_fee_cents ? ` + ${money(booking.travel_fee_cents)} travel` : ""} = {money(booking.price_cents)}
          </dd>
        </div>
        {role !== "instructor" ? <div><dt>Service fee ({clientFeeLabel})</dt><dd>{money(booking.client_fee_cents)}</dd></div> : null}
        {role !== "instructor" ? <div><dt>Total</dt><dd><strong>{money(booking.total_cents)}</strong></dd></div> : null}
        {role !== "organizer" && booking.instructor_payout_cents !== undefined ? (
          <div><dt>Instructor receives</dt><dd><strong>{money(booking.payout_cents ?? booking.instructor_payout_cents)}</strong> after the {instructorFeeLabel} platform fee</dd></div>
        ) : null}
        <div><dt>Cancellation</dt><dd>{booking.cancellation_policy === "standard" ? "Standard" : "Custom"}: {cancellationLines(booking.cancellation_windows).join("; ")}</dd></div>
        <div><dt>Insurance</dt><dd>{booking.insurance_choice === "coi_on_file" ? "Instructor carries liability insurance (certificate on request)" : "Instructor handles insurance outside this agreement"}</dd></div>
        {["quote_sent", "awaiting_payment"].includes(booking.status) ? <div><dt>Quote expires</dt><dd>{displayDateTime(booking.expires_at)}</dd></div> : null}
        {booking.paid_at ? <div><dt>Paid</dt><dd>{displayDateTime(booking.paid_at)}{booking.payment_method_type === "us_bank_account" ? " by bank transfer" : ""}</dd></div> : null}
        {booking.paid_at && !booking.paid_out_at && booking.status !== "cancelled" ? <div><dt>Payout</dt><dd>{booking.payout_hold === "problem_reported" ? "Paused while a reported problem is reviewed" : booking.payout_hold === "disputed" ? "Paused while a payment dispute is reviewed" : `Scheduled for ${displayDateTime(booking.payout_due_at)}`}</dd></div> : null}
        {booking.paid_out_at ? <div><dt>Paid out</dt><dd>{displayDateTime(booking.paid_out_at)}</dd></div> : null}
        {booking.refund_cents ? <div><dt>Refund</dt><dd>{money(booking.refund_cents)} ({booking.refund_status === "succeeded" ? "issued" : booking.refund_status === "failed" ? "retrying" : "processing"})</dd></div> : null}
        {booking.problem_details ? <div><dt>Reported problem</dt><dd>{booking.problem_details}</dd></div> : null}
        {booking.close_reason && ["declined", "cancelled"].includes(booking.status) ? <div><dt>Reason</dt><dd>{booking.close_reason}</dd></div> : null}
      </dl>}

      {booking.contacts ? (
        <div className={styles.bookingContacts}>
          <strong><ShieldCheck aria-hidden="true" size={15} /> Contacts for the day of the event</strong>
          <p>Organizer: {[booking.contacts.organizer_name, booking.contacts.organizer_company, booking.contacts.organizer_email, booking.contacts.organizer_phone].filter(Boolean).join(" · ")}</p>
          <p>Instructor: {[booking.contacts.instructor_name, booking.contacts.instructor_business, booking.contacts.instructor_email, booking.contacts.instructor_phone].filter(Boolean).join(" · ")}</p>
        </div>
      ) : null}

      <p className={styles.help}>
        {instructorSignature ? `Signed by the instructor (${instructorSignature.typed_name}) on ${displayDateTime(instructorSignature.signed_at)}. ` : ""}
        {organizerSignature ? `Signed by the organizer (${organizerSignature.typed_name}) on ${displayDateTime(organizerSignature.signed_at)}. ` : ""}
        {!booking.paid_at && organizerSignature ? "The agreement takes effect when payment succeeds." : ""}
      </p>
      <button className={styles.linkButton} type="button" onClick={onToggleAgreement}>{showAgreement ? "Hide the full agreement" : "Read the full agreement"}</button>
    </div>
  );
}

function toCents(value: string): number | null {
  if (!value.trim()) return null;
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number * 100) : NaN;
}

function QuoteForm({
  defaults,
  previous,
  busy,
  onCancel,
  onSubmit
}: {
  defaults: BookingDefaults;
  previous: Booking | null;
  busy: boolean;
  onCancel: () => void;
  onSubmit: (quote: Record<string, unknown>) => void;
}) {
  const initialPolicy = previous?.cancellation_policy ?? defaults.cancellation_policy;
  const initialWindows = previous?.cancellation_policy === "custom"
    ? previous.cancellation_windows
    : defaults.custom_cancellation_windows ?? [{ minDaysBeforeEvent: 14, refundPercent: 100 }];
  const [form, setForm] = useState({
    eventDate: previous?.event_date ?? defaults.event_date ?? "",
    startTime: (previous?.start_time ?? defaults.start_time ?? "18:00").slice(0, 5),
    endTime: (previous?.end_time ?? "").slice(0, 5),
    timeZone: previous?.time_zone ?? defaults.time_zone,
    venueName: previous?.venue_name ?? defaults.venue_name ?? "",
    venueAddress: previous?.venue_address ?? [defaults.event_city, defaults.event_region].filter(Boolean).join(", "),
    serviceDescription: previous?.service_description ?? "",
    pricingMode: previous?.pricing_mode ?? "hourly",
    hourlyRate: previous?.hourly_rate_cents ? String(previous.hourly_rate_cents / 100) : defaults.hourly_rate_cents ? String(defaults.hourly_rate_cents / 100) : "",
    hours: previous?.hours ? String(previous.hours) : defaults.minimum_hours ? String(defaults.minimum_hours) : "2",
    flatPrice: previous?.flat_price_cents ? String(previous.flat_price_cents / 100) : "",
    travelFee: previous?.travel_fee_cents ? String(previous.travel_fee_cents / 100) : "",
    providesSpeakers: previous?.provides_speakers ?? defaults.provides_speakers,
    providesMicrophone: previous?.provides_microphone ?? defaults.provides_microphone,
    cancellationPolicy: initialPolicy,
    insuranceChoice: previous?.insurance_choice ?? (defaults.liability_insurance_status === "available" ? "coi_on_file" : "instructor_handles_outside_agreement"),
    signatureName: "",
    agreed: false
  });
  const [windows, setWindows] = useState<CancellationWindow[]>(initialWindows);
  const [formError, setFormError] = useState<string | null>(null);
  const [packages, setPackages] = useState<ProfilePackage[]>([]);

  useEffect(() => {
    let active = true;
    async function loadPackages() {
      const client = getMarketplaceClient();
      if (!client) return;
      const { data: sessionData } = await client.auth.getSession();
      const accountId = sessionData.session?.user.id;
      if (!accountId) return;
      const { data } = await client.from("instructor_profiles").select("packages").eq("account_id", accountId).maybeSingle();
      if (active) setPackages(((data as { packages?: ProfilePackage[] } | null)?.packages) ?? []);
    }
    void loadPackages();
    return () => { active = false; };
  }, []);

  function applyPackage(name: string) {
    const chosen = packages.find((item) => item.name === name);
    if (!chosen) return;
    setForm((current) => ({
      ...current,
      serviceDescription: [chosen.name, chosen.description].filter(Boolean).join(": "),
      ...(chosen.priceCents
        ? { pricingMode: "flat" as const, flatPrice: String(chosen.priceCents / 100) }
        : chosen.durationHours
          ? { pricingMode: "hourly" as const, hours: String(chosen.durationHours), endTime: "" }
          : {})
    }));
  }

  useEffect(() => {
    if (form.endTime || !form.startTime || !form.hours || form.pricingMode !== "hourly") return;
    const [hour, minute] = form.startTime.split(":").map(Number);
    const total = hour * 60 + minute + Math.round(Number(form.hours) * 60);
    if (!Number.isFinite(total)) return;
    const end = `${String(Math.floor(total / 60) % 24).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
    setForm((current) => current.endTime ? current : { ...current, endTime: end });
  }, [form.endTime, form.hours, form.pricingMode, form.startTime]);

  const priceCents = useMemo(() => {
    const travel = toCents(form.travelFee) ?? 0;
    if (form.pricingMode === "hourly") {
      const rate = toCents(form.hourlyRate);
      const hours = Number(form.hours);
      if (!rate || !Number.isFinite(hours)) return null;
      return Math.round(rate * hours) + travel;
    }
    const flat = toCents(form.flatPrice);
    return flat ? flat + travel : null;
  }, [form.flatPrice, form.hourlyRate, form.hours, form.pricingMode, form.travelFee]);
  const amounts = priceCents && Number.isFinite(priceCents) ? previewAmounts(priceCents) : null;

  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    if (!form.agreed) return setFormError("Confirm that you agree to the booking agreement and the Instructor Terms.");
    if (form.cancellationPolicy === "custom" && !validCancellationWindows(windows)) {
      return setFormError("Custom cancellation windows must run from the earliest cancellation to the latest, and refunds can only stay the same or go down.");
    }
    if (!amounts) return setFormError("Enter a price.");
    if (amounts.priceCents < bookingTerms.minimumPriceCents) return setFormError(`The booking price must be at least ${money(bookingTerms.minimumPriceCents)}.`);
    onSubmit({
      eventDate: form.eventDate,
      startTime: form.startTime,
      endTime: form.endTime,
      timeZone: form.timeZone,
      venueName: form.venueName,
      venueAddress: form.venueAddress,
      serviceDescription: form.serviceDescription,
      pricingMode: form.pricingMode,
      hourlyRateCents: form.pricingMode === "hourly" ? toCents(form.hourlyRate) : null,
      hours: form.pricingMode === "hourly" ? Number(form.hours) : null,
      flatPriceCents: form.pricingMode === "flat" ? toCents(form.flatPrice) : null,
      travelFeeCents: toCents(form.travelFee) ?? 0,
      providesSpeakers: form.providesSpeakers,
      providesMicrophone: form.providesMicrophone,
      cancellationPolicy: form.cancellationPolicy,
      cancellationWindows: form.cancellationPolicy === "custom" ? windows : undefined,
      insuranceChoice: form.insuranceChoice,
      signatureName: form.signatureName
    });
  }

  const zoneKnown = timeZones.some(([zone]) => zone === form.timeZone);

  return (
    <form className={styles.bookingForm} onSubmit={submit}>
      <h4>{previous ? "Send an updated quote" : "Send a quote"}</h4>
      <p className={styles.help}>This becomes the booking agreement. You sign it when you send it, and the organizer signs and pays in full to confirm. {previous ? "Sending an update withdraws the current quote." : ""}</p>
      <div className={styles.bookingFormGrid}>
        <label className={styles.field}><span>Event date</span><input required type="date" value={form.eventDate} onChange={(event) => set("eventDate", event.target.value)} /></label>
        <label className={styles.field}><span>Time zone</span>
          <select value={form.timeZone} onChange={(event) => set("timeZone", event.target.value)}>
            {!zoneKnown ? <option value={form.timeZone}>{form.timeZone}</option> : null}
            {timeZones.map(([zone, label]) => <option key={zone} value={zone}>{label}</option>)}
          </select>
        </label>
        <label className={styles.field}><span>Start time</span><input required type="time" value={form.startTime} onChange={(event) => set("startTime", event.target.value)} /></label>
        <label className={styles.field}><span>End time</span><input required type="time" value={form.endTime} onChange={(event) => set("endTime", event.target.value)} /></label>
        <label className={styles.field}><span>Venue name (optional)</span><input maxLength={200} value={form.venueName} onChange={(event) => set("venueName", event.target.value)} /></label>
        <label className={styles.field}><span>Venue address</span><input required minLength={3} maxLength={300} value={form.venueAddress} onChange={(event) => set("venueAddress", event.target.value)} /></label>
      </div>
      {packages.length ? (
        <label className={styles.field}>
          <span>Start from a package (optional)</span>
          <select defaultValue="" onChange={(event) => applyPackage(event.target.value)}>
            <option value="">Choose a package</option>
            {packages.map((item) => <option key={item.name} value={item.name}>{item.name}</option>)}
          </select>
        </label>
      ) : null}
      <label className={styles.field}><span>What you will provide</span><textarea required minLength={3} maxLength={2000} value={form.serviceDescription} onChange={(event) => set("serviceDescription", event.target.value)} placeholder="For example: two hours of beginner line dance instruction, four dances, all ages." /></label>

      <fieldset className={styles.bookingFieldset}>
        <legend className={styles.legend}>Price</legend>
        <div className={styles.buttonRow}>
          <label className={styles.check}><input type="radio" checked={form.pricingMode === "hourly"} onChange={() => set("pricingMode", "hourly")} /> Hourly</label>
          <label className={styles.check}><input type="radio" checked={form.pricingMode === "flat"} onChange={() => set("pricingMode", "flat")} /> Flat price</label>
        </div>
        <div className={styles.bookingFormGrid}>
          {form.pricingMode === "hourly" ? (
            <>
              <label className={styles.field}><span>Hourly rate ($)</span><input required type="number" min="10" max="5000" step="0.01" value={form.hourlyRate} onChange={(event) => set("hourlyRate", event.target.value)} /></label>
              <label className={styles.field}><span>Hours</span><input required type="number" min={defaults.minimum_hours ?? 0.5} max="24" step="0.25" value={form.hours} onChange={(event) => set("hours", event.target.value)} /></label>
            </>
          ) : (
            <label className={styles.field}><span>Flat price ($)</span><input required type="number" min="10" max="10000" step="0.01" value={form.flatPrice} onChange={(event) => set("flatPrice", event.target.value)} /></label>
          )}
          <label className={styles.field}><span>Travel fee ($, optional)</span><input type="number" min="0" max="2000" step="0.01" value={form.travelFee} onChange={(event) => set("travelFee", event.target.value)} /></label>
        </div>
        {defaults.minimum_hours && form.pricingMode === "hourly" && Number(form.hours) < defaults.minimum_hours ? (
          <p className={styles.help}>This is below your usual {defaults.minimum_hours}-hour minimum.</p>
        ) : null}
      </fieldset>

      <fieldset className={styles.bookingFieldset}>
        <legend className={styles.legend}>Equipment</legend>
        <label className={styles.check}><input type="checkbox" checked={form.providesSpeakers} onChange={(event) => set("providesSpeakers", event.target.checked)} /> I will bring speakers</label>
        <label className={styles.check}><input type="checkbox" checked={form.providesMicrophone} onChange={(event) => set("providesMicrophone", event.target.checked)} /> I will bring a microphone</label>
      </fieldset>

      <fieldset className={styles.bookingFieldset}>
        <legend className={styles.legend}>Cancellation policy</legend>
        <label className={styles.check}><input type="radio" checked={form.cancellationPolicy === "standard"} onChange={() => set("cancellationPolicy", "standard")} /> Standard: {cancellationLines(defaults.standard_cancellation_windows).join("; ")}</label>
        <label className={styles.check}><input type="radio" checked={form.cancellationPolicy === "custom"} onChange={() => set("cancellationPolicy", "custom")} /> Custom</label>
        {form.cancellationPolicy === "custom" ? <WindowsEditor windows={windows} onChange={setWindows} /> : null}
        <p className={styles.help}>If you cancel, the organizer always gets a full refund.</p>
      </fieldset>

      <fieldset className={styles.bookingFieldset}>
        <legend className={styles.legend}>Insurance</legend>
        <label className={styles.check}><input type="radio" checked={form.insuranceChoice === "coi_on_file"} onChange={() => set("insuranceChoice", "coi_on_file")} /> I carry liability insurance and will share a certificate on request</label>
        <label className={styles.check}><input type="radio" checked={form.insuranceChoice === "instructor_handles_outside_agreement"} onChange={() => set("insuranceChoice", "instructor_handles_outside_agreement")} /> I will handle insurance outside this agreement</label>
      </fieldset>

      <label className={styles.field}><span>Type your full name to sign</span><input required minLength={2} maxLength={120} autoComplete="name" value={form.signatureName} onChange={(event) => set("signatureName", event.target.value)} /></label>
      <label className={styles.check}><input type="checkbox" checked={form.agreed} onChange={(event) => set("agreed", event.target.checked)} /> <span>I agree to this booking agreement and the <a href="/legal/terms/" target="_blank" rel="noreferrer">Instructor Terms</a>, and I am signing electronically.</span></label>
      {formError ? <p className={styles.error} role="alert">{formError}</p> : null}
      <div className={styles.buttonRow}>
        <button className={styles.button} type="submit" disabled={busy}>{busy ? "Sending..." : "Sign and send quote"}</button>
        <button className={styles.secondaryButton} type="button" onClick={onCancel} disabled={busy}>Cancel</button>
      </div>
    </form>
  );
}

export function WindowsEditor({ windows, onChange }: { windows: CancellationWindow[]; onChange: (windows: CancellationWindow[]) => void }) {
  function update(index: number, key: keyof CancellationWindow, value: string) {
    onChange(windows.map((window, position) => position === index ? { ...window, [key]: Number(value) } : window));
  }
  return (
    <div className={styles.windowsEditor}>
      {windows.map((window, index) => (
        <div className={styles.windowRow} key={index}>
          <label className={styles.field}><span>Refund %</span><input type="number" min="0" max="100" step="1" value={window.refundPercent} onChange={(event) => update(index, "refundPercent", event.target.value)} /></label>
          <label className={styles.field}><span>If cancelled at least this many days before</span><input type="number" min="0" max="365" step="1" value={window.minDaysBeforeEvent} onChange={(event) => update(index, "minDaysBeforeEvent", event.target.value)} /></label>
          {windows.length > 1 ? <button className={styles.secondaryButton} type="button" onClick={() => onChange(windows.filter((_, position) => position !== index))}>Remove</button> : null}
        </div>
      ))}
      {windows.length < 3 ? (
        <button className={styles.secondaryButton} type="button" onClick={() => {
          const last = windows.at(-1);
          onChange([...windows, { minDaysBeforeEvent: Math.max(0, (last?.minDaysBeforeEvent ?? 14) - 7), refundPercent: Math.max(0, (last?.refundPercent ?? 100) - 50) }]);
        }}>Add a window</button>
      ) : null}
      <p className={styles.help}>{validCancellationWindows(windows) ? `Preview: ${cancellationLines(windows).join("; ")}.` : "List windows from the earliest cancellation to the latest. Refunds can stay the same or go down, never up."}</p>
    </div>
  );
}

function CancelForm({ booking, role, busy, onCancel, onSubmit }: { booking: Booking; role: ThreadBookingState["role"]; busy: boolean; onCancel: () => void; onSubmit: (reason: string) => void }) {
  const [reason, setReason] = useState("");
  const preview = booking.cancellation_preview;
  return (
    <form className={styles.bookingForm} onSubmit={(event) => { event.preventDefault(); onSubmit(reason); }}>
      <h4>Cancel this booking</h4>
      {role === "organizer" && preview ? (
        <p>Under the {booking.cancellation_policy === "standard" ? "Standard" : "custom"} policy, cancelling now refunds <strong>{money(preview.refund_cents)}</strong> ({preview.refund_percent}% of the instructor price). The {money(booking.client_fee_cents)} service fee is not refunded.</p>
      ) : null}
      {role === "instructor" ? (
        <p>The organizer receives a full refund of {money(booking.total_cents)}, and you will not be paid for this booking. Hire Line Dancers may charge a cancellation fee equal to the platform fee unless it was an emergency.</p>
      ) : null}
      <label className={styles.field}><span>Reason (shared in the conversation)</span><textarea maxLength={2000} value={reason} onChange={(event) => setReason(event.target.value)} /></label>
      <div className={styles.buttonRow}>
        <button className={styles.dangerButton} type="submit" disabled={busy}>{busy ? "Cancelling..." : "Cancel booking"}</button>
        <button className={styles.secondaryButton} type="button" onClick={onCancel} disabled={busy}>Keep booking</button>
      </div>
    </form>
  );
}

function ProblemForm({ busy, onCancel, onSubmit }: { busy: boolean; onCancel: () => void; onSubmit: (details: string) => void }) {
  const [details, setDetails] = useState("");
  return (
    <form className={styles.bookingForm} onSubmit={(event) => { event.preventDefault(); onSubmit(details); }}>
      <h4>Report a problem</h4>
      <p className={styles.help}>Tell us what happened, such as a no-show or a major issue. The payout pauses while Hire Line Dancers reviews messages and evidence from both of you.</p>
      <label className={styles.field}><span>What went wrong</span><textarea required maxLength={4000} value={details} onChange={(event) => setDetails(event.target.value)} /></label>
      <div className={styles.buttonRow}>
        <button className={styles.button} type="submit" disabled={busy || !details.trim()}>{busy ? "Reporting..." : "Report problem"}</button>
        <button className={styles.secondaryButton} type="button" onClick={onCancel} disabled={busy}>Cancel</button>
      </div>
    </form>
  );
}

function ResolveForm({ booking, busy, onCancel, onSubmit }: { booking: Booking; busy: boolean; onCancel: () => void; onSubmit: (refundCents: number, note: string) => void }) {
  const [refund, setRefund] = useState("0");
  const [note, setNote] = useState("");
  const refundCents = Math.round(Number(refund || "0") * 100);
  const valid = Number.isFinite(refundCents) && refundCents >= 0 && refundCents <= booking.price_cents;
  return (
    <form className={styles.bookingForm} onSubmit={(event) => { event.preventDefault(); if (valid) onSubmit(refundCents, note); }}>
      <h4>Resolve the reported problem</h4>
      <p className={styles.help}>Enter 0 to release the payout. A refund comes out of the {money(booking.price_cents)} instructor price; refunding all of it also refunds the service fee and cancels the booking.</p>
      <label className={styles.field}><span>Refund to organizer ($)</span><input type="number" min="0" max={booking.price_cents / 100} step="0.01" value={refund} onChange={(event) => setRefund(event.target.value)} /></label>
      <label className={styles.field}><span>Internal note</span><textarea maxLength={2000} value={note} onChange={(event) => setNote(event.target.value)} /></label>
      <div className={styles.buttonRow}>
        <button className={styles.button} type="submit" disabled={busy || !valid}>{busy ? "Saving..." : refundCents ? `Refund ${money(refundCents)}` : "Release payout"}</button>
        <button className={styles.secondaryButton} type="button" onClick={onCancel} disabled={busy}>Cancel</button>
      </div>
    </form>
  );
}

function InstructorLinks({ threadId }: { threadId: string }) {
  const [links, setLinks] = useState<InstructorSocialLinks | null>(null);
  useEffect(() => {
    let active = true;
    async function load() {
      const client = getMarketplaceClient();
      if (!client) return;
      const { data } = await client.rpc("get_thread_instructor_links", { p_thread_id: threadId });
      if (active) setLinks((data as InstructorSocialLinks | null) ?? null);
    }
    void load();
    return () => { active = false; };
  }, [threadId]);
  const candidates: Array<[string, string | undefined]> = links
    ? [["Instagram", links.instagram], ["TikTok", links.tiktok], ["YouTube", links.youtube], ["Website", links.website]]
    : [];
  const entries = candidates.filter((entry): entry is [string, string] => Boolean(entry[1]));
  if (!entries.length) return null;
  return (
    <p className={styles.help}>
      Follow your instructor:{" "}
      {entries.map(([label, url], index) => (
        <span key={label}>{index ? " · " : ""}<a href={url} target="_blank" rel="noopener noreferrer">{label}</a></span>
      ))}
    </p>
  );
}
