// Cancels a confirmed booking.
//
// POST { bookingId, reason?, asAdmin? }
//
// The organizer, the instructor, or an administrator (asAdmin: true) can
// cancel before the event starts; administrators can also cancel afterward.
// The database decides the refund from the cancellation policy, then this
// function refunds the organizer. Any instructor share is paid by the
// scheduled transfer worker.
import { withSupabase } from "npm:@supabase/server@^1";
import {
  bookingJson as json,
  friendlyDatabaseError,
  validUuid,
} from "../_shared/hld-booking.ts";
import { BOOKING_CORS, bookingStripe, bookingStripeConfig } from "../_shared/hld-booking-stripe.ts";
import { executeBookingRefund } from "../_shared/hld-booking-refunds.ts";
import { supabaseServerOptions } from "../_shared/hld-supabase-admin.ts";

type CancellationPlan = {
  bookingId: string;
  alreadyCancelled: boolean;
  refundCents: number | null;
  refundStatus: string | null;
  payoutCents?: number;
  paymentIntentId: string | null;
  chargeId: string | null;
};

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
    let reason: string | null = null;
    let asAdmin = false;
    try {
      const body = await req.json() as Record<string, unknown>;
      bookingId = validUuid(body.bookingId);
      reason = typeof body.reason === "string" ? body.reason.slice(0, 2000) : null;
      asAdmin = body.asAdmin === true;
    } catch {
      return json({ error: "A valid JSON request is required" }, 400);
    }
    if (!bookingId) return json({ error: "A booking is required" }, 400);

    try {
      bookingStripeConfig();
    } catch (error) {
      console.error("Booking cancellation configuration is invalid", error instanceof Error ? error.message : error);
      return json({ error: "Payments are not configured yet" }, 503);
    }

    if (asAdmin) {
      const [accountResult, adminResult] = await Promise.all([
        ctx.supabaseAdmin.from("accounts").select("role").eq("id", accountId).maybeSingle(),
        ctx.supabaseAdmin.from("marketplace_admins").select("account_id").eq("account_id", accountId).maybeSingle(),
      ]);
      if (accountResult.error || adminResult.error) {
        return json({ error: "Unable to verify administrator access" }, 500);
      }
      if (accountResult.data?.role !== "admin" && !adminResult.data) {
        return json({ error: "Administrator access required" }, 403);
      }
    }

    const { data, error } = await ctx.supabaseAdmin.rpc("booking_prepare_cancellation", {
      p_booking_id: bookingId,
      p_account_id: accountId,
      p_reason: reason,
      p_as_admin: asAdmin,
    });
    if (error) {
      console.error("Cancellation was refused", error.message);
      return json({ error: friendlyDatabaseError(error.message, "Unable to cancel this booking") }, 409);
    }
    const plan = data as CancellationPlan;
    const refundCents = plan.refundCents ?? 0;

    if (refundCents === 0) {
      if (!plan.alreadyCancelled) {
        const { error: finishError } = await ctx.supabaseAdmin.rpc(
          "booking_finish_cancellation_without_refund",
          { p_booking_id: plan.bookingId },
        );
        if (finishError) console.error("Unable to post cancellation milestone", finishError.message);
      }
      return json({ cancelled: true, refundCents: 0, refundStatus: "not_required" });
    }

    if (plan.alreadyCancelled && plan.refundStatus === "succeeded") {
      return json({ cancelled: true, refundCents, refundStatus: "succeeded" });
    }

    const refundStatus = await executeBookingRefund(bookingStripe(), ctx.supabaseAdmin, {
      bookingId: plan.bookingId,
      refundCents,
      paymentIntentId: plan.paymentIntentId,
      chargeId: plan.chargeId,
    });
    return json({
      cancelled: true,
      refundCents,
      refundStatus,
      message: refundStatus === "failed"
        ? "The booking is cancelled. The refund did not go through yet; Hire Line Dancers will retry it automatically."
        : undefined,
    });
  }),
};
