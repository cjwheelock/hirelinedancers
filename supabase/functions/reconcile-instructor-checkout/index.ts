import { withSupabase } from "npm:@supabase/server@^1";
import Stripe from "npm:stripe@^22";
import {
  hldStripeConfig,
  requiredEnv,
  stripeObjectId,
  verifiedMembershipPrice,
} from "../_shared/hld-stripe.ts";

function json(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function validCheckoutSessionId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return /^cs_(?:live|test)_[A-Za-z0-9]+$/.test(trimmed) ? trimmed : null;
}

function normalizedStatus(status: Stripe.Subscription.Status): string {
  switch (status) {
    case "active":
    case "trialing":
    case "past_due":
    case "paused":
    case "canceled":
    case "unpaid":
      return status;
    case "incomplete":
    case "incomplete_expired":
    default:
      return "inactive";
  }
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

    let requestBody: { sessionId?: unknown };
    try {
      requestBody = await req.json();
    } catch {
      return json({ error: "A Checkout Session reference is required" }, 400);
    }
    const sessionId = validCheckoutSessionId(requestBody.sessionId);
    if (!sessionId) {
      return json(
        { error: "A valid Checkout Session reference is required" },
        400,
      );
    }

    let stripeConfig: ReturnType<typeof hldStripeConfig>;
    try {
      stripeConfig = hldStripeConfig();
      await verifiedMembershipPrice(stripe, stripeConfig);
    } catch (error) {
      const message = error instanceof Error
        ? error.message
        : "Unknown Stripe configuration error";
      console.error(
        "Checkout reconciliation configuration is invalid",
        message,
      );
      return json(
        { error: "Membership checkout is not configured correctly" },
        500,
      );
    }

    const { data: profile, error: profileError } = await ctx.supabaseAdmin
      .from("instructor_profiles")
      .select("id, status, approved_at")
      .eq("account_id", accountId)
      .maybeSingle();

    if (profileError) {
      console.error(
        "Unable to read instructor profile for reconciliation",
        profileError.code,
      );
      return json({ error: "Unable to load the instructor profile" }, 500);
    }
    if (
      !profile ||
      !profile.approved_at ||
      !["approved", "published", "suspended"].includes(profile.status)
    ) {
      return json({ error: "An approved instructor profile is required" }, 403);
    }

    const [
      { data: settings, error: settingsError },
      { data: lifetimeAccess, error: lifetimeAccessError },
    ] = await Promise.all([
      ctx.supabaseAdmin
        .from("instructor_private_settings")
        .select("stripe_customer_id")
        .eq("instructor_profile_id", profile.id)
        .maybeSingle(),
      ctx.supabaseAdmin
        .from("instructor_lifetime_access")
        .select("instructor_profile_id")
        .eq("instructor_profile_id", profile.id)
        .maybeSingle(),
    ]);

    if (settingsError || lifetimeAccessError) {
      console.error(
        "Unable to verify checkout reconciliation ownership",
        settingsError?.code ?? lifetimeAccessError?.code,
      );
      return json({ error: "Unable to verify membership ownership" }, 500);
    }
    if (lifetimeAccess) {
      return json({
        error:
          "This instructor has lifetime access and does not need Stripe billing",
        code: "lifetime_access",
      }, 409);
    }
    if (!settings?.stripe_customer_id) {
      return json(
        { error: "No membership checkout is available to reconcile" },
        409,
      );
    }

    try {
      const observedAt = new Date().toISOString();
      const session = await stripe.checkout.sessions.retrieve(sessionId);
      const customerId = stripeObjectId(session.customer);
      const subscriptionId = stripeObjectId(session.subscription);
      const ownsSession = Boolean(customerId) &&
        session.client_reference_id === profile.id &&
        session.metadata?.instructor_profile_id === profile.id &&
        session.metadata?.account_id === accountId &&
        session.metadata?.product_line === "hire_line_dancers" &&
        customerId === settings.stripe_customer_id;

      if (!customerId || !ownsSession) {
        console.warn(
          "Rejected Checkout reconciliation ownership mismatch",
          session.id,
          profile.id,
        );
        return json({
          error:
            "This Checkout Session does not belong to your instructor profile",
        }, 403);
      }
      if (session.livemode !== stripeConfig.expectedLivemode) {
        console.error(
          "Checkout Session is in the wrong Stripe mode",
          session.id,
        );
        return json({
          error: "Membership checkout is not configured correctly",
        }, 500);
      }
      if (
        session.mode !== "subscription" ||
        session.status !== "complete" ||
        !["paid", "no_payment_required"].includes(session.payment_status) ||
        !subscriptionId
      ) {
        return json({
          error: "Stripe is still confirming this checkout",
          code: "checkout_pending",
        }, 409);
      }

      const subscription = await stripe.subscriptions.retrieve(subscriptionId, {
        expand: ["items.data.price"],
      });
      const subscriptionCustomerId = stripeObjectId(subscription.customer);
      const membershipItem = subscription.items.data.find((item) =>
        item.price.id === stripeConfig.priceId
      );
      const ownsSubscription =
        subscription.metadata?.instructor_profile_id === profile.id &&
        subscription.metadata?.account_id === accountId &&
        subscription.metadata?.product_line === "hire_line_dancers" &&
        subscriptionCustomerId === customerId;

      if (!subscriptionCustomerId || !ownsSubscription || !membershipItem) {
        console.warn(
          "Rejected Checkout reconciliation subscription mismatch",
          session.id,
          subscription.id,
        );
        return json({
          error: "This subscription does not match your instructor membership",
        }, 403);
      }
      if (subscription.livemode !== stripeConfig.expectedLivemode) {
        console.error(
          "Subscription is in the wrong Stripe mode",
          subscription.id,
        );
        return json({
          error: "Membership checkout is not configured correctly",
        }, 500);
      }

      const membershipStatus = normalizedStatus(subscription.status);
      const latestInvoiceId = stripeObjectId(subscription.latest_invoice);
      const eventId = [
        "hld-reconcile",
        session.id,
        subscription.id,
        membershipStatus,
        membershipItem.current_period_end,
        subscription.cancel_at_period_end ? "canceling" : "renewing",
      ].join(":");

      const { data: result, error: syncError } = await ctx.supabaseAdmin.rpc(
        "apply_stripe_subscription_event",
        {
          p_event_id: eventId,
          p_event_type: "checkout.session.reconciled",
          p_event_created_at: observedAt,
          p_api_version: "authenticated-reconciliation-v1",
          p_livemode: subscription.livemode,
          p_instructor_profile_id: profile.id,
          p_customer_id: customerId,
          p_subscription_id: subscription.id,
          p_price_id: membershipItem.price.id,
          p_status: membershipStatus,
          p_current_period_start: new Date(
            membershipItem.current_period_start * 1000,
          ).toISOString(),
          p_current_period_end: new Date(
            membershipItem.current_period_end * 1000,
          ).toISOString(),
          p_cancel_at_period_end: subscription.cancel_at_period_end,
          p_checkout_session_id: session.id,
          p_latest_invoice_id: latestInvoiceId,
          p_subscription_created_at: new Date(subscription.created * 1000)
            .toISOString(),
          p_observed_at: observedAt,
        },
      );

      if (syncError) {
        console.error(
          "Authenticated Checkout reconciliation failed",
          syncError.code,
          syncError.message,
        );
        return json({ error: "Unable to confirm your membership yet" }, 500);
      }
      if (result === "lifetime_access_ignored") {
        return json({
          error:
            "This instructor has lifetime access and does not need Stripe billing",
          code: "lifetime_access",
        }, 409);
      }

      return json({
        reconciled: true,
        membershipStatus,
        result,
      });
    } catch (error) {
      const message = error instanceof Error
        ? error.message
        : "Unknown Stripe reconciliation error";
      console.error("Checkout reconciliation failed", message);
      return json({ error: "Unable to confirm your membership yet" }, 502);
    }
  }),
};
