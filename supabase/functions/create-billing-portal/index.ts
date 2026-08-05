import { withSupabase } from "npm:@supabase/server@^1";
import Stripe from "npm:stripe@^22";
import {
  hldStripeConfig,
  requiredEnv,
  verifiedMembershipPrice,
  verifiedPortalConfigurationId,
} from "../_shared/hld-stripe.ts";

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

    let stripeConfig: ReturnType<typeof hldStripeConfig>;
    try {
      stripeConfig = hldStripeConfig();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown Stripe configuration error";
      console.error("Billing Portal configuration is invalid", message);
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
      return json({ error: "An instructor profile is required", code: "profile_required" }, 403);
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
        error: "This instructor has lifetime access and does not need Stripe billing",
        code: "lifetime_access",
      }, 409);
    }

    const { data: membership, error: membershipError } = await ctx.supabaseAdmin
      .from("instructor_memberships")
      .select("stripe_customer_id, stripe_price_id, status")
      .eq("instructor_profile_id", profile.id)
      .maybeSingle();

    if (membershipError) {
      console.error("Unable to read instructor membership", membershipError.code);
      return json({ error: "Unable to load membership billing" }, 500);
    }
    if (
      !membership
      || membership.stripe_price_id !== stripeConfig.priceId
      || !["trialing", "active", "past_due", "unpaid", "paused"].includes(membership.status)
    ) {
      return json({
        error: "No Hire Line Dancers membership is available to manage",
        code: "membership_required",
      }, 409);
    }

    try {
      await verifiedMembershipPrice(stripe, stripeConfig);
      const configuration = await verifiedPortalConfigurationId(stripe, stripeConfig);

      const returnUrl = new URL("/account/", stripeConfig.appUrl);
      returnUrl.searchParams.set("billing", "returned");
      const session = await stripe.billingPortal.sessions.create({
        customer: membership.stripe_customer_id,
        return_url: returnUrl.toString(),
        ...(configuration ? { configuration } : {}),
      });

      const { data: finalLifetimeAccess, error: finalLifetimeAccessError } = await ctx.supabaseAdmin
        .from("instructor_lifetime_access")
        .select("instructor_profile_id")
        .eq("instructor_profile_id", profile.id)
        .maybeSingle();

      if (finalLifetimeAccessError) {
        console.error("Unable to complete the final instructor access check", finalLifetimeAccessError.code);
        return json({ error: "Unable to verify instructor access" }, 500);
      }
      if (finalLifetimeAccess) {
        return json({
          error: "This instructor has lifetime access and does not need Stripe billing",
          code: "lifetime_access",
        }, 409);
      }

      return json({ url: session.url });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown Stripe error";
      console.error("Billing Portal Session creation failed", message);
      return json({ error: "Unable to open membership billing" }, 502);
    }
  }),
};
