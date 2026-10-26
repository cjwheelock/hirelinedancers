// Shared booking rules for the booking Edge Functions. Amounts computed here
// are re-checked by constraints on public.bookings, so a bug in either place
// fails closed instead of charging the wrong amount.
import {
  BOOKING_AGREEMENT_VERSION,
  BOOKING_TERMS,
} from "./hld-commercial-terms.ts";

export { BOOKING_AGREEMENT_VERSION, BOOKING_TERMS };

export type CancellationWindow = {
  minDaysBeforeEvent: number;
  refundPercent: number;
};

export type InsuranceChoice =
  | "coi_on_file"
  | "instructor_handles_outside_agreement";

export type QuoteInput = {
  eventDate: string;
  startTime: string;
  endTime: string;
  timeZone: string;
  venueName: string | null;
  venueAddress: string;
  serviceDescription: string;
  pricingMode: "hourly" | "flat";
  hourlyRateCents: number | null;
  hours: number | null;
  flatPriceCents: number | null;
  travelFeeCents: number;
  providesSpeakers: boolean;
  providesMicrophone: boolean;
  cancellationPolicy: "standard" | "custom";
  cancellationWindows: CancellationWindow[];
  insuranceChoice: InsuranceChoice;
  signatureName: string;
};

export type QuoteAmounts = {
  instructorFeeBps: number;
  clientFeeBps: number;
  priceCents: number;
  clientFeeCents: number;
  totalCents: number;
  platformFeeCents: number;
  instructorPayoutCents: number;
};

export class BookingInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BookingInputError";
  }
}

export const STANDARD_CANCELLATION_WINDOWS: CancellationWindow[] = BOOKING_TERMS
  .standardCancellationWindows.map((window) => ({
    minDaysBeforeEvent: window.minDaysBeforeEvent,
    refundPercent: window.refundPercent,
  }));

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function validUuid(value: unknown): string | null {
  return typeof value === "string" && UUID_PATTERN.test(value) ? value : null;
}

function text(value: unknown, label: string, min: number, max: number): string {
  if (typeof value !== "string") throw new BookingInputError(`${label} is required`);
  const trimmed = value.trim();
  if (trimmed.length < min) throw new BookingInputError(`${label} is required`);
  if (trimmed.length > max) {
    throw new BookingInputError(`${label} must be ${max.toLocaleString("en-US")} characters or fewer`);
  }
  return trimmed;
}

function optionalText(value: unknown, label: string, max: number): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") throw new BookingInputError(`${label} is invalid`);
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > max) {
    throw new BookingInputError(`${label} must be ${max.toLocaleString("en-US")} characters or fewer`);
  }
  return trimmed;
}

function cents(value: unknown, label: string, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
    throw new BookingInputError(
      `${label} must be between ${money(min)} and ${money(max)}`,
    );
  }
  return value;
}

export function validTimeZone(value: string): boolean {
  if (!/^[A-Za-z_]+(?:\/[A-Za-z0-9_+-]+)*$/.test(value) || value.length > 64) {
    return false;
  }
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export function validCancellationWindows(value: unknown): value is CancellationWindow[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 3) return false;
  let previous: CancellationWindow | null = null;
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return false;
    const keys = Object.keys(item);
    if (keys.length !== 2) return false;
    const { minDaysBeforeEvent, refundPercent } = item as Record<string, unknown>;
    if (
      typeof minDaysBeforeEvent !== "number" || !Number.isInteger(minDaysBeforeEvent) ||
      minDaysBeforeEvent < 0 || minDaysBeforeEvent > 365 ||
      typeof refundPercent !== "number" || !Number.isInteger(refundPercent) ||
      refundPercent < 0 || refundPercent > 100
    ) {
      return false;
    }
    if (
      previous &&
      (minDaysBeforeEvent >= previous.minDaysBeforeEvent ||
        refundPercent > previous.refundPercent)
    ) {
      return false;
    }
    previous = { minDaysBeforeEvent, refundPercent };
  }
  return true;
}

