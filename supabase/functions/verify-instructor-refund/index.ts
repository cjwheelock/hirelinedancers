import { withSupabase } from "npm:@supabase/server@^1";
import Stripe from "npm:stripe@^22";

function requiredEnv(name: string): string {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`Missing required secret: ${name}`);
  return value;
}

function objectId(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (
    value && typeof value === "object" && "id" in value &&
    typeof value.id === "string"
  ) {
    return value.id;
  }
  return null;
}

function json(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function linePriceId(line: Stripe.InvoiceLineItem): string | null {
  return objectId(line.pricing?.price_details?.price);
}

const refundStatuses = [
  "pending",
  "requires_action",
  "succeeded",
  "failed",
  "canceled",
] as const;
type RefundStatus = typeof refundStatuses[number];

type GuaranteeClaimRow = {
  id: string;
  instructor_profile_id: string;
  status: string;
  approved_refund_amount_cents: number | null;
};

type GuaranteeBillingRow = {
  first_stripe_customer_id: string | null;
};

type MembershipBillingRow = {
  stripe_customer_id: string | null;
};

type ExistingRefundRow = {
  guarantee_claim_id: string;
  instructor_profile_id: string;
  stripe_customer_id: string;
  stripe_charge_id: string | null;
  stripe_payment_intent_id: string | null;
  stripe_invoice_id: string | null;
  amount_cents: number;
  currency: string;
  stripe_status: string;
  failure_reason: string | null;
};

type ReservedRefundRow = {
  amount_cents: number;
};

type RefundRpcResult = {
  data: string | null;
  error: { code?: string; message: string } | null;
};

function refundStatus(value: string | null): RefundStatus | null {
  return refundStatuses.find((status) => status === value) ?? null;
}

function stripeFailure(error: unknown, operation: string): Response {
  if (error instanceof Stripe.errors.StripeError) {
    console.error(
      `Stripe ${operation} failed`,
      error.type,
      error.code ?? "no_code",
      error.requestId ?? "no_request_id",
    );
  } else {
    console.error(
      `Stripe ${operation} failed`,
      error instanceof Error ? error.message : "unknown_error",
    );
  }
  return json({ error: "Stripe is temporarily unavailable. Try again." }, 502);
}

const stripe = new Stripe(requiredEnv("STRIPE_SECRET_KEY"));

export default {
  fetch: withSupabase<any>({
    auth: "user",
    cors: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers":
        "authorization, x-client-info, apikey, content-type",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
    },
  }, async (req, ctx) => {
    if (req.method !== "POST") {
      return json({ error: "Method not allowed" }, 405);
    }

    const accountId = ctx.userClaims?.id;
    if (!accountId) return json({ error: "Authentication required" }, 401);

    const { data: ownerAccess, error: ownerError } = await ctx.supabaseAdmin
      .from("marketplace_admins")
      .select("account_id")
      .eq("account_id", accountId)
      .eq("is_owner", true)
      .maybeSingle();
    if (ownerError) {
      console.error("Unable to verify marketplace owner", ownerError.code);
      return json({ error: "Unable to verify administrator access" }, 500);
    }
    if (!ownerAccess) {
      return json({ error: "Marketplace owner access required" }, 403);
    }

    const body = await req.json().catch(() => ({})) as {
      claimId?: string;
      refundId?: string;
    };
    const claimId = body.claimId?.trim() ?? "";
    const refundId = body.refundId?.trim() ?? "";
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
        .test(claimId)
    ) {
      return json({ error: "A valid guarantee claim is required" }, 400);
    }
    if (!/^re_[A-Za-z0-9]{8,128}$/.test(refundId)) {
      return json(
        { error: "Enter the Stripe refund ID beginning with re_" },
        400,
      );
    }

    const { data: claimData, error: claimError } = await ctx.supabaseAdmin
      .from("guarantee_claims")
      .select("id,instructor_profile_id,status,approved_refund_amount_cents")
      .eq("id", claimId)
      .maybeSingle();
    if (claimError) {
      console.error("Unable to load guarantee claim", claimError.code);
      return json({ error: "Unable to load the guarantee claim" }, 500);
    }
    const claim = claimData as GuaranteeClaimRow | null;
    if (!claim) return json({ error: "Guarantee claim not found" }, 404);
    if (
      !["approved", "refund_pending", "partially_refunded", "refunded"]
        .includes(claim.status)
    ) {
      return json({
        error: "Approve the guarantee claim before verifying a refund",
      }, 409);
    }
    if (
      !claim.approved_refund_amount_cents ||
      claim.approved_refund_amount_cents <= 0
    ) {
      return json({
        error: "The guarantee claim needs an approved refund amount",
      }, 409);
    }

    const [
      { data: guaranteeData, error: guaranteeError },
      { data: membershipData, error: membershipError },
    ] = await Promise.all([
      ctx.supabaseAdmin
        .from("instructor_guarantees")
        .select("first_stripe_customer_id")
        .eq("instructor_profile_id", claim.instructor_profile_id)
        .maybeSingle(),
      ctx.supabaseAdmin
        .from("instructor_memberships")
        .select("stripe_customer_id")
        .eq("instructor_profile_id", claim.instructor_profile_id)
        .maybeSingle(),
    ]);
    if (guaranteeError || membershipError) {
      console.error(
        "Unable to load instructor billing identity",
        guaranteeError?.code,
        membershipError?.code,
      );
      return json(
        { error: "Unable to verify the instructor billing identity" },
        500,
      );
    }
    const guarantee = guaranteeData as GuaranteeBillingRow | null;
    const membership = membershipData as MembershipBillingRow | null;

    let refund: Stripe.Refund;
    try {
      refund = await stripe.refunds.retrieve(refundId, { expand: ["charge"] });
    } catch (error) {
      if (
        error instanceof Stripe.errors.StripeInvalidRequestError &&
        (error.code === "resource_missing" || error.statusCode === 404)
      ) {
        return json({ error: "Stripe could not find that refund ID" }, 404);
      }
      return stripeFailure(error, "refund lookup");
    }

    try {
      const chargeId = objectId(refund.charge);
      if (!chargeId) {
        return json({ error: "Stripe refund is missing its charge" }, 409);
      }
      const charge = typeof refund.charge === "object" && refund.charge
        ? refund.charge as Stripe.Charge
        : await stripe.charges.retrieve(chargeId);

      if (!charge.paid) {
        return json(
          { error: "That refund is not attached to a paid charge" },
          409,
        );
      }

      const customerId = objectId(charge.customer);
      const expectedCustomers = new Set(
        [guarantee?.first_stripe_customer_id, membership?.stripe_customer_id]
          .filter((value): value is string =>
            typeof value === "string" && value.length > 0
          ),
      );
      if (!customerId || !expectedCustomers.has(customerId)) {
        return json({
          error: "That refund belongs to a different Stripe customer",
        }, 409);
      }

      const refundCustomerId = objectId(refund.customer);
      if (refundCustomerId && refundCustomerId !== customerId) {
        return json({
          error:
            "Stripe returned inconsistent customer details for that refund",
        }, 409);
      }

      const refundPaymentIntentId = objectId(refund.payment_intent);
      const chargePaymentIntentId = objectId(charge.payment_intent);
      if (
        refundPaymentIntentId &&
        chargePaymentIntentId &&
        refundPaymentIntentId !== chargePaymentIntentId
      ) {
        return json({
          error: "Stripe returned inconsistent payment details for that refund",
        }, 409);
      }
      const paymentIntentId = refundPaymentIntentId ?? chargePaymentIntentId;
      if (!paymentIntentId) {
        return json({
          error: "That refund is not attached to an invoice payment",
        }, 409);
      }

      const invoicePayments = await stripe.invoicePayments.list({
        payment: {
          type: "payment_intent",
          payment_intent: paymentIntentId,
        },
        status: "paid",
        limit: 2,
      });
      if (invoicePayments.has_more || invoicePayments.data.length !== 1) {
        return json({
          error:
            "Stripe could not isolate one paid membership invoice for that refund",
        }, 409);
      }

      const invoicePayment = invoicePayments.data[0];
      if (
        invoicePayment.status !== "paid" ||
        objectId(invoicePayment.payment.payment_intent) !== paymentIntentId ||
        invoicePayment.amount_paid === null ||
        invoicePayment.amount_paid < refund.amount ||
        invoicePayment.currency.toLowerCase() !== refund.currency.toLowerCase()
      ) {
        return json({
          error: "That refund does not match the paid invoice amount",
        }, 409);
      }

      const invoiceId = objectId(invoicePayment.invoice);
      if (!invoiceId) {
        return json({
          error: "That refund is not attached to a membership invoice",
        }, 409);
      }

      const invoice = await stripe.invoices.retrieve(invoiceId);
      if (
        objectId(invoice.customer) !== customerId ||
        invoice.currency.toLowerCase() !== refund.currency.toLowerCase() ||
        invoice.status !== "paid" ||
        invoice.amount_paid < refund.amount
      ) {
        return json({
          error: "That refund does not match the instructor's paid invoice",
        }, 409);
      }

      const subscriptionDetails = invoice.parent?.subscription_details;
      if (
        !subscriptionDetails ||
        subscriptionDetails.metadata?.product_line !== "hire_line_dancers" ||
        subscriptionDetails.metadata?.instructor_profile_id !==
          claim.instructor_profile_id
      ) {
        return json({
          error: "That refund is not for this instructor's membership",
        }, 409);
      }

      const expectedPriceId = requiredEnv("STRIPE_PRICE_ID");
      const lineItems = await stripe.invoices.listLineItems(invoiceId, {
        limit: 100,
      });
      if (lineItems.has_more) {
        return json({
          error: "That invoice has too many line items to verify safely",
        }, 409);
      }
      const hasMembershipLine = lineItems.data.some(
        (line) => line.amount !== 0 && linePriceId(line) === expectedPriceId,
      );
      const hasOtherPricedAmount = lineItems.data.some(
        (line) => line.amount !== 0 && linePriceId(line) !== expectedPriceId,
      );
      if (!hasMembershipLine || hasOtherPricedAmount) {
        return json({
          error: "That refund is not for the Hire Line Dancers membership",
        }, 409);
      }

      const stripeStatus = refundStatus(refund.status);
      if (!stripeStatus) {
        return json({
          error: "Stripe did not return a supported refund status",
        }, 409);
      }

      const { data: existingRefundData, error: existingRefundError } = await ctx
        .supabaseAdmin
        .from("membership_refunds")
        .select(
          "guarantee_claim_id,instructor_profile_id,stripe_customer_id,stripe_charge_id,stripe_payment_intent_id,stripe_invoice_id,amount_cents,currency,stripe_status,failure_reason",
        )
        .eq("stripe_refund_id", refund.id)
        .maybeSingle();
      if (existingRefundError) {
        console.error(
          "Unable to check the existing refund record",
          existingRefundError.code,
        );
        return json({ error: "Unable to check the refund record" }, 500);
      }
      const existingRefund = existingRefundData as ExistingRefundRow | null;
      if (
        existingRefund && (
          existingRefund.guarantee_claim_id !== claim.id ||
          existingRefund.instructor_profile_id !==
            claim.instructor_profile_id ||
          existingRefund.stripe_customer_id !== customerId ||
          existingRefund.stripe_charge_id !== chargeId ||
          existingRefund.stripe_payment_intent_id !== paymentIntentId ||
          existingRefund.stripe_invoice_id !== invoiceId ||
          existingRefund.amount_cents !== refund.amount ||
          existingRefund.currency !== refund.currency.toLowerCase()
        )
      ) {
        return json({
          error:
            "That Stripe refund is already associated with different records",
        }, 409);
      }
      if (claim.status === "refunded" && !existingRefund) {
        return json({
          error: "This guarantee claim has already been fully refunded",
        }, 409);
      }

      const { data: reservedRefundData, error: reservedRefundsError } =
        await ctx
          .supabaseAdmin
          .from("membership_refunds")
          .select("stripe_refund_id,amount_cents")
          .eq("guarantee_claim_id", claim.id)
          .in("stripe_status", ["pending", "requires_action", "succeeded"])
          .neq("stripe_refund_id", refund.id);
      if (reservedRefundsError) {
        console.error(
          "Unable to check prior refund amounts",
          reservedRefundsError.code,
        );
        return json({ error: "Unable to check prior refund amounts" }, 500);
      }
      const reservedRefunds = reservedRefundData as ReservedRefundRow[] | null;
      const reservedAmount = (reservedRefunds ?? []).reduce(
        (total, item) => total + item.amount_cents,
        0,
      );
      if (
        ["pending", "requires_action", "succeeded"].includes(stripeStatus) &&
        reservedAmount + refund.amount > claim.approved_refund_amount_cents
      ) {
        return json({
          error: "That refund exceeds the claim's approved amount",
        }, 409);
      }

      const failureReason = refund.failure_reason ?? null;
      if (
        existingRefund &&
        existingRefund.stripe_status === stripeStatus &&
        existingRefund.failure_reason === failureReason
      ) {
        return json({
          verified: true,
          completed: stripeStatus === "succeeded",
          idempotent: true,
          refundId: refund.id,
          stripeStatus,
          amountCents: refund.amount,
          claimStatus: claim.status,
        });
      }

      const applyRefundRpc = ctx.supabaseAdmin.rpc as unknown as (
        functionName: "apply_verified_membership_refund",
        args: Record<string, unknown>,
      ) => Promise<RefundRpcResult>;
      const { data: result, error: applyError } = await applyRefundRpc(
        "apply_verified_membership_refund",
        {
          p_claim_id: claim.id,
          p_stripe_refund_id: refund.id,
          p_stripe_customer_id: customerId,
          p_stripe_charge_id: chargeId,
          p_stripe_payment_intent_id: paymentIntentId,
          p_stripe_invoice_id: invoiceId,
          p_amount_cents: refund.amount,
          p_currency: refund.currency,
          p_stripe_status: stripeStatus,
          p_stripe_created_at: new Date(refund.created * 1000).toISOString(),
          p_recorded_by: accountId,
          p_event_id: null,
          p_failure_reason: failureReason,
        },
      );
      if (applyError) {
        console.error(
          "Unable to record verified Stripe refund",
          applyError.code,
          applyError.message,
        );
        return json({ error: "Unable to record the verified refund" }, 500);
      }

      return json({
        verified: true,
        completed: stripeStatus === "succeeded",
        idempotent: false,
        refundId: refund.id,
        stripeStatus,
        amountCents: refund.amount,
        claimStatus: result,
      });
    } catch (error) {
      return stripeFailure(error, "refund verification");
    }
  }),
};
