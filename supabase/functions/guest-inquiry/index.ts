// Inquiries from organizers who have not signed in.
//
// POST { email, firstName, lastName?, instructorProfileId | instructorSlug,
//        event fields..., turnstileToken?, website (honeypot) }
//   Holds the inquiry and emails a confirmation link to that address. Nothing
//   reaches any instructor until the link is clicked, which proves the
//   organizer owns the address. Held inquiries expire after 7 days.
//
// POST { action: "confirm", token }
//   Finds or creates the sign-in for the confirmed address, sends the held
//   inquiry through the normal path (the 48-hour clock starts now), and returns
//   a one-time sign-in token so the page can sign them in and open the
//   conversation.
import { withSupabase } from "npm:@supabase/server@^1";
import { BOOKING_CORS } from "../_shared/hld-booking-stripe.ts";
import { bookingJson as json, requestIp } from "../_shared/hld-booking.ts";
import {
  confirmationLink,
  confirmationTokenHash,
  GuestInquiryError,
  guestConfirmationEmail,
  isConfirmationToken,
  isHoneypotFilled,
  newConfirmationToken,
  parseGuestInquiry,
  publicGuestError,
  sha256Hex,
  verifyTurnstile,
} from "../_shared/hld-guest-inquiry.ts";
import { supabaseServerOptions } from "../_shared/hld-supabase-admin.ts";

const SEND_FAILED = "We could not send your inquiry. Please try again.";

function appUrl(): URL {
  const configured = Deno.env.get("APP_URL")?.trim() || "https://hirelinedancers.com";
  return new URL(configured.endsWith("/") ? configured : `${configured}/`);
}

async function sendEmail(body: Record<string, unknown>, idempotencyKey: string): Promise<void> {
  const apiKey = Deno.env.get("RESEND_API_KEY");
  const from = Deno.env.get("RESEND_FROM_EMAIL");
  if (!apiKey || !from) throw new Error("Email is not configured");
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    signal: AbortSignal.timeout(15_000),
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
    body: JSON.stringify({ from, reply_to: Deno.env.get("SUPPORT_EMAIL")?.trim() || "hello@hirelinedancers.com", ...body }),
  });
  // Do not log the provider response, which may repeat the address.
  if (!response.ok) throw new Error(`Email provider returned ${response.status}`);
}

type Admin = any;

async function findOrCreateSignIn(admin: Admin, email: string, fullName: string): Promise<string | null> {
  const lookup = async () => {
    const { data } = await admin.rpc("guest_inquiry_account", { p_email: email });
    return (data as { account_id?: string } | null)?.account_id ?? null;
  };
  const existing = await lookup();
  if (existing) return existing;
  // The person just proved they own this address, so the sign-in is confirmed.
  const { data: created, error } = await admin.auth.admin.createUser({
    email, email_confirm: true, user_metadata: { full_name: fullName },
  });
  if (!error && created?.user?.id) return created.user.id as string;
  // A concurrent confirmation may have created it first.
  return await lookup();
}