export function parseQuoteInput(raw: unknown): QuoteInput {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new BookingInputError("Quote details are required");
  }
  const body = raw as Record<string, unknown>;

  const eventDate = text(body.eventDate, "Event date", 10, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(eventDate) || Number.isNaN(Date.parse(`${eventDate}T12:00:00Z`))) {
    throw new BookingInputError("Event date is invalid");
  }
  const startTime = text(body.startTime, "Start time", 5, 8);
  const endTime = text(body.endTime, "End time", 5, 8);
  for (const [label, value] of [["Start time", startTime], ["End time", endTime]]) {
    if (!/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(value)) {
      throw new BookingInputError(`${label} is invalid`);
    }
  }
  if (startTime.slice(0, 5) === endTime.slice(0, 5)) {
    throw new BookingInputError("The end time must differ from the start time");
  }
  const timeZone = text(body.timeZone, "Time zone", 1, 64);
  if (!validTimeZone(timeZone)) throw new BookingInputError("Time zone is invalid");

  const pricingMode = body.pricingMode === "flat" ? "flat" : body.pricingMode === "hourly" ? "hourly" : null;
  if (!pricingMode) throw new BookingInputError("Choose hourly or flat pricing");

  let hourlyRateCents: number | null = null;
  let hours: number | null = null;
  let flatPriceCents: number | null = null;
  if (pricingMode === "hourly") {
    hourlyRateCents = cents(body.hourlyRateCents, "Hourly rate", 1000, 500000);
    if (
      typeof body.hours !== "number" || !Number.isFinite(body.hours) ||
      body.hours < 0.5 || body.hours > 24 || Math.round(body.hours * 4) !== body.hours * 4
    ) {
      throw new BookingInputError("Hours must be between 0.5 and 24 in quarter-hour steps");
    }
    hours = body.hours;
  } else {
    flatPriceCents = cents(body.flatPriceCents, "Flat price", 1000, BOOKING_TERMS.maximumPriceCents);
  }
  const travelFeeCents = body.travelFeeCents === undefined || body.travelFeeCents === null
    ? 0
    : cents(body.travelFeeCents, "Travel fee", 0, 200000);

  const cancellationPolicy = body.cancellationPolicy === "custom"
    ? "custom"
    : body.cancellationPolicy === "standard"
    ? "standard"
    : null;
  if (!cancellationPolicy) throw new BookingInputError("Choose a cancellation policy");
  let cancellationWindows = STANDARD_CANCELLATION_WINDOWS;
  if (cancellationPolicy === "custom") {
    if (!validCancellationWindows(body.cancellationWindows)) {
      throw new BookingInputError(
        "A custom cancellation policy needs one to three windows, from the earliest cancellation to the latest, with refunds that never increase",
      );
    }
    cancellationWindows = body.cancellationWindows.map((window) => ({
      minDaysBeforeEvent: window.minDaysBeforeEvent,
      refundPercent: window.refundPercent,
    }));
  }

  const insuranceChoice = body.insuranceChoice === "coi_on_file"
    ? "coi_on_file"
    : body.insuranceChoice === "instructor_handles_outside_agreement"
    ? "instructor_handles_outside_agreement"
    : null;
  if (!insuranceChoice) throw new BookingInputError("Choose how insurance is handled");

  return {
    eventDate,
    startTime: startTime.slice(0, 5),
    endTime: endTime.slice(0, 5),
    timeZone,
    venueName: optionalText(body.venueName, "Venue name", 200),
    venueAddress: text(body.venueAddress, "Venue address", 3, 300),
    serviceDescription: text(body.serviceDescription, "Service description", 3, 2000),
    pricingMode,
    hourlyRateCents,
    hours,
    flatPriceCents,
    travelFeeCents,
    providesSpeakers: body.providesSpeakers === true,
    providesMicrophone: body.providesMicrophone === true,
    cancellationPolicy,
    cancellationWindows,
    insuranceChoice,
    signatureName: text(body.signatureName, "Your typed signature", 2, 120),
  };
}

