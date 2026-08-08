import { withSupabase } from "npm:@supabase/server@^1";
import Stripe from "npm:stripe@^22";
import {
  checkoutSessionHasExactCoupon,
  hldStripeConfig,
  instructorCheckoutOffer,
  MEMBERSHIP_GUARANTEE_TERMS_VERSION,
  membershipTermsState,
  requiredEnv,
  stripeInvoiceSubscriptionId,
  stripeObjectId,
  subscriptionHasExactCoupon,
  verifiedInstructorOfferCoupon,
  verifiedMembershipPrice,
  verifiedPaidMembershipInvoices,
} from "../_shared/hld-stripe.ts";

function validUuid(value: string | null | undefined): string | null {
  if (!value) return null;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      .test(value)
    ? value
    : null;
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

function eventSubscriptionId(event: Stripe.Event): {
  subscriptionId: string | null;
  instructorProfileId: string | null;
  checkoutSessionId: string | null;
} {
  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    return {
      subscriptionId: stripeObjectId(session.subscription),
      instructorProfileId: validUuid(
        session.metadata?.instructor_profile_id ?? session.client_reference_id,
      ),
      checkoutSessionId: session.id,
    };
  }

  if (event.type === "invoice.paid" || event.type === "invoice.payment_failed") {
    const invoice = event.data.object as Stripe.Invoice;
    return {
      subscriptionId: stripeInvoiceSubscriptionId(invoice),
      instructorProfileId: null,
      checkoutSessionId: null,
    };
  }

  if (event.type.startsWith("customer.subscription.")) {
    const subscription = event.data.object as Stripe.Subscription;
    return {
      subscriptionId: subscription.id,
      instructorProfileId: validUuid(
        subscription.metadata?.instructor_profile_id,
      ),
      checkoutSessionId: null,
    };
  }

  return {
    subscriptionId: null,
    instructorProfileId: null,
    checkoutSessionId: null,
  };
}

const handledEvents = new Set<string>([
  "checkout.session.completed",
  "invoice.paid",
  "invoice.payment_failed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "customer.subscription.paused",
  "customer.subscription.resumed",
]);

const stripe = new Stripe(requiredEnv("STRIPE_SECRET_KEY"));
const cryptoProvider = Stripe.createSubtleCryptoProvider();

