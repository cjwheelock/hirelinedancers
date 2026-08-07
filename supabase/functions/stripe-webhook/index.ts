import { withSupabase } from "npm:@supabase/server@^1";
import Stripe from "npm:stripe@^22";
import { hldStripeConfig, requiredEnv } from "../_shared/hld-stripe.ts";

function objectId(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "id" in value && typeof value.id === "string") {
    return value.id;
  }
  return null;
}

function validUuid(value: string | null | undefined): string | null {
  if (!value) return null;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
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
      return status;
    case "unpaid":
      return "unpaid";
    case "incomplete":
    case "incomplete_expired":
    default:
      return "inactive";
  }
}

function invoiceSubscriptionId(invoice: Stripe.Invoice): string | null {
  const value = invoice as unknown as {
    subscription?: unknown;
    parent?: { subscription_details?: { subscription?: unknown } };
  };
  return objectId(value.subscription)
    ?? objectId(value.parent?.subscription_details?.subscription);
}

function eventSubscriptionId(event: Stripe.Event): {
  subscriptionId: string | null;
  instructorProfileId: string | null;
  checkoutSessionId: string | null;
} {
  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    return {
      subscriptionId: objectId(session.subscription),
      instructorProfileId: validUuid(
        session.metadata?.instructor_profile_id ?? session.client_reference_id,
      ),
      checkoutSessionId: session.id,
    };
  }

  if (event.type === "invoice.paid" || event.type === "invoice.payment_failed") {
    const invoice = event.data.object as Stripe.Invoice;
    return {
      subscriptionId: invoiceSubscriptionId(invoice),
      instructorProfileId: null,
      checkoutSessionId: null,
    };
  }

  if (event.type.startsWith("customer.subscription.")) {
    const subscription = event.data.object as Stripe.Subscription;
    return {
      subscriptionId: subscription.id,
      instructorProfileId: validUuid(subscription.metadata?.instructor_profile_id),
      checkoutSessionId: null,
    };
  }

  return { subscriptionId: null, instructorProfileId: null, checkoutSessionId: null };
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
    if (!signature) return new Response("Missing Stripe signature", { status: 400 });

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
      const message = error instanceof Error ? error.message : "Signature verification failed";
      console.warn("Rejected Stripe webhook", message);
      return new Response("Invalid Stripe signature", { status: 400 });
    }

    let stripeConfig: ReturnType<typeof hldStripeConfig>;
    try {
      stripeConfig = hldStripeConfig();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Invalid Stripe mode configuration";
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
      console.info("Ignoring Stripe event without a subscription", event.id, event.type);
      return Response.json({ received: true, ignored: true });
    }

    try {
      const observedAt = new Date().toISOString();
      const subscription = await stripe.subscriptions.retrieve(identifiers.subscriptionId, {
        expand: ["items.data.price"],
      });
      const expectedPriceId = stripeConfig.priceId;
      const membershipItem = subscription.items.data.find((item) => item.price.id === expectedPriceId);
      const customerId = objectId(subscription.customer);
      if (!customerId) throw new Error("Subscription is missing a customer identifier");

      let instructorProfileId = validUuid(subscription.metadata?.instructor_profile_id)
        ?? identifiers.instructorProfileId;
      let membershipStatus = normalizedStatus(subscription.status);
      let currentPeriodStart = membershipItem
        ? new Date(membershipItem.current_period_start * 1000).toISOString()
        : null;
      let currentPeriodEnd = membershipItem
        ? new Date(membershipItem.current_period_end * 1000).toISOString()
        : null;

      if (!membershipItem) {
        const { data: canonicalMembership, error: membershipError } = await ctx.supabaseAdmin
          .from("instructor_memberships")
          .select("instructor_profile_id, current_period_start, current_period_end")
          .eq("stripe_subscription_id", subscription.id)
          .eq("stripe_price_id", expectedPriceId)
          .maybeSingle();

        if (membershipError) {
          throw new Error(`Unable to identify the canonical HLD subscription: ${membershipError.code}`);
        }

        if (!canonicalMembership) {
          console.info("Ignoring Stripe event for another product line", event.id, subscription.id);
          return Response.json({ received: true, ignored: true });
        }

        console.warn(
          "Configured HLD price was removed from the canonical subscription; revoking membership",
          event.id,
          subscription.id,
        );
        instructorProfileId = validUuid(canonicalMembership.instructor_profile_id);
        membershipStatus = "inactive";
        currentPeriodStart = canonicalMembership.current_period_start;
        currentPeriodEnd = canonicalMembership.current_period_end;
      }

      const latestInvoiceId = objectId(subscription.latest_invoice);
      const { data, error } = await ctx.supabaseAdmin.rpc("apply_stripe_subscription_event", {
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
        p_checkout_session_id: identifiers.checkoutSessionId,
        p_latest_invoice_id: latestInvoiceId,
        p_subscription_created_at: new Date(subscription.created * 1000).toISOString(),
        p_observed_at: observedAt,
      });

      if (error) {
        console.error("Stripe subscription sync failed", event.id, error.code, error.message);
        return new Response("Subscription sync failed", { status: 500 });
      }

      console.info("Stripe subscription sync complete", event.id, data);
      return Response.json({ received: true, result: data });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown subscription sync error";
      console.error("Stripe webhook processing failed", event.id, message);
      return new Response("Stripe webhook processing failed", { status: 500 });
    }
  }),
};
