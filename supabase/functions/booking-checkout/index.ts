// Organizer signs a quote and pays in full through Stripe Checkout.
//
// POST { bookingId, typedName, agreementSha256, consent: true }
//
// The organizer signs the exact agreement text identified by its SHA-256
// fingerprint, then is redirected to Checkout. The agreement takes effect
// only when the webhook confirms that the payment succeeded. Calling again
// for a signed, unpaid booking reopens payment without signing twice.
import { withSupabase } from "npm:@supabase/server@^1";
import type Stripe from "npm:stripe@^22";
import {
  bankPaymentAllowed,
  bookingJson as json,
  friendlyDatabaseError,
  requestIp,
  requestUserAgent,
  validUuid,
} from "../_shared/hld-booking.ts";
import {
  BOOKING_CORS,
  BOOKING_PRODUCT_LINE,
  bookingStripe,
  bookingStripeConfig,
  stripeErrorMessage,
  threadUrl,
} from "../_shared/hld-booking-stripe.ts";
import { supabaseServerOptions } from "../_shared/hld-supabase-admin.ts";

type BookingRow = {
  id: string;
  thread_id: string;
  organizer_account_id: string;
  instructor_profile_id: string;
  status: string;
  event_date: string;
  time_zone: string;
  expires_at: string;
  price_cents: number;
  client_fee_cents: number;
  total_cents: number;
  agreement_sha256: string;
  stripe_checkout_session_id: string | null;
};

const THIRTY_MINUTES = 30 * 60;
const TWENTY_THREE_HOURS = 23 * 60 * 60;

