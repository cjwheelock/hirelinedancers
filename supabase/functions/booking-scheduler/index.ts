// Booking worker. Schedule once per minute with Supabase Cron, authenticated
// with the same `automations` secret key as process-inquiry-notifications.
//
// Each run:
//   1. Expires unpaid quotes and posts the milestone.
//   2. Posts quote-expiry reminders, event reminders, and event-ended notices.
//   3. Retries refunds that have not reached Stripe yet.
//   4. Transfers instructor payouts that are due.
import { withSupabase } from "npm:@supabase/server@^1";
import type Stripe from "npm:stripe@^22";
import {
  bookingStripe,
  bookingStripeConfig,
  stripeErrorMessage,
} from "../_shared/hld-booking-stripe.ts";
import { executeBookingRefund } from "../_shared/hld-booking-refunds.ts";
import { supabaseServerOptions } from "../_shared/hld-supabase-admin.ts";

type DueTransfer = {
  booking_id: string;
  amount_cents: number;
  stripe_account_id: string;
  stripe_charge_id: string;
  instructor_profile_id: string;
  reason: string;
};

async function existingTransfer(stripe: Stripe, due: DueTransfer): Promise<Stripe.Transfer | null> {
  const transfers = await stripe.transfers.list({ transfer_group: due.booking_id, limit: 10 });
  return transfers.data.find((transfer) =>
    transfer.destination === due.stripe_account_id &&
    transfer.amount === due.amount_cents &&
    !transfer.reversed
  ) ?? null;
}

export default {
  fetch: withSupabase<any>({
    auth: "secret:automations",
    cors: false,
    supabaseOptions: supabaseServerOptions(),
  }, async (req, ctx) => {
    if (req.method !== "POST") return Response.json({ error: "Method not allowed" }, { status: 405 });

    const summary: Record<string, unknown> = {};

    const { data: expired, error: expireError } = await ctx.supabaseAdmin.rpc("booking_expire_due_quotes");
    if (expireError) {
      console.error("Unable to expire quotes", expireError.message);
      return Response.json({ error: "Unable to expire quotes" }, { status: 500 });
    }
    summary.expiredQuotes = expired;

    const { data: reminders, error: reminderError } = await ctx.supabaseAdmin.rpc("booking_post_due_reminders");
    if (reminderError) {
      console.error("Unable to post booking reminders", reminderError.message);
      return Response.json({ error: "Unable to post booking reminders" }, { status: 500 });
    }
    summary.reminders = reminders;

    let config: ReturnType<typeof bookingStripeConfig>;
    let stripe: Stripe;
    try {
      config = bookingStripeConfig();
      stripe = bookingStripe();
    } catch (error) {
      console.error("Booking payments are not configured", error instanceof Error ? error.message : error);
      return Response.json({ ...summary, payments: "not_configured" });
    }

    // Refunds that failed or never reached Stripe. Stable idempotency keys
    // make retries safe.
    const retryBefore = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const { data: pendingRefunds, error: refundError } = await ctx.supabaseAdmin
      .from("bookings")
      .select("id, refund_cents, stripe_payment_intent_id, stripe_charge_id")
      .gt("refund_cents", 0)
      .in("refund_status", ["pending", "failed"])
      .is("stripe_refund_id", null)
      .lt("updated_at", retryBefore)
      .limit(10);
    if (refundError) {
      console.error("Unable to load pending refunds", refundError.message);
    } else {
      let retried = 0;
      for (const row of pendingRefunds ?? []) {
        await executeBookingRefund(stripe, ctx.supabaseAdmin, {
          bookingId: row.id,
          refundCents: row.refund_cents,
          paymentIntentId: row.stripe_payment_intent_id,
          chargeId: row.stripe_charge_id,
        });
        retried += 1;
      }
      summary.refundsRetried = retried;
    }

    const { data: due, error: claimError } = await ctx.supabaseAdmin.rpc("booking_claim_due_transfers", { p_limit: 10 });
    if (claimError) {
      console.error("Unable to claim payouts", claimError.message);
      return Response.json({ ...summary, error: "Unable to claim payouts" }, { status: 500 });
    }

    let transferred = 0;
    let failed = 0;
    for (const item of (due ?? []) as DueTransfer[]) {
      try {
        let transfer = await existingTransfer(stripe, item);
        if (!transfer) {
          transfer = await stripe.transfers.create({
            amount: item.amount_cents,
            currency: "usd",
            destination: item.stripe_account_id,
            source_transaction: item.stripe_charge_id,
            transfer_group: item.booking_id,
            description: `Hire Line Dancers booking ${item.booking_id}`,
            metadata: {
              booking_id: item.booking_id,
              instructor_profile_id: item.instructor_profile_id,
              reason: item.reason,
            },
          }, { idempotencyKey: `hld-booking-transfer-${item.booking_id}-${item.amount_cents}` });
        }
        if (transfer.livemode !== config.expectedLivemode) throw new Error("Transfer mode mismatch");
        const { error } = await ctx.supabaseAdmin.rpc("booking_record_transfer", {
          p_booking_id: item.booking_id,
          p_transfer_id: transfer.id,
          p_amount_cents: item.amount_cents,
        });
        if (error) throw new Error(`Transfer ${transfer.id} was sent but not recorded: ${error.message}`);
        transferred += 1;
      } catch (error) {
        failed += 1;
        const message = stripeErrorMessage(error);
        console.error("Payout transfer failed", item.booking_id, message);
        await ctx.supabaseAdmin.rpc("booking_record_transfer_error", {
          p_booking_id: item.booking_id,
          p_error: message,
        });
      }
    }
    summary.transfersSent = transferred;
    summary.transfersFailed = failed;
    return Response.json(summary);
  }),
};