function feeCents(amount: number, bps: number): number {
  // Matches PostgreSQL round(numeric), which rounds half away from zero.
  return Math.round((amount * bps) / 10000);
}

export function quoteAmounts(input: Pick<QuoteInput, "pricingMode" | "hourlyRateCents" | "hours" | "flatPriceCents" | "travelFeeCents">): QuoteAmounts {
  const base = input.pricingMode === "hourly"
    ? Math.round((input.hourlyRateCents ?? 0) * (input.hours ?? 0))
    : input.flatPriceCents ?? 0;
  const priceCents = base + input.travelFeeCents;
  if (priceCents < BOOKING_TERMS.minimumPriceCents || priceCents > BOOKING_TERMS.maximumPriceCents) {
    throw new BookingInputError(
      `The booking price must be between ${money(BOOKING_TERMS.minimumPriceCents)} and ${money(BOOKING_TERMS.maximumPriceCents)}`,
    );
  }
  const clientFeeCents = feeCents(priceCents, BOOKING_TERMS.clientFeeBps);
  const platformFeeCents = feeCents(priceCents, BOOKING_TERMS.instructorFeeBps);
  return {
    instructorFeeBps: BOOKING_TERMS.instructorFeeBps,
    clientFeeBps: BOOKING_TERMS.clientFeeBps,
    priceCents,
    clientFeeCents,
    totalCents: priceCents + clientFeeCents,
    platformFeeCents,
    instructorPayoutCents: priceCents - platformFeeCents,
  };
}

export function money(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  }).format(cents / 100);
}

export function percentLabel(bps: number): string {
  const value = bps / 100;
  return `${Number.isInteger(value) ? value : value.toFixed(2)}%`;
}

export function displayTime(value: string): string {
  const [hourText, minute] = value.split(":");
  const hour = Number(hourText);
  const suffix = hour >= 12 ? "PM" : "AM";
  const twelve = hour % 12 === 0 ? 12 : hour % 12;
  return `${twelve}:${minute} ${suffix}`;
}

export function displayDate(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "long",
    timeZone: "UTC",
  }).format(new Date(`${value}T12:00:00Z`));
}

export function cancellationPolicyText(windows: CancellationWindow[]): string[] {
  const lines = windows.map((window) =>
    window.minDaysBeforeEvent === 0
      ? `Cancelled before the event starts: ${window.refundPercent}% of the instructor price is refunded.`
      : `Cancelled ${window.minDaysBeforeEvent} or more days before the event starts: ${window.refundPercent}% of the instructor price is refunded.`
  );
  const last = windows[windows.length - 1];
  if (last.minDaysBeforeEvent > 0 || last.refundPercent > 0) {
    lines.push(
      last.minDaysBeforeEvent > 0
        ? `Cancelled less than ${last.minDaysBeforeEvent} days before the event starts: no refund of the instructor price.`
        : "After the event starts: no refund of the instructor price.",
    );
  }
  return lines;
}

export type AgreementParties = {
  instructorName: string;
  instructorBusiness: string | null;
  organizerName: string;
  organizerCompany: string | null;
  legalName: string;
};

