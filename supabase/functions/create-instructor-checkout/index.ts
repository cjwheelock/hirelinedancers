import { withSupabase } from "npm:@supabase/server@^1";
import Stripe from "npm:stripe@^22";
import {
  checkoutTermsRequired,
  hldStripeConfig,
  requiredEnv,
  verifiedMembershipPrice,
} from "../_shared/hld-stripe.ts";

const CHECKOUT_TERMS_VERSION = "2026-08-production-v1";

function requestKey(req: Request): string {
  const supplied = req.headers.get("Idempotency-Key")?.trim();
  if (supplied && /^[A-Za-z0-9_-]{8,64}$/.test(supplied)) return supplied;
  return crypto.randomUUID();
}

function json(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function stripeErrorCode(error: unknown): string | null {
  if (!error || typeof error !== "object") return null;
  const candidate = error as { code?: unknown; raw?: { code?: unknown } };
  if (typeof candidate.code === "string") return candidate.code;
  if (typeof candidate.raw?.code === "string") return candidate.raw.code;
  return null;
}

const stripe = new Stripe(requiredEnv("STRIPE_SECRET_KEY"));

export default {
  fetch: withSupabase({
    auth: "user",
    cors: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, idempotency-key",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
    },
  }, async (req, ctx) => {
    if (req.method !== "POST") {
      return json({ error: "Method not allowed" }, 405);
    }

    const accountId = ctx.userClaims?.id;
    if (!accountId) return json({ error: "Authentication required" }, 401);

    let stripeConfig: ReturnType<typeof hldStripeConfig>;
    let requireTermsConsent: boolean;
    try {
      stripeConfig = hldStripeConfig();
      requireTermsConsent = checkoutTermsRequired(stripeConfig);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown Stripe configuration error";
      console.error("Checkout configuration is invalid", message);
      return json({ error: "Membership checkout is not configured correctly" }, 500);
    }

    const priceId = stripeConfig.priceId;
    let key = requestKey(req);
    const now = new Date().toISOString();

    const { data: profile, error: profileError } = await ctx.supabaseAdmin
      .from("instructor_profiles")
      .select("id, status, approved_at")
      .eq("account_id", accountId)
      .maybeSingle();

    if (profileError) {
      console.error("Unable to read instructor profile", profileError.code);
      return json({ error: "Unable to load the instructor profile" }, 500);
    }
    if (!profile) {
      return json({
        error: "Checkout becomes available after your instructor profile is approved",
        code: "profile_not_approved",
      }, 403);
    }

    const { data: lifetimeAccess, error: lifetimeAccessError } = await ctx.supabaseAdmin
      .from("instructor_lifetime_access")
      .select("instructor_profile_id")
      .eq("instructor_profile_id", profile.id)
      .maybeSingle();

    if (lifetimeAccessError) {
      console.error("Unable to verify instructor access", lifetimeAccessError.code);
      return json({ error: "Unable to verify instructor access" }, 500);
    }
    if (lifetimeAccess) {
      return json({
        error: "This instructor has lifetime access and does not need Stripe checkout",
        code: "lifetime_access",
      }, 409);
    }
    if (profile.status !== "approved" || !profile.approved_at) {
      return json({
        error: "Checkout becomes available after your instructor profile is approved",
        code: "profile_not_approved",
      }, 403);
    }

    const { data: settings, error: settingsError } = await ctx.supabaseAdmin
      .from("instructor_private_settings")
      .select("inquiry_email, stripe_customer_id, stripe_subscription_id, subscription_status")
      .eq("instructor_profile_id", profile.id)
      .maybeSingle();

    if (settingsError || !settings?.inquiry_email) {
      console.error("Unable to read instructor billing settings", settingsError?.code);
      return json({ error: "Complete your instructor contact settings before checkout" }, 409);
    }

    if (["trialing", "active", "past_due", "unpaid", "paused"].includes(settings.subscription_status)) {
      return json({
        error: "This instructor already has a membership",
        code: "membership_exists",
      }, 409);
    }

    const { error: expireError } = await ctx.supabaseAdmin
      .from("stripe_checkout_attempts")
      .update({ status: "expired" })
      .eq("instructor_profile_id", profile.id)
      .eq("status", "open")
      .lte("expires_at", now);

    if (expireError) {
      console.error("Unable to expire old Checkout attempts", expireError.code);
      return json({ error: "Unable to prepare checkout" }, 500);
    }

    const { data: openAttempt } = await ctx.supabaseAdmin
      .from("stripe_checkout_attempts")
      .select("checkout_url, stripe_checkout_session_id, request_key, expires_at")
      .eq("instructor_profile_id", profile.id)
      .eq("status", "open")
      .gt("expires_at", now)
      .maybeSingle();

    if (openAttempt) {
      try {
        const existingSession = await stripe.checkout.sessions.retrieve(openAttempt.stripe_checkout_session_id);
        if (
          existingSession.status === "open"
          && existingSession.metadata?.checkout_terms_version === CHECKOUT_TERMS_VERSION
        ) {
          return json({
            url: openAttempt.checkout_url,
            sessionId: openAttempt.stripe_checkout_session_id,
            requestId: openAttempt.request_key,
            reused: true,
          });
        }

        if (existingSession.status === "open") {
          await stripe.checkout.sessions.expire(existingSession.id);
        }
      } catch (error) {
        if (stripeErrorCode(error) === "resource_missing") {
          console.warn("Existing Checkout Session is unavailable in the current Stripe mode");
        } else {
          const message = error instanceof Error ? error.message : "Unknown Stripe error";
          console.error("Unable to verify an existing Checkout Session", message);
          return json({ error: "Unable to verify an existing checkout" }, 502);
        }
      }

      const { error: closeAttemptError } = await ctx.supabaseAdmin
        .from("stripe_checkout_attempts")
        .update({ status: "expired" })
        .eq("stripe_checkout_session_id", openAttempt.stripe_checkout_session_id)
        .eq("status", "open");

      if (closeAttemptError) {
        console.error("Unable to close an outdated Checkout attempt", closeAttemptError.code);
        return json({ error: "Unable to prepare checkout" }, 500);
      }
    }

    const { data: closedAttemptWithKey, error: closedAttemptWithKeyError } = await ctx.supabaseAdmin
      .from("stripe_checkout_attempts")
      .select("id")
      .eq("instructor_profile_id", profile.id)
      .eq("request_key", key)
      .maybeSingle();

    if (closedAttemptWithKeyError) {
      console.error("Unable to verify the Checkout request key", closedAttemptWithKeyError.code);
      return json({ error: "Unable to prepare checkout" }, 500);
    }
    if (closedAttemptWithKey) {
      key = crypto.randomUUID();
    }

    try {
      try {
        await verifiedMembershipPrice(stripe, stripeConfig);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown Stripe Price error";
        console.error("Membership Price validation failed", message);
        return json({ error: "Membership checkout is not configured correctly" }, 500);
      }

      let customerId = settings.stripe_customer_id as string | null;
      if (customerId) {
        try {
          const existingCustomer = await stripe.customers.retrieve(customerId);
          if (existingCustomer.deleted) customerId = null;
        } catch (error) {
          if (stripeErrorCode(error) === "resource_missing") {
            customerId = null;
          } else {
            throw error;
          }
        }
      }

      if (!customerId) {
        const customer = await stripe.customers.create({
          email: settings.inquiry_email,
          metadata: {
            instructor_profile_id: profile.id,
            account_id: accountId,
            product_line: "hire_line_dancers",
          },
        }, {
          idempotencyKey: `hld-customer-${profile.id}`,
        });
        customerId = customer.id;

        const { error: customerSaveError } = await ctx.supabaseAdmin
          .from("instructor_private_settings")
          .update({ stripe_customer_id: customerId })
          .eq("instructor_profile_id", profile.id);

        if (customerSaveError) {
          console.error("Unable to save Stripe customer", customerSaveError.code);
          return json({ error: "Unable to prepare checkout" }, 500);
        }
      }

      const subscriptions = await stripe.subscriptions.list({
        customer: customerId,
        status: "all",
        limit: 100,
      });
      const blockingSubscription = subscriptions.data.find((subscription) => (
        ["incomplete", "trialing", "active", "past_due", "unpaid", "paused"].includes(subscription.status)
        && subscription.items.data.some((item) => item.price.id === priceId)
      ));

      if (blockingSubscription) {
        console.warn("Stripe already has a membership for this instructor", blockingSubscription.id);
        return json({
          error: "This instructor already has a membership",
          code: "membership_exists",
        }, 409);
      }

      const successUrl = new URL("/account/", stripeConfig.appUrl);
      successUrl.searchParams.set("checkout", "success");
      successUrl.searchParams.set("session_id", "{CHECKOUT_SESSION_ID}");
      const checkoutSuccessUrl = successUrl.toString().replace(
        "%7BCHECKOUT_SESSION_ID%7D",
        "{CHECKOUT_SESSION_ID}",
      );
      const cancelUrl = new URL("/account/", stripeConfig.appUrl);
      cancelUrl.searchParams.set("checkout", "canceled");

      const session = await stripe.checkout.sessions.create({
        mode: "subscription",
        customer: customerId,
        client_reference_id: profile.id,
        line_items: [{ price: priceId, quantity: 1 }],
        allow_promotion_codes: true,
        payment_method_collection: "always",
        ...(requireTermsConsent ? {
          consent_collection: { terms_of_service: "required" as const },
        } : {}),
        success_url: checkoutSuccessUrl,
        cancel_url: cancelUrl.toString(),
        metadata: {
          instructor_profile_id: profile.id,
          account_id: accountId,
          product_line: "hire_line_dancers",
          checkout_terms_version: CHECKOUT_TERMS_VERSION,
        },
        subscription_data: {
          metadata: {
            instructor_profile_id: profile.id,
            account_id: accountId,
            product_line: "hire_line_dancers",
            checkout_terms_version: CHECKOUT_TERMS_VERSION,
          },
        },
      }, {
        idempotencyKey: `hld-checkout-${profile.id}-${key}`,
      });

      if (!session.url) {
        console.error("Stripe returned a Checkout Session without a URL", session.id);
        return json({ error: "Stripe did not return a checkout URL" }, 502);
      }

      const { data: registered, error: saveError } = await ctx.supabaseAdmin
        .rpc("register_instructor_checkout_attempt", {
          p_instructor_profile_id: profile.id,
          p_request_key: key,
          p_stripe_checkout_session_id: session.id,
          p_stripe_customer_id: customerId,
          p_stripe_price_id: priceId,
          p_checkout_url: session.url,
          p_expires_at: new Date(session.expires_at * 1000).toISOString(),
        });

      if (!saveError && registered === false) {
        await stripe.checkout.sessions.expire(session.id).catch(() => undefined);
        return json({
          error: "This instructor has lifetime access and does not need Stripe checkout",
          code: "lifetime_access",
        }, 409);
      }

      if (saveError) {
        if (saveError.code === "23505") {
          const { data: winner } = await ctx.supabaseAdmin
            .from("stripe_checkout_attempts")
            .select("checkout_url, stripe_checkout_session_id, request_key")
            .eq("instructor_profile_id", profile.id)
            .eq("status", "open")
            .gt("expires_at", new Date().toISOString())
            .maybeSingle();

          if (winner) {
            if (winner.stripe_checkout_session_id !== session.id) {
              await stripe.checkout.sessions.expire(session.id).catch(() => undefined);
            }
            return json({
              url: winner.checkout_url,
              sessionId: winner.stripe_checkout_session_id,
              requestId: winner.request_key,
              reused: true,
            });
          }

          await stripe.checkout.sessions.expire(session.id).catch(() => undefined);
        }
        console.error("Unable to save Checkout attempt", saveError.code);
        return json({ error: "Unable to save checkout" }, 500);
      }

      return json({
        url: session.url,
        sessionId: session.id,
        requestId: key,
        reused: false,
      }, 201);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown Stripe error";
      console.error("Checkout creation failed", message);
      return json({ error: "Unable to create Stripe Checkout" }, 502);
    }
  }),
};
