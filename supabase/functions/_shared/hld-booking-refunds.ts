import type Stripe from "npm:stripe@^22";
import { stripeErrorMessage } from "./hld-booking-stripe.ts";

export type RefundPlan = {
  bookingId: string;
  refundCents: number;
  paymentIntentId: string | null;
  chargeId: string | null;
};

// Issues the refund recorded by the database and saves Stripe's result. The
// idempotency key is stable per booking, so a retry never refunds twice.
export async function executeBookingRefund(
  stripe: Stripe,
  // deno-lint-ignore no-explicit-any
  admin: any,
  plan: RefundPlan,
): Promise<"succeeded" | "pending" | "failed"> {
  if (plan.refundCents <= 0) return "succeeded";
  if (!plan.paymentIntentId && !plan.chargeId) {
    await admin.rpc("booking_record_refund", {
      p_booking_id: plan.bookingId,
      p_refund_id: null,
      p_refund_status: "failed",
      p_error: "The booking has no Stripe payment to refund",
    });
    return "failed";
  }
  try {
    const refund = await stripe.refunds.create({
      ...(plan.paymentIntentId ? { payment_intent: plan.paymentIntentId } : { charge: plan.chargeId! }),
      amount: plan.refundCents,
      reason: "requested_by_customer",
      metadata: { booking_id: plan.bookingId },
    }, { idempotencyKey: `hld-booking-refund-${plan.bookingId}-${plan.refundCents}` });
    const status = refund.status === "succeeded"
      ? "succeeded"
      : refund.status === "failed" || refund.status === "canceled"
      ? "failed"
      : "pending";
    const { error } = await admin.rpc("booking_record_refund", {
      p_booking_id: plan.bookingId,
      p_refund_id: refund.id,
      p_refund_status: status,
      p_error: status === "failed" ? refund.failure_reason ?? "Refund failed" : null,
    });
    if (error) console.error("Refund issued but not recorded", plan.bookingId, refund.id, error.message);
    return status;
  } catch (error) {
    const message = stripeErrorMessage(error);
    console.error("Refund failed", plan.bookingId, message);
    await admin.rpc("booking_record_refund", {
      p_booking_id: plan.bookingId,
      p_refund_id: null,
      p_refund_status: "failed",
      p_error: message,
    });
    return "failed";
  }
}
