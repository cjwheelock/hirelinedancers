import terms from "../../config/commercial-terms.json";
import { getMarketplaceClient, readableError } from "@/lib/marketplace";

export const bookingTerms = terms.bookings;

export type CancellationWindow = {
  minDaysBeforeEvent: number;
  refundPercent: number;
};

export type BookingStatus =
  | "quote_sent"
  | "awaiting_payment"
  | "payment_processing"
  | "confirmed"
  | "completed"
  | "paid_out"
  | "expired"
  | "withdrawn"
  | "declined"
  | "payment_failed"
  | "cancelled";

export type BookingRole = "organizer" | "instructor" | "admin";

export type Booking = {
  id: string;
  thread_id: string;
  status: BookingStatus;
  version: number;
  event_date: string;
  start_time: string;
  end_time: string;
  time_zone: string;
  event_starts_at: string;
  event_ends_at: string;
  venue_name: string | null;
  venue_address: string;
  service_description: string;
  pricing_mode: "hourly" | "flat";
  hourly_rate_cents: number | null;
  hours: number | null;
  flat_price_cents: number | null;
  travel_fee_cents: number;
  provides_speakers: boolean;
  provides_microphone: boolean;
  cancellation_policy: "standard" | "custom";
  cancellation_windows: CancellationWindow[];
  insurance_choice: "coi_on_file" | "instructor_handles_outside_agreement";
  price_cents: number;
  client_fee_cents: number;
  total_cents: number;
  platform_fee_cents?: number;
  instructor_payout_cents?: number;
  payout_cents?: number | null;
  agreement_version: string;
  agreement_text: string;
  agreement_sha256: string;
  expires_at: string;
  payment_method_type: string | null;
  paid_at: string | null;
  payment_failed_at: string | null;
  payout_due_at: string;
  paid_out_at: string | null;
  closed_at: string | null;
  close_reason: string | null;
  cancelled_by_role: string | null;
  refund_cents: number | null;
  refund_status: string | null;
  problem_reported_at: string | null;
  problem_details: string | null;
  problem_resolved_at: string | null;
  problem_resolution: string | null;
  disputed_at: string | null;
  signatures: Array<{ party_role: "instructor" | "organizer"; typed_name: string; signed_at: string }>;
  payout_hold: "disputed" | "problem_reported" | null;
  cancellation_summary: string;
  problem_report_open: boolean;
  can_cancel: boolean;
  cancellation_preview?: {
    refund_cents: number;
    refund_percent: number;
    instructor_payout_cents: number;
    days_before_event: number;
  };
  contacts?: {
    organizer_name: string | null;
    organizer_email: string | null;
    organizer_phone: string | null;
    organizer_company: string | null;
    instructor_name: string | null;
    instructor_business: string | null;
    instructor_email: string | null;
    instructor_phone: string | null;
  };
};

export type BookingDefaults = {
  hourly_rate_cents: number | null;
  minimum_hours: number | null;
  cancellation_policy: "standard" | "custom";
  custom_cancellation_windows: CancellationWindow[] | null;
  standard_cancellation_windows: CancellationWindow[];
  liability_insurance_status: string;
  provides_speakers: boolean;
  provides_microphone: boolean;
  event_date: string | null;
  start_time: string | null;
  time_zone: string;
  venue_name: string | null;
  event_city: string | null;
  event_region: string | null;
};

export type ThreadBookingState = {
  role: BookingRole;
  thread_status: string;
  is_current_assignment: boolean;
  booking: Booking | null;
  booking_count: number;
  payouts_ready: boolean | null;
  defaults: BookingDefaults | null;
};

export const openBookingStatuses: BookingStatus[] = [
  "quote_sent",
  "awaiting_payment",
  "payment_processing",
  "confirmed",
  "completed"
];

export const paidBookingStatuses: BookingStatus[] = ["payment_processing", "confirmed", "completed", "paid_out"];

export const bookingStatusLabels: Record<BookingStatus, string> = {
  quote_sent: "Quote sent",
  awaiting_payment: "Awaiting payment",
  payment_processing: "Payment clearing",
  confirmed: "Confirmed",
  completed: "Completed",
  paid_out: "Paid out",
  expired: "Quote expired",
  withdrawn: "Quote withdrawn",
  declined: "Quote declined",
  payment_failed: "Payment failed",
  cancelled: "Cancelled"
};

export function money(cents: number | null | undefined): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2
  }).format((cents ?? 0) / 100);
}

export function percentLabel(bps: number): string {
  return `${bps / 100}%`;
}

export const instructorFeeLabel = percentLabel(bookingTerms.instructorFeeBps);
export const clientFeeLabel = percentLabel(bookingTerms.clientFeeBps);