async function hold(req: Request, body: Record<string, unknown>, admin: Admin): Promise<Response> {
  // Bots that fill the hidden field get a normal-looking response.
  if (isHoneypotFilled(body)) return json({ ok: true, held: true });

  let input: ReturnType<typeof parseGuestInquiry>;
  try {
    input = parseGuestInquiry(body);
  } catch (error) {
    if (error instanceof GuestInquiryError) return json({ error: error.message }, error.status);
    throw error;
  }

  const ip = requestIp(req);
  const verified = await verifyTurnstile(input.turnstileToken, Deno.env.get("TURNSTILE_SECRET_KEY"), ip);
  if (!verified) return json({ error: "Please complete the verification and try again." }, 400);

  const token = newConfirmationToken();
  const { data: held, error: holdError } = await admin.rpc("hold_guest_inquiry", {
    p_token_hash: await confirmationTokenHash(token),
    p_email: input.email,
    p_first_name: input.firstName,
    p_last_name: input.lastName,
    p_ip_hash: ip ? await sha256Hex(`hld-guest:${ip}`) : null,
    p_instructor_profile_id: input.instructorProfileId,
    p_instructor_slug: input.instructorSlug,
    p_event_type: input.eventType,
    p_event_date: input.eventDate,
    p_event_start_time: input.startTime,
    p_time_zone: input.timeZone,
    p_venue_name: input.venueName,
    p_event_city: input.city,
    p_event_region: input.region,
    p_event_postal_code: input.postalCode,
    p_guest_count: input.guestCount,
    p_budget_range: input.budgetRange,
    p_music_requests: input.musicRequests,
    p_venue_has_speakers: input.venueHasSpeakers,
    p_venue_has_microphone: input.venueHasMicrophone,
    p_message: input.message,
  });
  if (holdError || !held) {
    const message = publicGuestError(holdError?.message);
    const status = message.startsWith("Too many") ? 429 : message.startsWith("Sign in") ? 409 : 400;
    if (message === SEND_FAILED) console.error("Guest inquiry hold failed", holdError?.message);
    return json({ error: message, signInRequired: status === 409 || undefined }, status);
  }

  const details = held as { held_id: string; first_name: string; instructor_name: string | null };
  try {
    await sendEmail(
      guestConfirmationEmail({
        to: input.email,
        firstName: details.first_name,
        instructorName: details.instructor_name,
        link: confirmationLink(appUrl(), token),
      }),
      `hld-guest-confirm-${details.held_id}`,
    );
  } catch (error) {
    console.error("Guest inquiry confirmation email failed", (error as Error).message);
    return json({ error: SEND_FAILED }, 502);
  }
  return json({ ok: true, held: true });
}

async function confirm(body: Record<string, unknown>, admin: Admin): Promise<Response> {
  if (!isConfirmationToken(body.token)) return json({ status: "invalid" }, 400);
  const tokenHash = await confirmationTokenHash(body.token);

  const { data: state, error: stateError } = await admin.rpc("guest_inquiry_hold_status", { p_token_hash: tokenHash });
  if (stateError || !state) return json({ error: SEND_FAILED }, 500);
  const current = state as { status: string; email?: string; first_name?: string; last_name?: string | null };
  if (current.status === "invalid") return json({ status: "invalid" }, 404);
  if (current.status === "expired") return json({ status: "expired" }, 410);
  if (current.status === "confirmed") return json({ status: "confirmed" });

  const email = current.email!;
  const accountId = await findOrCreateSignIn(admin, email, [current.first_name, current.last_name].filter(Boolean).join(" "));
  if (!accountId) return json({ error: SEND_FAILED }, 500);

  const { data: result, error: confirmError } = await admin.rpc("confirm_guest_inquiry", {
    p_token_hash: tokenHash, p_account_id: accountId,
  });
  if (confirmError || !result) {
    const message = publicGuestError(confirmError?.message);
    if (message === SEND_FAILED) console.error("Guest inquiry confirmation failed", confirmError?.message);
    return json({ error: message }, 400);
  }
  const sent = result as { status: string; inquiry_id?: string; thread_id?: string | null };
  if (sent.status !== "sent") return json({ status: sent.status }, sent.status === "expired" ? 410 : 200);

  const next = new URLSearchParams({ tab: "inquiries", inquiry: sent.inquiry_id! });
  if (sent.thread_id) next.set("thread", sent.thread_id);
  // A one-time sign-in token, verified by the site's existing sign-in callback.
  const { data: link, error: linkError } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  const tokenHashForSignIn = link?.properties?.hashed_token;
  return json({
    status: "sent",
    next: `/account/?${next.toString()}`,
    signInTokenHash: !linkError && typeof tokenHashForSignIn === "string" ? tokenHashForSignIn : null,
  });
}

export default {
  fetch: withSupabase<any>({
    auth: "none",
    cors: BOOKING_CORS,
    supabaseOptions: supabaseServerOptions(),
  }, async (req, ctx) => {
    if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

    let body: Record<string, unknown>;
    try {
      body = await req.json() as Record<string, unknown>;
      if (!body || typeof body !== "object") throw new Error();
    } catch {
      return json({ error: "A valid JSON request is required" }, 400);
    }

    return body.action === "confirm" ? confirm(body, ctx.supabaseAdmin) : hold(req, body, ctx.supabaseAdmin);
  }),
};
