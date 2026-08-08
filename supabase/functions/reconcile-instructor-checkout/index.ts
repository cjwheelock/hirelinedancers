import { withSupabase } from "npm:@supabase/server@^1";
import Stripe from "npm:stripe@^22";
import {
  checkoutSessionHasExactCoupon,
  hldStripeConfig,
  instructorCheckoutOffer,
  membershipTermsState,
  requiredEnv,
  stripeObjectId,
  subscriptionHasExactCoupon,
  verifiedInstructorOfferCoupon,
  verifiedMembershipPrice,
  verifiedPaidMembershipInvoices,
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
      const session = await stripe.checkout.sessions.retrieve(sessionId, {
        expand: ["discounts"],
      });
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
        expand: ["items.data.price", "discounts"],
      });
      if (subscription.items.has_more) {
        return json({
          error: "This subscription has too many items to verify safely",
        }, 409);
      }
      const subscriptionCustomerId = stripeObjectId(subscription.customer);
      const membershipItems = subscription.items.data.filter((item) =>
        item.price.id === stripeConfig.priceId
      );
      const membershipItem = membershipItems[0] ?? null;
      const ownsSubscription =
        subscription.metadata?.instructor_profile_id === profile.id &&
        subscription.metadata?.account_id === accountId &&
        subscription.metadata?.product_line === "hire_line_dancers" &&
        subscriptionCustomerId === customerId;

      if (
        !subscriptionCustomerId || !ownsSubscription || !membershipItem ||
        membershipItems.length !== 1 || membershipItem.quantity !== 1 ||
        subscription.items.data.length !== 1
      ) {
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

      const sessionUsesCurrentTerms = membershipTermsState(session.metadata) ===
        "current";
      const subscriptionUsesCurrentTerms = membershipTermsState(
        subscription.metadata,
      ) === "current";
      if (sessionUsesCurrentTerms !== subscriptionUsesCurrentTerms) {
        return json({
          error: "The Checkout Session and subscription terms do not match",
        }, 409);
      }

      let checkoutOffer: ReturnType<typeof instructorCheckoutOffer> = null;
      if (sessionUsesCurrentTerms) {
        const sessionOffer = instructorCheckoutOffer(session.metadata);
        const subscriptionOffer = instructorCheckoutOffer(
          subscription.metadata,
        );
        if (
          sessionOffer?.invitationId !== subscriptionOffer?.invitationId ||
          sessionOffer?.offerCode !== subscriptionOffer?.offerCode ||
          sessionOffer?.couponId !== subscriptionOffer?.couponId
        ) {
          return json({
            error: "The Checkout Session and subscription offer do not match",
          }, 409);
        }

        const expectedCouponId = sessionOffer?.couponId ?? null;
        if (sessionOffer) {
          const configuredCoupon = await verifiedInstructorOfferCoupon(
            stripe,
            stripeConfig,
          );
          if (configuredCoupon.id !== sessionOffer.couponId) {
            return json({
              error: "The instructor offer Coupon does not match configuration",
            }, 409);
          }
        }
        if (
          session.allow_promotion_codes === true ||
          !checkoutSessionHasExactCoupon(session, expectedCouponId) ||
          !subscriptionHasExactCoupon(subscription, expectedCouponId)
        ) {
          return json({
            error: "The exact instructor offer Coupon was not applied",
          }, 409);
        }
        checkoutOffer = sessionOffer;
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

      let offerResult: string | null = null;
      if (checkoutOffer && result !== "stale_subscription") {
        const { data, error } = await ctx.supabaseAdmin.rpc(
          "redeem_instructor_checkout_offer",
          {
            p_instructor_profile_id: profile.id,
            p_instructor_invitation_id: checkoutOffer.invitationId,
            p_offer_code: checkoutOffer.offerCode,
            p_stripe_checkout_session_id: session.id,
            p_stripe_subscription_id: subscription.id,
          },
        );
        if (error) {
          console.error(
            "Unable to redeem the earned instructor offer",
            error.code,
            error.message,
          );
          return json({ error: "Unable to confirm your instructor offer" }, 500);
        }
        offerResult = data;
      }

      let paidInvoiceResult:
        | string[]
        | "ledger_current"
        | "zero_amount_ignored"
        | null = null;
      if (
        subscriptionUsesCurrentTerms &&
        result !== "stale_subscription"
      ) {
        const { data: recordedInvoices, error: recordedInvoicesError } =
          await ctx.supabaseAdmin
            .from("membership_paid_invoices")
            .select("stripe_invoice_id")
            .eq("instructor_profile_id", profile.id)
            .eq("stripe_subscription_id", subscription.id);
        if (recordedInvoicesError) {
          console.error(
            "Unable to inspect the paid invoice ledger",
            recordedInvoicesError.code,
          );
          return json({
            error: "Unable to confirm your membership payment yet",
          }, 500);
        }
        const paidInvoices = await verifiedPaidMembershipInvoices(
          stripe,
          stripeConfig,
          {
            customerId,
            subscriptionId: subscription.id,
            instructorProfileId: profile.id,
          },
          undefined,
          (recordedInvoices ?? []).map((invoice) =>
            invoice.stripe_invoice_id
          ),
        );
        if (paidInvoices.length > 0) {
          const results: string[] = [];
          for (const paidInvoice of paidInvoices) {
            const { data, error } = await ctx.supabaseAdmin.rpc(
              "record_membership_paid_invoice",
              {
                p_instructor_profile_id: profile.id,
                p_stripe_invoice_id: paidInvoice.invoiceId,
                p_stripe_customer_id: paidInvoice.customerId,
                p_stripe_subscription_id: paidInvoice.subscriptionId,
                p_stripe_price_id: paidInvoice.priceId,
                p_amount_paid_cents: paidInvoice.amountPaidCents,
                p_currency: paidInvoice.currency,
                p_paid_at: paidInvoice.paidAt,
                p_billing_reason: paidInvoice.billingReason,
                p_livemode: paidInvoice.livemode,
                p_source_event_id:
                  `hld-reconcile-invoice:${session.id}:${paidInvoice.invoiceId}`,
              },
            );
            if (error) {
              console.error(
                "Unable to record the paid membership invoice",
                error.code,
                error.message,
              );
              return json({
                error: "Unable to confirm your membership payment yet",
              }, 500);
            }
            results.push(data);
          }
          paidInvoiceResult = results;
        } else {
          paidInvoiceResult = (recordedInvoices ?? []).length > 0
            ? "ledger_current"
            : "zero_amount_ignored";
        }
      }

      return json({
        reconciled: true,
        membershipStatus,
        result,
        offerResult,
        paidInvoiceResult,
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
