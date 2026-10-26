// Signed Stripe webhook for booking payments and Connect payout accounts.
//
// booking-scheduler registers this URL in Stripe twice (events on the
// platform account, and account.updated on connected accounts) and stores the
// signing secrets in the database. STRIPE_BOOKING_WEBHOOK_SECRET and
// STRIPE_CONNECT_WEBHOOK_SECRET are also accepted for manually created
// endpoints.
//
// The membership webhook (stripe-webhook) ignores booking Checkout Sessions,
// and this webhook ignores everything that is not a booking.
import { withSupabase } from "npm:@supabase/server@^1";
import Stripe from "npm:stripe@^22";
import { validUuid } from "../_shared/hld-booking.ts";
import {
  BOOKING_PRODUCT_LINE,
  bookingStripe,
  loadWebhookConfig,
  bookingStripeConfig,
  stripeErrorMessage,
  stripeId,
  syncPayoutAccount,
} from "../_shared/hld-booking-stripe.ts";
import { supabaseServerOptions } from "../_shared/hld-supabase-admin.ts";

const cryptoProvider = Stripe.createSubtleCryptoProvider();

const HANDLED = new Set([
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
  "checkout.session.async_payment_failed",
  "charge.dispute.created",
  "refund.updated",
  "account.updated",
]);

async function verifiedEvent(
  stripe: Stripe,
  // deno-lint-ignore no-explicit-any
  admin: any,
  rawBody: string,
  signature: string,
): Promise<Stripe.Event | null> {
  const config = await loadWebhookConfig(admin);
  const secrets = [
    config.platform?.secret,
    config.connect?.secret,
    Deno.env.get("STRIPE_BOOKING_WEBHOOK_SECRET")?.trim(),
    Deno.env.get("STRIPE_CONNECT_WEBHOOK_SECRET")?.trim(),
  ].filter((value): value is string => Boolean(value));
  if (!secrets.length) throw new Error("No booking webhook signing secret is configured yet");
  for (const secret of secrets) {
    try {
      return await stripe.webhooks.constructEventAsync(rawBody, signature, secret, undefined, cryptoProvider);
    } catch {
      // Try the next endpoint secret.
    }
  }
  return null;
}

function paymentMethodType(paymentIntent: Stripe.PaymentIntent | null): string | null {
  const type = paymentIntent?.payment_method_types?.length === 1
    ? paymentIntent.payment_method_types[0]
    : null;
  const charge = paymentIntent?.latest_charge;
  const chargeType = charge && typeof charge === "object" ? charge.payment_method_details?.type : null;
  const value = chargeType ?? type;
  return value === "card" || value === "us_bank_account" || value === "link" ? value : null;
}

