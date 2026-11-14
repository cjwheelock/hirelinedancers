// Validation and spam checks for inquiries sent without signing in.
// Kept free of Supabase imports so it can be unit tested directly.

export class GuestInquiryError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}

export type GuestInquiryInput = {
  email: string;
  firstName: string;
  lastName: string | null;
  instructorProfileId: string | null;
  instructorSlug: string | null;
  eventType: string;
  eventDate: string;
  startTime: string | null;
  timeZone: string | null;
  venueName: string | null;
  city: string | null;
  region: string | null;
  postalCode: string | null;
  guestCount: number | null;
  budgetRange: string | null;
  musicRequests: string | null;
  venueHasSpeakers: boolean | null;
  venueHasMicrophone: boolean | null;
  message: string | null;
  turnstileToken: string | null;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/;

function text(value: unknown, max: number): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") throw new GuestInquiryError("One or more fields are invalid");
  const trimmed = value.trim();
  if (trimmed.length > max) throw new GuestInquiryError("One or more fields are too long");
  return trimmed || null;
}

function bool(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

/** A filled honeypot field means a bot: the caller pretends success and saves nothing. */
export function isHoneypotFilled(body: Record<string, unknown>): boolean {
  return typeof body.website === "string" && body.website.trim() !== "";
}

export function parseGuestInquiry(body: Record<string, unknown>): GuestInquiryInput {
  const email = text(body.email, 254)?.toLowerCase() ?? "";
  if (!EMAIL.test(email)) throw new GuestInquiryError("Enter a valid email address");
  const firstName = text(body.firstName, 80);
  if (!firstName) throw new GuestInquiryError("Your name is required");
  const instructorProfileId = text(body.instructorProfileId, 36);
  if (instructorProfileId && !UUID.test(instructorProfileId)) throw new GuestInquiryError("Choose an instructor before starting an inquiry.");
  const instructorSlug = text(body.instructorSlug, 120);
  if (!instructorProfileId && !instructorSlug) throw new GuestInquiryError("Choose an instructor before starting an inquiry.");
  const eventType = text(body.eventType, 60);
  if (!eventType) throw new GuestInquiryError("Event type is required");
  const eventDate = text(body.eventDate, 10);
  if (!eventDate || !/^\d{4}-\d{2}-\d{2}$/.test(eventDate)) throw new GuestInquiryError("Event date is required");
  const startTime = text(body.startTime, 8);
  if (startTime && !/^\d{2}:\d{2}(:\d{2})?$/.test(startTime)) throw new GuestInquiryError("One or more fields are invalid");
  const guestCountRaw = body.guestCount;
  const guestCount = guestCountRaw === null || guestCountRaw === undefined || guestCountRaw === "" ? null : Number(guestCountRaw);
  if (guestCount !== null && (!Number.isInteger(guestCount) || guestCount < 1 || guestCount > 10000)) {
    throw new GuestInquiryError("Guest count must be between 1 and 10000");
  }
  return {
    email, firstName, lastName: text(body.lastName, 80), instructorProfileId, instructorSlug,
    eventType, eventDate, startTime, timeZone: text(body.timeZone, 64), venueName: text(body.venueName, 200),
    city: text(body.city, 120), region: text(body.region, 40), postalCode: text(body.postalCode, 20), guestCount,
    budgetRange: text(body.budgetRange, 40), musicRequests: text(body.musicRequests, 2000),
    venueHasSpeakers: bool(body.venueHasSpeakers), venueHasMicrophone: bool(body.venueHasMicrophone),
    message: text(body.message, 3000), turnstileToken: text(body.turnstileToken, 4096),
  };
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Cloudflare Turnstile check. When no secret is configured the check is
 * skipped, so the form works before the keys exist; rate limits still apply.
 */
export async function verifyTurnstile(
  token: string | null,
  secret: string | null | undefined,
  ip: string | null,
  fetcher: typeof fetch = fetch,
): Promise<boolean> {
  if (!secret) return true;
  if (!token) return false;
  const form = new URLSearchParams({ secret, response: token });
  if (ip) form.set("remoteip", ip);
  try {
    const response = await fetcher("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST", body: form, signal: AbortSignal.timeout(10_000),
    });
    const payload = await response.json().catch(() => ({})) as { success?: boolean };
    return response.ok && payload.success === true;
  } catch {
    return false;
  }
}

/** Database errors that are safe to show to the person submitting the form. */
export function publicGuestError(message: string | undefined): string {
  const safe = [
    "Too many requests. Please try again later",
    "Sign in to send this inquiry",
    "Instructor is not available for inquiries",
    "Event date cannot be in the past",
    "Event type is required",
    "Enter a valid email address",
    "Your name is required",
    "One or more fields are too long",
  ];
  const match = safe.find((item) => message?.includes(item));
  return match ?? "We could not send your inquiry. Please try again.";
}
