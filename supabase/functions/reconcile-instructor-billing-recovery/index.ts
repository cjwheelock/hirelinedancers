import { withSupabase } from "npm:@supabase/server@^1";
import Stripe from "npm:stripe@^22";
import {
  hldStripeConfig,
  requiredEnv,
  stripeInvoiceSubscriptionId,
  stripeObjectId,
  verifiedMembershipPrice,
} from "../_shared/hld-stripe.ts";

function json(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function paymentFailure(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as {
    type?: unknown;
    code?: unknown;
    statusCode?: unknown;
  };
  return candidate.type === "StripeCardError" ||
    candidate.statusCode === 402 ||
    (typeof candidate.code === "string" && candidate.code.includes("card"));
}

const stripe = new Stripe(requiredEnv("STRIPE_SECRET_KEY"));

export default {
  fetch: withSupabase<any>({ auth: "user" }, async (req, ctx) => {
    if (req.method !== "POST") {
      return json({ error: "Method not allowed" }, 405);
    }

    const accountId = ctx.userClaims?.id;
    if (!accountId) return json({ error: "Authentication required" }, 401);

    let stripeConfig: ReturnType<typeof hldStripeConfig>;
    try {
      stripeConfig = hldStripeConfig();
      await verifiedMembershipPrice(stripe, stripeConfig);
    } catch (error) {
      console.error(
        "Billing recovery configuration is invalid",
        error instanceof Error ? error.message : "unknown_configuration_error",
      );
      return json({ error: "Membership billing is not configured correctly" }, 500);
    }

    const { data: profile, error: profileError } = await ctx.supabaseAdmin
      .from("instructor_profiles")
      .select("id")
      .eq("account_id", accountId)
      .maybeSingle();
    if (profileError) {
      console.error("Unable to read instructor profile", profileError.code);
      return json({ error: "Unable to load the instructor profile" }, 500);
    }
    if (!profile) {
      return json({ error: "An instructor profile is required" }, 403);
    }

    const [{ data: recovery, error: recoveryError }, {
      data: membership,
      error: membershipError,
    }] = await Promise.all([
      ctx.supabaseAdmin
        .from("instructor_billing_recoveries")
        .select(
          "id,stripe_customer_id,stripe_subscription_id,latest_stripe_invoice_id,status",
        )
        .eq("instructor_profile_id", profile.id)
        .in("status", ["grace_period", "access_paused"])
        .maybeSingle(),
      ctx.supabaseAdmin
        .from("instructor_memberships")
        .select(
          "stripe_customer_id,stripe_subscription_id,stripe_price_id,status",
        )
        .eq("instructor_profile_id", profile.id)
        .maybeSingle(),
    ]);
    if (recoveryError || membershipError) {
      console.error(
        "Unable to load instructor billing recovery",
        recoveryError?.code ?? membershipError?.code,
      );
      return json({ error: "Unable to load billing recovery" }, 500);
    }
    if (!recovery) {
      return json({
        reconciled: true,
        recovered: true,
        message: "No unresolved membership payment remains.",
      });
    }
    if (
      !membership ||
      membership.stripe_customer_id !== recovery.stripe_customer_id ||
      membership.stripe_subscription_id !== recovery.stripe_subscription_id ||
      membership.stripe_price_id !== stripeConfig.priceId
    ) {
      return json({
        error: "The billing recovery does not match this membership",
        code: "billing_recovery_mismatch",
      }, 409);
    }

    try {
      const [customer, subscription, invoice] = await Promise.all([
        stripe.customers.retrieve(recovery.stripe_customer_id, {
          expand: ["invoice_settings.default_payment_method"],
        }),
        stripe.subscriptions.retrieve(recovery.stripe_subscription_id, {
          expand: ["items.data.price"],
        }),
        stripe.invoices.retrieve(recovery.latest_stripe_invoice_id),
      ]);

      if (customer.deleted || customer.livemode !== stripeConfig.expectedLivemode) {
        return json({ error: "The Stripe customer is no longer available" }, 409);
      }
      const membershipItems = subscription.items.data.filter((item) =>
        item.price.id === stripeConfig.priceId
      );
      if (
        subscription.livemode !== stripeConfig.expectedLivemode ||
        stripeObjectId(subscription.customer) !== recovery.stripe_customer_id ||
        membershipItems.length !== 1 || membershipItems[0].quantity !== 1 ||
        subscription.items.data.length !== 1
      ) {
        return json({
          error: "The Stripe subscription does not match this membership",
          code: "subscription_mismatch",
        }, 409);
      }

      if (
        invoice.livemode !== stripeConfig.expectedLivemode ||
        stripeObjectId(invoice.customer) !== recovery.stripe_customer_id ||
        stripeInvoiceSubscriptionId(invoice) !== recovery.stripe_subscription_id
      ) {
        return json({
          error: "The overdue invoice does not match this membership",
          code: "invoice_mismatch",
        }, 409);
      }
      if (invoice.status === "paid") {
        return json({
          reconciled: true,
          recovered: true,
          paymentStatus: "paid",
          message: "Stripe has already confirmed the overdue payment.",
        });
      }
      if (invoice.status !== "open" || invoice.amount_remaining <= 0) {
        return json({
          error: "The overdue invoice is not available for payment",
          code: "invoice_not_payable",
        }, 409);
      }

      const paymentMethodId = stripeObjectId(
        customer.invoice_settings.default_payment_method,
      );
      if (!paymentMethodId) {
        return json({
          error: "Add a new card in Stripe before checking the payment again",
          code: "payment_method_required",
        }, 409);
      }
      const paymentMethod = await stripe.paymentMethods.retrieve(paymentMethodId);
      if (
        paymentMethod.type !== "card" || !paymentMethod.card ||
        paymentMethod.livemode !== stripeConfig.expectedLivemode ||
        stripeObjectId(paymentMethod.customer) !== recovery.stripe_customer_id
      ) {
        return json({
          error: "The updated Stripe payment method is not an attached card",
          code: "payment_method_invalid",
        }, 409);
      }

      if (
        stripeObjectId(subscription.default_payment_method) !== paymentMethodId
      ) {
        await stripe.subscriptions.update(
          subscription.id,
          {
            default_payment_method: paymentMethodId,
            payment_settings: { save_default_payment_method: "on_subscription" },
          },
          {
            idempotencyKey:
              `hld-billing-recovery-method-${recovery.id}-${paymentMethodId}`,
          },
        );
      }

      const paidInvoice = await stripe.invoices.pay(
        invoice.id,
        { payment_method: paymentMethodId, off_session: true },
        {
          idempotencyKey:
            `hld-billing-recovery-pay-${recovery.id}-${invoice.attempt_count}-${paymentMethodId}`,
        },
      );

      return json({
        reconciled: true,
        recovered: paidInvoice.status === "paid",
        paymentStatus: paidInvoice.status,
        message: paidInvoice.status === "paid"
          ? "Stripe confirmed the overdue payment. Your membership is being restored."
          : "Stripe is still processing the overdue payment.",
      });
    } catch (error) {
      const message = error instanceof Error
        ? error.message
        : "unknown_stripe_error";
      console.error("Instructor billing recovery failed", message);
      if (paymentFailure(error)) {
        return json({
          error:
            "Stripe could not collect the overdue payment with that card. Try another card or contact support.",
          code: "payment_failed",
        }, 402);
      }
      return json({
        error:
          "Unable to confirm the updated payment method. Try again or contact support.",
      }, 502);
    }
  }),
};