export function feeCents(amount: number, bps: number): number {
  return Math.round((amount * bps) / 10000);
}

export function previewAmounts(priceCents: number) {
  const clientFeeCents = feeCents(priceCents, bookingTerms.clientFeeBps);
  const platformFeeCents = feeCents(priceCents, bookingTerms.instructorFeeBps);
  return {
    priceCents,
    clientFeeCents,
    totalCents: priceCents + clientFeeCents,
    platformFeeCents,
    instructorPayoutCents: priceCents - platformFeeCents
  };
}

export function displayTime(value: string | null | undefined): string {
  if (!value) return "";
  const [hourText, minute] = value.split(":");
  const hour = Number(hourText);
  if (!Number.isFinite(hour) || minute === undefined) return value;
  return `${hour % 12 === 0 ? 12 : hour % 12}:${minute.slice(0, 2)} ${hour >= 12 ? "PM" : "AM"}`;
}

export function displayDate(value: string | null | undefined): string {
  if (!value) return "";
  const date = new Date(value.length === 10 ? `${value}T12:00:00Z` : value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: value.length === 10 ? "UTC" : undefined }).format(date);
}

export function displayDateTime(value: string | null | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

export function cancellationLines(windows: CancellationWindow[]): string[] {
  const lines = windows.map((window) =>
    window.minDaysBeforeEvent === 0
      ? `${window.refundPercent}% refund if cancelled before the event starts`
      : `${window.refundPercent}% refund if cancelled ${window.minDaysBeforeEvent}+ days before`
  );
  const last = windows.at(-1);
  if (last && last.minDaysBeforeEvent > 0) lines.push(`No refund within ${last.minDaysBeforeEvent} days of the event`);
  return lines;
}

export function validCancellationWindows(windows: CancellationWindow[]): boolean {
  if (windows.length < 1 || windows.length > 3) return false;
  return windows.every((window, index) => {
    const previous = windows[index - 1];
    return Number.isInteger(window.minDaysBeforeEvent)
      && window.minDaysBeforeEvent >= 0
      && window.minDaysBeforeEvent <= 365
      && Number.isInteger(window.refundPercent)
      && window.refundPercent >= 0
      && window.refundPercent <= 100
      && (!previous || (window.minDaysBeforeEvent < previous.minDaysBeforeEvent && window.refundPercent <= previous.refundPercent));
  });
}

export async function bookingFunctionError(error: unknown): Promise<string> {
  if (error && typeof error === "object" && "context" in error) {
    const context = (error as { context?: unknown }).context;
    if (context instanceof Response) {
      const payload = await context.clone().json().catch(() => null) as { error?: unknown } | null;
      if (typeof payload?.error === "string") return payload.error;
    }
  }
  return readableError(error);
}

export async function invokeBookingFunction<T = Record<string, unknown>>(name: string, body: Record<string, unknown>): Promise<T> {
  const client = getMarketplaceClient();
  if (!client) throw new Error("Hire Line Dancers is not connected in this build.");
  const { data, error } = await client.functions.invoke(name, { body });
  if (error) throw new Error(await bookingFunctionError(error));
  return data as T;
}

export function nextStepText(state: ThreadBookingState): string | null {
  const booking = state.booking;
  if (!booking) {
    if (state.role === "instructor") {
      return state.payouts_ready ? "Next: send a quote when you are ready." : "Next: finish payout setup so you can send a quote.";
    }
    if (state.role === "organizer") return "Next: the instructor sends a quote here when you have agreed on the details.";
    return null;
  }
  const mine = (role: BookingRole) => state.role === role;
  switch (booking.status) {
    case "quote_sent":
      return mine("organizer") ? "Next: review, sign, and pay to confirm." : "Next: the organizer reviews, signs, and pays.";
    case "awaiting_payment":
      return mine("organizer") ? "Next: finish payment to confirm the booking." : "Next: the organizer finishes payment.";
    case "payment_processing":
      return "Next: nobody needs to act. The bank payment is clearing.";
    case "confirmed":
      return "Next: nobody needs to act until the event.";
    case "completed":
      if (booking.payout_hold === "problem_reported") return "Next: Hire Line Dancers reviews the reported problem.";
      return mine("organizer") && booking.problem_report_open
        ? "Next: report a problem only if something went wrong."
        : "Next: the payout is sent automatically.";
    case "paid_out":
      return "This booking is complete.";
    case "expired":
    case "withdrawn":
    case "declined":
    case "payment_failed":
      return mine("instructor") ? "Next: send a new quote if you are still available." : "Next: the instructor can send a new quote.";
    case "cancelled":
      return "This booking was cancelled.";
  }
}