export default {
  fetch: withSupabase<any>({
    auth: "none",
    cors: false,
    supabaseOptions: supabaseServerOptions(),
  }, async (req, ctx) => {
    if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
    const signature = req.headers.get("stripe-signature");
    if (!signature) return new Response("Missing Stripe signature", { status: 400 });

    let config: ReturnType<typeof bookingStripeConfig>;
    let stripe: Stripe;
    try {
      config = bookingStripeConfig();
      stripe = bookingStripe();
    } catch (error) {
      console.error("Booking webhook configuration is invalid", error instanceof Error ? error.message : error);
      return new Response("Booking webhook is not configured", { status: 500 });
    }

    const rawBody = await req.text();
    let event: Stripe.Event | null;
    try {
      event = await verifiedEvent(stripe, ctx.supabaseAdmin, rawBody, signature);
    } catch (error) {
      console.error("Booking webhook secret is unavailable", error instanceof Error ? error.message : error);
      return new Response("Booking webhook is not configured", { status: 500 });
    }
    if (!event) return new Response("Invalid Stripe signature", { status: 400 });
    if (event.livemode !== config.expectedLivemode) return new Response("Unexpected Stripe mode", { status: 400 });
    if (!HANDLED.has(event.type)) return Response.json({ received: true, ignored: true });

    const { data: seen } = await ctx.supabaseAdmin
      .from("booking_stripe_events")
      .select("stripe_event_id")
      .eq("stripe_event_id", event.id)
      .maybeSingle();
    if (seen) return Response.json({ received: true, duplicate: true });

    let bookingId: string | null = null;
    try {
      if (event.type.startsWith("checkout.session.")) {
        const eventSession = event.data.object as Stripe.Checkout.Session;
        if (eventSession.metadata?.product_line !== BOOKING_PRODUCT_LINE || eventSession.mode !== "payment") {
          return Response.json({ received: true, ignored: true });
        }
        bookingId = validUuid(eventSession.metadata?.booking_id);
        if (!bookingId) throw new Error("Booking Checkout Session has no booking ID");

        const session = await stripe.checkout.sessions.retrieve(eventSession.id, {
          expand: ["payment_intent", "payment_intent.latest_charge"],
        });
        if (session.livemode !== config.expectedLivemode) throw new Error("Checkout Session mode mismatch");
        const paymentIntent = session.payment_intent && typeof session.payment_intent === "object"
          ? session.payment_intent
          : null;
        const chargeId = stripeId(paymentIntent?.latest_charge);
        const outcome = event.type === "checkout.session.async_payment_failed"
          ? "failed"
          : session.payment_status === "paid" && paymentIntent?.status === "succeeded"
          ? "paid"
          : paymentIntent?.status === "processing"
          ? "processing"
          : null;
        if (!outcome) {
          return Response.json({ received: true, ignored: true });
        }

        const { data: result, error } = await ctx.supabaseAdmin.rpc("booking_apply_payment", {
          p_booking_id: bookingId,
          p_outcome: outcome,
          p_session_id: session.id,
          p_payment_intent_id: paymentIntent?.id ?? null,
          p_charge_id: outcome === "paid" ? chargeId : null,
          p_payment_method_type: paymentMethodType(paymentIntent),
          p_amount_cents: session.amount_total,
          p_failure_message: outcome === "failed"
            ? paymentIntent?.last_payment_error?.message ?? "The bank payment failed"
            : null,
        });
        if (error) throw new Error(`Unable to apply payment: ${error.message}`);

        if (result === "refund_required" && paymentIntent?.id && outcome === "paid") {
          // Money arrived for a quote that was withdrawn, declined, or expired.
          const refund = await stripe.refunds.create({
            payment_intent: paymentIntent.id,
            reason: "duplicate",
            metadata: { booking_id: bookingId, cause: "quote_closed_before_payment" },
          }, { idempotencyKey: `hld-booking-closed-quote-refund-${paymentIntent.id}` });
          console.warn("Refunded payment for a closed quote", bookingId, refund.id);
        }
      } else if (event.type === "charge.dispute.created") {
        const dispute = event.data.object as Stripe.Dispute;
        const chargeId = stripeId(dispute.charge);
        if (chargeId) {
          const { data, error } = await ctx.supabaseAdmin.rpc("booking_record_dispute", {
            p_charge_id: chargeId,
            p_dispute_id: dispute.id,
          });
          if (error) throw new Error(`Unable to record dispute: ${error.message}`);
          bookingId = (data as string | null) ?? null;
        }
      } else if (event.type === "refund.updated") {
        const refund = event.data.object as Stripe.Refund;
        bookingId = validUuid(refund.metadata?.booking_id);
        if (bookingId && (refund.status === "succeeded" || refund.status === "failed" || refund.status === "canceled")) {
          const { data: booking } = await ctx.supabaseAdmin
            .from("bookings")
            .select("stripe_refund_id")
            .eq("id", bookingId)
            .maybeSingle();
          if (booking?.stripe_refund_id === refund.id) {
            const { error } = await ctx.supabaseAdmin.rpc("booking_record_refund", {
              p_booking_id: bookingId,
              p_refund_id: refund.id,
              p_refund_status: refund.status === "succeeded" ? "succeeded" : "failed",
              p_error: refund.status === "succeeded" ? null : refund.failure_reason ?? "Refund failed",
            });
            if (error) throw new Error(`Unable to record refund: ${error.message}`);
          }
        }
      } else if (event.type === "account.updated") {
        const account = event.data.object as Stripe.Account;
        const { data: payoutAccount, error } = await ctx.supabaseAdmin
          .from("instructor_payout_accounts")
          .select("instructor_profile_id, livemode")
          .eq("stripe_account_id", account.id)
          .maybeSingle();
        if (error) throw new Error(`Unable to load payout account: ${error.message}`);
        if (payoutAccount && payoutAccount.livemode === config.expectedLivemode) {
          await syncPayoutAccount(ctx.supabaseAdmin, payoutAccount.instructor_profile_id, account, config.expectedLivemode);
        }
      }

      await ctx.supabaseAdmin.rpc("booking_record_stripe_event", {
        p_event_id: event.id,
        p_event_type: event.type,
        p_booking_id: bookingId,
      });
      return Response.json({ received: true });
    } catch (error) {
      console.error("Booking webhook processing failed", event.id, event.type, stripeErrorMessage(error));
      return new Response("Booking webhook processing failed", { status: 500 });
    }
  }),
};