export default {
  fetch: withSupabase<any>({
    auth: "user",
    cors: BOOKING_CORS,
    supabaseOptions: supabaseServerOptions(),
  }, async (req, ctx) => {
    if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
    const accountId = ctx.userClaims?.id;
    if (!accountId) return json({ error: "Authentication required" }, 401);

    let bookingId: string | null;
    let typedName = "";
    let agreementSha256 = "";
    let consent = false;
    try {
      const body = await req.json() as Record<string, unknown>;
      bookingId = validUuid(body.bookingId);
      typedName = typeof body.typedName === "string" ? body.typedName.trim() : "";
      agreementSha256 = typeof body.agreementSha256 === "string" ? body.agreementSha256 : "";
      consent = body.consent === true;
    } catch {
      return json({ error: "A valid JSON request is required" }, 400);
    }
    if (!bookingId) return json({ error: "A booking is required" }, 400);

    let config: ReturnType<typeof bookingStripeConfig>;
    try {
      config = bookingStripeConfig();
    } catch (error) {
      console.error("Booking checkout configuration is invalid", error instanceof Error ? error.message : error);
      return json({ error: "Payments are not configured yet" }, 503);
    }

    const { data: booking, error: bookingError } = await ctx.supabaseAdmin
      .from("bookings")
      .select("id, thread_id, organizer_account_id, instructor_profile_id, status, event_date, time_zone, expires_at, price_cents, client_fee_cents, total_cents, agreement_sha256, stripe_checkout_session_id")
      .eq("id", bookingId)
      .maybeSingle<BookingRow>();
    if (bookingError) {
      console.error("Unable to load booking for checkout", bookingError.code);
      return json({ error: "Unable to load this booking" }, 500);
    }
    if (!booking || booking.organizer_account_id !== accountId) {
      return json({ error: "Booking not found or access denied" }, 404);
    }
    if (!["quote_sent", "awaiting_payment"].includes(booking.status)) {
      return json({ error: "This quote is no longer open for payment" }, 409);
    }
    if (new Date(booking.expires_at).getTime() <= Date.now()) {
      return json({ error: "This quote has expired. Ask the instructor to send a new one" }, 409);
    }

    const [accountResult, profileResult] = await Promise.all([
      ctx.supabaseAdmin.from("accounts").select("email").eq("id", accountId).maybeSingle(),
      ctx.supabaseAdmin
        .from("instructor_profiles")
        .select("display_name")
        .eq("id", booking.instructor_profile_id)
        .maybeSingle(),
    ]);
    const email = accountResult.data?.email as string | undefined;
    if (!email || !profileResult.data) {
      return json({ error: "Unable to prepare payment" }, 500);
    }

    if (booking.status === "quote_sent") {
      if (!consent) return json({ error: "Agree to the booking agreement before signing" }, 400);
      if (typedName.length < 2 || typedName.length > 120) {
        return json({ error: "Type your full name to sign" }, 400);
      }
      if (!/^[0-9a-f]{64}$/.test(agreementSha256)) {
        return json({ error: "Reopen the agreement and review it before signing" }, 400);
      }
      const { error: signError } = await ctx.supabaseAdmin.rpc("booking_record_organizer_signature", {
        p_booking_id: booking.id,
        p_account_id: accountId,
        p_typed_name: typedName,
        p_email: email,
        p_agreement_sha256: agreementSha256,
        p_ip_address: requestIp(req),
        p_user_agent: requestUserAgent(req),
      });
      if (signError) {
        console.error("Organizer signature failed", signError.code, signError.message);
        return json({ error: friendlyDatabaseError(signError.message, "Unable to record your signature") }, 409);
      }
    }

    const stripe = bookingStripe();
    try {
      if (booking.stripe_checkout_session_id) {
        const existing = await stripe.checkout.sessions.retrieve(booking.stripe_checkout_session_id);
        if (existing.status === "open" && existing.url) {
          return json({ url: existing.url, bookingId: booking.id });
        }
        if (existing.status === "complete") {
          return json({
            error: "Payment for this booking is already being processed",
            code: "payment_in_progress",
          }, 409);
        }
      }

      const allowBank = bankPaymentAllowed(booking.event_date, booking.time_zone);
      const paymentMethodTypes: Stripe.Checkout.SessionCreateParams.PaymentMethodType[] = allowBank
        ? ["card", "link", "us_bank_account"]
        : ["card", "link"];
      const secondsUntilExpiry = Math.floor(
        (new Date(booking.expires_at).getTime() - Date.now()) / 1000,
      );
      const sessionExpiry = Math.floor(Date.now() / 1000) +
        Math.max(THIRTY_MINUTES + 60, Math.min(TWENTY_THREE_HOURS, secondsUntilExpiry));
      const metadata = {
        product_line: BOOKING_PRODUCT_LINE,
        booking_id: booking.id,
        thread_id: booking.thread_id,
        agreement_sha256: booking.agreement_sha256,
      };

      const session = await stripe.checkout.sessions.create({
        mode: "payment",
        customer_email: email,
        client_reference_id: booking.id,
        payment_method_types: paymentMethodTypes,
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: "usd",
              unit_amount: booking.price_cents,
              product_data: {
                name: `Line dance instruction with ${profileResult.data.display_name}`,
                description: `Event on ${booking.event_date}. Held by Hire Line Dancers until 24 hours after the event.`,
              },
            },
          },
          {
            quantity: 1,
            price_data: {
              currency: "usd",
              unit_amount: booking.client_fee_cents,
              product_data: { name: "Hire Line Dancers service fee" },
            },
          },
        ],
        payment_intent_data: {
          transfer_group: booking.id,
          description: `Hire Line Dancers booking ${booking.id}`,
          metadata,
        },
        metadata,
        expires_at: sessionExpiry,
        success_url: threadUrl(config, booking.thread_id, {
          booking: "paid",
          session_id: "{CHECKOUT_SESSION_ID}",
        }).replace("%7BCHECKOUT_SESSION_ID%7D", "{CHECKOUT_SESSION_ID}"),
        cancel_url: threadUrl(config, booking.thread_id, { booking: "payment_canceled" }),
      }, { idempotencyKey: `hld-booking-checkout-${booking.id}-${crypto.randomUUID()}` });

      if (session.amount_total !== booking.total_cents) {
        await stripe.checkout.sessions.expire(session.id).catch(() => undefined);
        throw new Error("Checkout total does not match the booking total");
      }

      const { error: attachError } = await ctx.supabaseAdmin.rpc("booking_attach_checkout_session", {
        p_booking_id: booking.id,
        p_session_id: session.id,
      });
      if (attachError) {
        await stripe.checkout.sessions.expire(session.id).catch(() => undefined);
        console.error("Unable to attach Checkout Session", attachError.message);
        return json({ error: friendlyDatabaseError(attachError.message, "Unable to open payment") }, 409);
      }

      return json({ url: session.url, bookingId: booking.id, bankPaymentAllowed: allowBank });
    } catch (error) {
      console.error("Booking checkout failed", stripeErrorMessage(error));
      return json({ error: "Stripe could not open payment. Your signature is saved, so you can try paying again." }, 502);
    }
  }),
};
