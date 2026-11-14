// Sends an inquiry for an organizer who has not signed in.
//
// POST { email, firstName, lastName?, instructorProfileId | instructorSlug,
//        event fields..., turnstileToken?, website (honeypot) }
//
// Finds or creates the sign-in for the email, then submits through the
// service-role submit_guest_inquiry function, which applies per-email and
// per-network limits. Replies are emailed; reading them requires signing in.
import { withSupabase } from "npm:@supabase/server@^1";
import { BOOKING_CORS } from "../_shared/hld-booking-stripe.ts";
import { bookingJson as json, requestIp } from "../_shared/hld-booking.ts";
import {
  GuestInquiryError,
  isHoneypotFilled,
  parseGuestInquiry,
  publicGuestError,
  sha256Hex,
  verifyTurnstile,
} from "../_shared/hld-guest-inquiry.ts";
import { supabaseServerOptions } from "../_shared/hld-supabase-admin.ts";

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

    // Bots that fill the hidden field get a normal-looking response.
    if (isHoneypotFilled(body)) return json({ ok: true });

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

    const admin = ctx.supabaseAdmin;
    const { data: existing, error: lookupError } = await admin.rpc("guest_inquiry_account", { p_email: input.email });
    if (lookupError) {
      console.error("Guest inquiry account lookup failed", lookupError.message);
      return json({ error: "We could not send your inquiry. Please try again." }, 500);
    }
    let accountId = (existing as { account_id?: string } | null)?.account_id ?? null;
    const role = (existing as { role?: string | null } | null)?.role ?? null;
    if (role && role !== "organizer") return json({ error: "Sign in to send this inquiry", signInRequired: true }, 409);

    if (!accountId) {
      const { data: created, error: createError } = await admin.auth.admin.createUser({
        email: input.email,
        email_confirm: false,
        user_metadata: { full_name: [input.firstName, input.lastName].filter(Boolean).join(" ") },
      });
      if (createError || !created.user) {
        // A concurrent request may have created it first.
        const { data: retry } = await admin.rpc("guest_inquiry_account", { p_email: input.email });
        accountId = (retry as { account_id?: string } | null)?.account_id ?? null;
        if (!accountId) {
          console.error("Guest inquiry sign-in creation failed", createError?.message);
          return json({ error: "We could not send your inquiry. Please try again." }, 500);
        }
      } else {
        accountId = created.user.id;
      }
    }

    const { data: inquiryId, error: submitError } = await admin.rpc("submit_guest_inquiry", {
      p_account_id: accountId,
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
    if (submitError || typeof inquiryId !== "string") {
      const message = publicGuestError(submitError?.message);
      const status = message.startsWith("Too many") ? 429 : message.startsWith("Sign in") ? 409 : 400;
      if (status === 400 && message.startsWith("We could not")) console.error("Guest inquiry submission failed", submitError?.message);
      return json({ error: message, signInRequired: status === 409 || undefined }, status);
    }
    return json({ ok: true, inquiryId });
  }),
};