export default {
  fetch: withSupabase<any>({ auth: "none", cors: false }, async (req, ctx) => {
    if (req.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }

    const signature = req.headers.get("stripe-signature");
    if (!signature) {
      return new Response("Missing Stripe signature", { status: 400 });
    }

    const rawBody = await req.text();
    let event: Stripe.Event;
    try {
      event = await stripe.webhooks.constructEventAsync(
        rawBody,
        signature,
        requiredEnv("STRIPE_WEBHOOK_SIGNING_SECRET"),
        undefined,
        cryptoProvider,
      );
    } catch (error) {
      const message = error instanceof Error
        ? error.message
        : "Signature verification failed";
      console.warn("Rejected Stripe webhook", message);
      return new Response("Invalid Stripe signature", { status: 400 });
    }

    let stripeConfig: ReturnType<typeof hldStripeConfig>;
    try {
      stripeConfig = hldStripeConfig();
    } catch (error) {
      const message = error instanceof Error
        ? error.message
        : "Invalid Stripe mode configuration";
      console.error("Stripe webhook mode configuration failed", message);
      return new Response("Stripe webhook is not configured", { status: 500 });
    }

    if (event.livemode !== stripeConfig.expectedLivemode) {
      console.warn(
        "Rejected Stripe webhook with unexpected livemode",
        event.id,
        event.livemode,
        stripeConfig.expectedLivemode,
      );
      return new Response("Unexpected Stripe mode", { status: 400 });
    }

    if (!handledEvents.has(event.type)) {
      return Response.json({ received: true, ignored: true });
    }

    const identifiers = eventSubscriptionId(event);
    if (!identifiers.subscriptionId) {
      console.info(
        "Ignoring Stripe event without a subscription",
        event.id,
        event.type,
      );
      return Response.json({ received: true, ignored: true });
    }

    try {
      const observedAt = new Date().toISOString();
      const subscription = await stripe.subscriptions.retrieve(
        identifiers.subscriptionId,
        { expand: ["items.data.price", "discounts"] },
      );
      if (subscription.livemode !== stripeConfig.expectedLivemode) {
        throw new Error("Subscription is in the wrong Stripe mode");
      }
      if (subscription.items.has_more) {
        throw new Error("Subscription has too many items to verify safely");
      }

      const expectedPriceId = stripeConfig.priceId;
      const membershipItems = subscription.items.data.filter((item) =>
        item.price.id === expectedPriceId
      );
      const membershipItem = membershipItems[0] ?? null;
      if (
        membershipItem &&
        (membershipItems.length !== 1 || membershipItem.quantity !== 1 ||
          subscription.items.data.length !== 1)
      ) {
        throw new Error(
          "Subscription is not exactly one instructor membership",
        );
      }

      const customerId = stripeObjectId(subscription.customer);
      if (!customerId) {
        throw new Error("Subscription is missing a customer identifier");
      }

      let instructorProfileId = validUuid(
        subscription.metadata?.instructor_profile_id,
      ) ?? identifiers.instructorProfileId;
      const subscriptionUsesCurrentTerms = membershipTermsState(
        subscription.metadata,
      ) === "current";
      if (subscriptionUsesCurrentTerms && !instructorProfileId) {
        throw new Error(
          "Current membership terms require an instructor profile identifier",
        );
      }

      let checkoutSession: Stripe.Checkout.Session | null = null;
      let checkoutOffer: ReturnType<typeof instructorCheckoutOffer> = null;
      if (event.type === "checkout.session.completed") {
        checkoutSession = await stripe.checkout.sessions.retrieve(
          identifiers.checkoutSessionId!,
          { expand: ["discounts"] },
        );
        const sessionCustomerId = stripeObjectId(checkoutSession.customer);
        const sessionSubscriptionId = stripeObjectId(
          checkoutSession.subscription,
        );
        const sessionProfileId = validUuid(
          checkoutSession.metadata?.instructor_profile_id ??
            checkoutSession.client_reference_id,
        );
        const sessionAccountId = validUuid(
          checkoutSession.metadata?.account_id,
        );
        const subscriptionAccountId = validUuid(
          subscription.metadata?.account_id,
        );

        if (
          checkoutSession.livemode !== stripeConfig.expectedLivemode ||
          checkoutSession.mode !== "subscription" ||
          checkoutSession.status !== "complete" ||
          !["paid", "no_payment_required"].includes(
            checkoutSession.payment_status,
          ) ||
          sessionCustomerId !== customerId ||
          sessionSubscriptionId !== subscription.id ||
          !sessionProfileId ||
          sessionProfileId !== instructorProfileId ||
          !sessionAccountId ||
          sessionAccountId !== subscriptionAccountId ||
          checkoutSession.metadata?.product_line !== "hire_line_dancers" ||
          subscription.metadata?.product_line !== "hire_line_dancers" ||
          !membershipItem
        ) {
          throw new Error(
            "Completed Checkout Session does not match the instructor membership",
          );
        }

        const sessionUsesCurrentTerms = membershipTermsState(
          checkoutSession.metadata,
        ) === "current";
        if (sessionUsesCurrentTerms !== subscriptionUsesCurrentTerms) {
          throw new Error(
            "Checkout and subscription membership terms do not match",
          );
        }

        if (sessionUsesCurrentTerms) {
          await verifiedMembershipPrice(stripe, stripeConfig);
          const sessionOffer = instructorCheckoutOffer(
            checkoutSession.metadata,
          );
          const subscriptionOffer = instructorCheckoutOffer(
            subscription.metadata,
          );
          if (
            sessionOffer?.invitationId !== subscriptionOffer?.invitationId ||
            sessionOffer?.offerCode !== subscriptionOffer?.offerCode ||
            sessionOffer?.couponId !== subscriptionOffer?.couponId
          ) {
            throw new Error(
              "Checkout and subscription offer metadata do not match",
            );
          }

          const expectedCouponId = sessionOffer?.couponId ?? null;
          if (sessionOffer) {
            const configuredCoupon = await verifiedInstructorOfferCoupon(
              stripe,
              stripeConfig,
            );
            if (configuredCoupon.id !== sessionOffer.couponId) {
              throw new Error(
                "Checkout used a different instructor offer Coupon",
              );
            }
          }
          if (
            checkoutSession.allow_promotion_codes === true ||
            !checkoutSessionHasExactCoupon(
              checkoutSession,
              expectedCouponId,
            ) ||
            !subscriptionHasExactCoupon(subscription, expectedCouponId)
          ) {
            throw new Error(
              "Checkout did not apply the exact instructor offer Coupon",
            );
          }
          checkoutOffer = sessionOffer;
        }
      }

      let membershipStatus = normalizedStatus(subscription.status);
      let currentPeriodStart = membershipItem
        ? new Date(membershipItem.current_period_start * 1000).toISOString()
        : null;
      let currentPeriodEnd = membershipItem
        ? new Date(membershipItem.current_period_end * 1000).toISOString()
        : null;

      if (!membershipItem) {
        const { data: canonicalMembership, error: membershipError } = await ctx
          .supabaseAdmin
          .from("instructor_memberships")
          .select(
            "instructor_profile_id, current_period_start, current_period_end",
          )
          .eq("stripe_subscription_id", subscription.id)
          .eq("stripe_price_id", expectedPriceId)
          .maybeSingle();

        if (membershipError) {
          throw new Error(
            `Unable to identify the canonical HLD subscription: ${membershipError.code}`,
          );
        }
        if (!canonicalMembership) {
          console.info(
            "Ignoring Stripe event for another product line",
            event.id,
            subscription.id,
          );
          return Response.json({ received: true, ignored: true });
        }

        console.warn(
          "Configured HLD price was removed from the canonical subscription; revoking membership",
          event.id,
          subscription.id,
        );
        instructorProfileId = validUuid(
          canonicalMembership.instructor_profile_id,
        );
        membershipStatus = "inactive";
        currentPeriodStart = canonicalMembership.current_period_start;
        currentPeriodEnd = canonicalMembership.current_period_end;
      }

      const latestInvoiceId = stripeObjectId(subscription.latest_invoice);
      const { data: syncResult, error: syncError } = await ctx.supabaseAdmin.rpc(
        "apply_stripe_subscription_event",
        {
          p_event_id: event.id,
          p_event_type: event.type,
          p_event_created_at: new Date(event.created * 1000).toISOString(),
          p_api_version: event.api_version ?? null,
          p_livemode: event.livemode,
          p_instructor_profile_id: instructorProfileId,
          p_customer_id: customerId,
          p_subscription_id: subscription.id,
          p_price_id: expectedPriceId,
          p_status: membershipStatus,
          p_current_period_start: currentPeriodStart,
          p_current_period_end: currentPeriodEnd,
          p_cancel_at_period_end: subscription.cancel_at_period_end,
          p_checkout_session_id: checkoutSession?.id ?? null,
          p_latest_invoice_id: latestInvoiceId,
          p_subscription_created_at: new Date(subscription.created * 1000)
            .toISOString(),
          p_observed_at: observedAt,
        },
      );

      if (syncError) {
        console.error(
          "Stripe subscription sync failed",
          event.id,
          syncError.code,
          syncError.message,
        );
        return new Response("Subscription sync failed", { status: 500 });
      }

      let offerResult: string | null = null;
      if (
        checkoutSession && checkoutOffer &&
        syncResult !== "lifetime_access_ignored" &&
        syncResult !== "stale_subscription"
      ) {
        const { data, error } = await ctx.supabaseAdmin.rpc(
          "redeem_instructor_checkout_offer",
          {
            p_instructor_profile_id: instructorProfileId,
            p_instructor_invitation_id: checkoutOffer.invitationId,
            p_offer_code: checkoutOffer.offerCode,
            p_stripe_checkout_session_id: checkoutSession.id,
            p_stripe_subscription_id: subscription.id,
          },
        );
        if (error) {
          throw new Error(
            `Unable to redeem the earned instructor offer: ${error.code}`,
          );
        }
        offerResult = data;
      }

      let paidInvoiceResult:
        | string[]
        | "stale_subscription_ignored"
        | "zero_amount_ignored"
        | null = null;
      let staleSubscriptionIsGuaranteeSource = false;
      if (
        event.type === "invoice.paid" &&
        syncResult === "stale_subscription" && instructorProfileId
      ) {
        const { data: guaranteeSource, error: guaranteeSourceError } = await ctx
          .supabaseAdmin
          .from("instructor_guarantees")
          .select(
            "guarantee_terms_version,first_stripe_customer_id,first_stripe_subscription_id",
          )
          .eq("instructor_profile_id", instructorProfileId)
          .maybeSingle();
        if (guaranteeSourceError) {
          throw new Error(
            `Unable to verify the stale subscription guarantee source: ${guaranteeSourceError.code}`,
          );
        }
        staleSubscriptionIsGuaranteeSource =
          guaranteeSource?.guarantee_terms_version ===
            MEMBERSHIP_GUARANTEE_TERMS_VERSION &&
          guaranteeSource?.first_stripe_customer_id === customerId &&
          guaranteeSource?.first_stripe_subscription_id === subscription.id;
        if (!staleSubscriptionIsGuaranteeSource) {
          paidInvoiceResult = "stale_subscription_ignored";
        }
      }
      if (
        event.type === "invoice.paid" && subscriptionUsesCurrentTerms &&
        instructorProfileId && syncResult !== "lifetime_access_ignored" &&
        (syncResult !== "stale_subscription" ||
          staleSubscriptionIsGuaranteeSource)
      ) {
        await verifiedMembershipPrice(stripe, stripeConfig);
        const eventInvoice = event.data.object as Stripe.Invoice;
        const { data: recordedInvoices, error: recordedInvoicesError } =
          await ctx.supabaseAdmin
            .from("membership_paid_invoices")
            .select("stripe_invoice_id")
            .eq("instructor_profile_id", instructorProfileId)
            .eq("stripe_subscription_id", subscription.id);
        if (recordedInvoicesError) {
          throw new Error(
            `Unable to inspect the paid invoice ledger: ${recordedInvoicesError.code}`,
          );
        }
        const paidInvoices = await verifiedPaidMembershipInvoices(
          stripe,
          stripeConfig,
          {
            customerId,
            subscriptionId: subscription.id,
            instructorProfileId,
          },
          eventInvoice.id,
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
                p_instructor_profile_id: instructorProfileId,
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
                  `${event.id}:invoice:${paidInvoice.invoiceId}`,
              },
            );
            if (error) {
              throw new Error(
                `Unable to record the paid membership invoice: ${error.code}`,
              );
            }
            results.push(data);
          }
          paidInvoiceResult = results;
        } else {
          paidInvoiceResult = "zero_amount_ignored";
        }
      }

      console.info("Stripe subscription sync complete", event.id, syncResult);
      return Response.json({
        received: true,
        result: syncResult,
        offerResult,
        paidInvoiceResult,
      });
    } catch (error) {
      const message = error instanceof Error
        ? error.message
        : "Unknown subscription sync error";
      console.error("Stripe webhook processing failed", event.id, message);
      return new Response("Stripe webhook processing failed", { status: 500 });
    }
  }),
};