export function renderAgreement(
  input: QuoteInput,
  amounts: QuoteAmounts,
  parties: AgreementParties,
): string {
  const pricing = input.pricingMode === "hourly"
    ? `${money(input.hourlyRateCents ?? 0)} per hour for ${input.hours} hours`
    : `Flat price of ${money(input.flatPriceCents ?? 0)}`;
  const equipment = [
    input.providesSpeakers ? "speakers" : null,
    input.providesMicrophone ? "a microphone" : null,
  ].filter(Boolean);
  const insurance = input.insuranceChoice === "coi_on_file"
    ? "The Instructor states that they carry liability insurance and will provide a certificate of insurance on request."
    : "The Instructor will handle any liability insurance outside this agreement. Hire Line Dancers does not provide, verify, or require insurance for this booking.";
  const instructorParty = parties.instructorBusiness
    ? `${parties.instructorName} (${parties.instructorBusiness})`
    : parties.instructorName;
  const organizerParty = parties.organizerCompany
    ? `${parties.organizerName} on behalf of ${parties.organizerCompany}`
    : parties.organizerName;

  return [
    "HIRE LINE DANCERS BOOKING AGREEMENT",
    `Agreement version: ${BOOKING_AGREEMENT_VERSION}`,
    "",
    "1. Parties",
    `Instructor: ${instructorParty} ("Instructor").`,
    `Client: ${organizerParty} ("Client").`,
    `Hire Line Dancers is operated by ${parties.legalName} ("Hire Line Dancers"). Hire Line Dancers provides the platform, this standard agreement, and the payment flow. Hire Line Dancers is not a party to this agreement and does not provide the services. Hire Line Dancers collects and holds payment as the Instructor's limited payment collection agent; payment to Hire Line Dancers counts as payment to the Instructor.`,
    "",
    "2. Event",
    `Date: ${displayDate(input.eventDate)}`,
    `Time: ${displayTime(input.startTime)} to ${displayTime(input.endTime)} (${input.timeZone})`,
    `Venue: ${input.venueName ? `${input.venueName}, ` : ""}${input.venueAddress}`,
    "",
    "3. Services",
    input.serviceDescription,
    equipment.length
      ? `The Instructor will provide ${equipment.join(" and ")}.`
      : "The Client will provide any sound equipment needed.",
    "",
    "4. Price and payment",
    `Instructor price: ${pricing}${input.travelFeeCents ? `, plus a travel fee of ${money(input.travelFeeCents)}` : ""}, for a total instructor price of ${money(amounts.priceCents)}.`,
    `Hire Line Dancers service fee (${percentLabel(amounts.clientFeeBps)}): ${money(amounts.clientFeeCents)}.`,
    `Total due from the Client: ${money(amounts.totalCents)}, paid in full through Hire Line Dancers when the Client signs.`,
    `Hire Line Dancers holds the payment and pays the Instructor ${BOOKING_TERMS.payoutDelayHours} hours after the scheduled end of the event, less the Hire Line Dancers platform fee agreed in the Instructor Terms, unless the Client reports a problem before then.`,
    "This agreement takes effect only when the payment succeeds. If the payment does not succeed, neither party is bound.",
    "",
    "5. Cancellation",
    `Policy: ${input.cancellationPolicy === "standard" ? "Standard" : "Custom (set by the Instructor)"}.`,
    "If the Client cancels:",
    ...cancellationPolicyText(input.cancellationWindows).map((line) => `- ${line}`),
    "- The Hire Line Dancers service fee is not refunded when the Client cancels.",
    "If the Instructor cancels, the Client receives a full refund, including the service fee.",
    "Either party may propose a new date because of weather, venue closure, or emergency. If both agree in the Hire Line Dancers conversation, the payment carries over to the new date.",
    "",
    "6. Problems at the event",
    `The Client may report a no-show or a material problem within ${BOOKING_TERMS.problemReportWindowHours} hours after the scheduled end of the event. A report pauses the Instructor payout while Hire Line Dancers reviews messages and other evidence from both parties. Hire Line Dancers decides how held funds are released or refunded. That decision covers only the funds Hire Line Dancers holds and does not make Hire Line Dancers responsible for the event. Without a timely report, the event is treated as completed.`,
    "",
    "7. Insurance",
    insurance,
    "",
    "8. Independent contractor",
    "The Instructor is an independent business, not an employee or agent of the Client or of Hire Line Dancers. The Instructor controls how the services are performed and is responsible for their own taxes, equipment, and conduct.",
    "",
    "9. Booking through Hire Line Dancers",
    "For 12 months after first connecting through Hire Line Dancers, the parties agree to book each other only through Hire Line Dancers, and to keep messages and payments on Hire Line Dancers.",
    "",
    "10. Disputes between the parties",
    "The Client and the Instructor will resolve any disagreement about the services, the event, or each other's conduct directly with each other. Hire Line Dancers does not guarantee the quality or safety of the services, has no duty to mediate, and is not liable for disputes between the parties, the venue, or other vendors. Each party releases Hire Line Dancers and OMG Goals, Inc. from claims arising from those disputes, to the extent the law allows.",
    "",
    "11. Other terms",
    "This agreement incorporates the Hire Line Dancers Terms of Service. Each party is responsible for claims arising from its own conduct, services, venue, guests, and equipment, and will indemnify Hire Line Dancers for those claims. Hire Line Dancers' liability is limited to the fees it kept for this booking. Each party signs electronically by typing their name, and the electronic signatures have the same effect as handwritten signatures.",
  ].join("\n");
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

// Counts weekdays strictly between today and the event date, in the event's
// time zone. ACH is offered only when enough business days remain for the
// payment to clear before the event.
export function businessDaysUntil(eventDate: string, timeZone: string, now = new Date()): number {
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  const cursor = new Date(`${today}T12:00:00Z`);
  const end = new Date(`${eventDate}T12:00:00Z`);
  let count = 0;
  cursor.setUTCDate(cursor.getUTCDate() + 1);
  while (cursor < end && count < 400) {
    const day = cursor.getUTCDay();
    if (day !== 0 && day !== 6) count += 1;
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return count;
}

export function bankPaymentAllowed(eventDate: string, timeZone: string, now = new Date()): boolean {
  return businessDaysUntil(eventDate, timeZone, now) >= BOOKING_TERMS.achMinimumBusinessDays;
}

const CONTACT_REPLACEMENT = "[contact details hidden until the booking is paid]";

// Mirrors private.mask_contact_details for content rendered outside the
// database, such as legacy inquiry emails.
export function maskContactDetails(value: string | null): string | null {
  if (value === null) return null;
  return value
    .replace(
      /[A-Za-z0-9._%+-]+\s*(@|\(at\)|\[at\])\s*[A-Za-z0-9.-]+\s*(\.|\(dot\)|\[dot\])\s*[A-Za-z]{2,}/gi,
      CONTACT_REPLACEMENT,
    )
    .replace(
      /(\+?1[\s.-]?)?\(?[0-9]{3}\)?[\s.-]?[0-9]{3}[\s.-]?[0-9]{4}/g,
      CONTACT_REPLACEMENT,
    )
    .replace(
      /(https?:\/\/)?(www\.)?(instagram\.com|facebook\.com|fb\.me|tiktok\.com|wa\.me|t\.me|linkedin\.com|x\.com|twitter\.com|snapchat\.com)\/\S*/gi,
      CONTACT_REPLACEMENT,
    )
    .replace(/(^|[\s(])@[A-Za-z0-9_.]{3,30}/g, `$1${CONTACT_REPLACEMENT}`);
}

export function requestIp(req: Request): string | null {
  const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const candidate = forwarded || req.headers.get("cf-connecting-ip") ||
    req.headers.get("x-real-ip");
  return candidate ? candidate.slice(0, 100) : null;
}

export function requestUserAgent(req: Request): string | null {
  const value = req.headers.get("user-agent");
  return value ? value.slice(0, 500) : null;
}

export function bookingJson(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

// PostgreSQL raises user-facing messages from the booking functions. Pass
// those through and hide everything else.
const FRIENDLY_DATABASE_MESSAGES = [
  "Booking not found",
  "This conversation",
  "Only the instructor",
  "This inquiry was routed",
  "Finish payout setup",
  "The event",
  "This quote",
  "The agreement changed",
  "Only a confirmed booking",
  "Only an open quote",
  "This payment is under dispute",
  "Reason must be",
  "This booking",
  "The refund must be",
  "Administrator access required",
  "The instructor was already paid",
  "This instructor already has a different payout account",
];

export function friendlyDatabaseError(message: string | undefined, fallback: string): string {
  if (!message) return fallback;
  return FRIENDLY_DATABASE_MESSAGES.some((prefix) => message.startsWith(prefix))
    ? message
    : fallback;
}
