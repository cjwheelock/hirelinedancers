import { withSupabase } from "npm:@supabase/server@^1";
import Stripe from "npm:stripe@^22";

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

function json(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

const stripe = new Stripe(requiredEnv("STRIPE_SECRET_KEY"));

export default {
  fetch: withSupabase({ auth: "user" }, async (req, ctx) => {
    if (req.method !== "POST") {
      return json({ error: "Method not allowed" }, 405);
    }

    const accountId = ctx.userClaims?.id;
    if (!accountId) return json({ error: "Authentication required" }, 401);

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
      return json({ error: "An instructor profile is required", code: "profile_required" }, 403);
    }

    const { data: membership, error: membershipError } = await ctx.supabaseAdmin
      .from("instructor_memberships")
      .select("stripe_customer_id, stripe_price_id")
      .eq("instructor_profile_id", profile.id)
      .maybeSingle();

    if (membershipError) {
      console.error("Unable to read instructor membership", membershipError.code);
      return json({ error: "Unable to load membership billing" }, 500);
    }
    if (!membership || membership.stripe_price_id !== requiredEnv("STRIPE_PRICE_ID")) {
      return json({
        error: "No Hire Line Dancers membership is available to manage",
        code: "membership_required",
      }, 409);
    }

    try {
      const returnUrl = new URL("/account/", appUrl());
      returnUrl.searchParams.set("billing", "returned");
      const configuration = Deno.env.get("STRIPE_BILLING_PORTAL_CONFIGURATION_ID")?.trim();
      const session = await stripe.billingPortal.sessions.create({
        customer: membership.stripe_customer_id,
        return_url: returnUrl.toString(),
        ...(configuration ? { configuration } : {}),
      });

      return json({ url: session.url });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown Stripe error";
      console.error("Billing Portal Session creation failed", message);
      return json({ error: "Unable to open membership billing" }, 502);
    }
  }),
};
