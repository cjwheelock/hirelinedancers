// Administrator decision on a booking problem report.
//
// POST { action: "resolve_problem", bookingId, refundCents, note? }
//
// refundCents = 0 releases the payout. A refund up to the instructor price
// is issued to the organizer, and the instructor is paid the remainder minus
// the platform fee. Refunding the full instructor price also refunds the
// service fee and cancels the booking.
import { withSupabase } from "npm:@supabase/server@^1";
import {
  bookingJson as json,
  friendlyDatabaseError,
  validUuid,
} from "../_shared/hld-booking.ts";
import { BOOKING_CORS, bookingStripe, bookingStripeConfig } from "../_shared/hld-booking-stripe.ts";
import { executeBookingRefund } from "../_shared/hld-booking-refunds.ts";
import { supabaseServerOptions } from "../_shared/hld-supabase-admin.ts";

export default {
  fetch: withSupabase<any>({
    auth: "user",
    cors: BOOKING_CORS,
    supabaseOptions: supabaseServerOptions(),
  }, async (req, ctx) => {
    if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
    const accountId = ctx.userClaims?.id;
    if (!accountId) return json({ error: "Authentication required" }, 401);

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

    let bookingId: string | null;
    let refundCents: number;
    let note: string | null;
    try {
      const body = await req.json() as Record<string, unknown>;
      if (body.action !== "resolve_problem") return json({ error: "Unsupported booking action" }, 400);
      bookingId = validUuid(body.bookingId);
      refundCents = typeof body.refundCents === "number" && Number.isInteger(body.refundCents)
        ? body.refundCents
        : -1;
      note = typeof body.note === "string" ? body.note.slice(0, 2000) : null;
    } catch {
      return json({ error: "A valid JSON request is required" }, 400);
    }
    if (!bookingId) return json({ error: "A booking is required" }, 400);
    if (refundCents < 0) return json({ error: "Enter a refund amount in cents, or 0 to release the payout" }, 400);

    try {
      bookingStripeConfig();
    } catch {
      return json({ error: "Payments are not configured yet" }, 503);
    }

    const { data, error } = await ctx.supabaseAdmin.rpc("booking_prepare_problem_resolution", {
      p_booking_id: bookingId,
      p_admin_account_id: accountId,
      p_refund_cents: refundCents,
      p_note: note,
    });
    if (error) {
      return json({ error: friendlyDatabaseError(error.message, "Unable to resolve this problem") }, 409);
    }
    const plan = data as {
      bookingId: string;
      refundCents: number;
      payoutCents: number;
      paymentIntentId: string | null;
      chargeId: string | null;
    };
    if (plan.refundCents === 0) return json({ resolved: true, refundStatus: "not_required", payoutCents: plan.payoutCents });

    const refundStatus = await executeBookingRefund(bookingStripe(), ctx.supabaseAdmin, plan);
    return json({ resolved: true, refundStatus, refundCents: plan.refundCents, payoutCents: plan.payoutCents });
  }),
};
