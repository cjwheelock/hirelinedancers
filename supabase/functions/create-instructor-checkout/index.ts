import { withSupabase } from "npm:@supabase/server@^1";
import Stripe from "npm:stripe@^22";

const MONTHLY_PRICE_CENTS = 1499;

function requiredEnv(name: string): string {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`Missing required secret: ${name}`);
  return value;
}

function appUrl(): URL {
  const url = new URL(requiredEnv("APP_URL"));
  if (url.protocol !== "https:" && url.hostname !== "localhost" && url.hostname !== "127.0.0.1") {
    throw new Error("APP_URL must use HTTPS outside local development");
  }
  return url;
}

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

    const priceId = requiredEnv("STRIPE_PRICE_ID");
    const key = requestKey(req);
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
    if (!profile || profile.status !== "approved" || !profile.approved_at) {
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

    const { data: matchingAttempt } = await ctx.supabaseAdmin
      .from("stripe_checkout_attempts")
      .select("checkout_url, stripe_checkout_session_id, expires_at")
      .eq("instructor_profile_id", profile.id)
      .eq("request_key", key)
      .eq("status", "open")
      .gt("expires_at", now)
      .maybeSingle();

    if (matchingAttempt) {
      return json({
        url: matchingAttempt.checkout_url,
        sessionId: matchingAttempt.stripe_checkout_session_id,
        requestId: key,
        reused: true,
      });
    }

    const { data: openAttempt } = await ctx.supabaseAdmin
      .from("stripe_checkout_attempts")
      .select("checkout_url, stripe_checkout_session_id, request_key, expires_at")
      .eq("instructor_profile_id", profile.id)
      .eq("status", "open")
      .gt("expires_at", now)
      .maybeSingle();

    if (openAttempt) {
      return json({
        url: openAttempt.checkout_url,
        sessionId: openAttempt.stripe_checkout_session_id,
        requestId: openAttempt.request_key,
        reused: true,
      });
    }

    try {
      const price = await stripe.prices.retrieve(priceId);
      if (
        !price.active
        || price.type !== "recurring"
        || price.currency !== "usd"
        || price.unit_amount !== MONTHLY_PRICE_CENTS
        || price.recurring?.interval !== "month"
        || price.recurring.interval_count !== 1
      ) {
        console.error("STRIPE_PRICE_ID does not identify the fixed monthly membership price");
        return json({ error: "Membership checkout is not configured correctly" }, 500);
      }

      let customerId = settings.stripe_customer_id as string | null;
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

      const baseUrl = appUrl();
      const successUrl = new URL("/account/", baseUrl);
      successUrl.searchParams.set("checkout", "success");
      const cancelUrl = new URL("/account/", baseUrl);
      cancelUrl.searchParams.set("checkout", "canceled");

      const session = await stripe.checkout.sessions.create({
        mode: "subscription",
        customer: customerId,
        client_reference_id: profile.id,
        line_items: [{ price: priceId, quantity: 1 }],
        success_url: successUrl.toString(),
        cancel_url: cancelUrl.toString(),
        metadata: {
          instructor_profile_id: profile.id,
          account_id: accountId,
          product_line: "hire_line_dancers",
        },
        subscription_data: {
          metadata: {
            instructor_profile_id: profile.id,
            account_id: accountId,
            product_line: "hire_line_dancers",
          },
        },
      }, {
        idempotencyKey: `hld-checkout-${profile.id}-${key}`,
      });

      if (!session.url) {
        console.error("Stripe returned a Checkout Session without a URL", session.id);
        return json({ error: "Stripe did not return a checkout URL" }, 502);
      }

      const { error: saveError } = await ctx.supabaseAdmin
        .from("stripe_checkout_attempts")
        .insert({
          instructor_profile_id: profile.id,
          request_key: key,
          stripe_checkout_session_id: session.id,
          stripe_customer_id: customerId,
          stripe_price_id: priceId,
          checkout_url: session.url,
          status: "open",
          expires_at: new Date(session.expires_at * 1000).toISOString(),
        });

      if (saveError) {
        if (saveError.code === "23505") {
          await stripe.checkout.sessions.expire(session.id).catch(() => undefined);
          const { data: winner } = await ctx.supabaseAdmin
            .from("stripe_checkout_attempts")
            .select("checkout_url, stripe_checkout_session_id, request_key")
            .eq("instructor_profile_id", profile.id)
            .eq("status", "open")
            .gt("expires_at", new Date().toISOString())
            .maybeSingle();

          if (winner) {
            return json({
              url: winner.checkout_url,
              sessionId: winner.stripe_checkout_session_id,
              requestId: winner.request_key,
              reused: true,
            });
          }
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
