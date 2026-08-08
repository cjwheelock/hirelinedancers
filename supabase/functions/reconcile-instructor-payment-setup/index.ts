import { withSupabase } from "npm:@supabase/server@^1";
import Stripe from "npm:stripe@^22";
import {
  INSTRUCTOR_PAYMENT_SETUP_TERMS_VERSION,
  validCheckoutSessionId,
  verifiedInstructorPaymentSetup,
} from "../_shared/hld-payment-setup.ts";
import { hldStripeConfig, requiredEnv } from "../_shared/hld-stripe.ts";

function json(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
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

    let body: { sessionId?: unknown };
    try {
      body = await req.json();
    } catch {
      return json({ error: "A Checkout Session reference is required" }, 400);
    }
    const sessionId = validCheckoutSessionId(body.sessionId);
    if (!sessionId) {
      return json(
        { error: "A valid Checkout Session reference is required" },
        400,
      );
    }

    let stripeConfig: ReturnType<typeof hldStripeConfig>;
    try {
      stripeConfig = hldStripeConfig();
    } catch (error) {
      console.error(
        "Payment setup reconciliation configuration is invalid",
        error instanceof Error ? error.message : "unknown_configuration_error",
      );
      return json({ error: "Payment setup is not configured correctly" }, 500);
    }

    const { data: profile, error: profileError } = await ctx.supabaseAdmin
      .from("instructor_profiles")
      .select("id, status")
      .eq("account_id", accountId)
      .maybeSingle();
    if (profileError) {
      console.error("Unable to read instructor profile", profileError.code);
      return json({ error: "Unable to load the instructor profile" }, 500);
    }
    if (
      !profile ||
      !["draft", "pending_review", "approved", "published", "suspended"]
        .includes(profile.status)
    ) {
      return json({
        error: "An eligible instructor profile is required for payment setup",
        code: "profile_not_eligible",
      }, 403);
    }

    const [{ data: settings, error: settingsError }, {
      data: lifetimeAccess,
      error: lifetimeAccessError,
    }] = await Promise.all([
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
        "Unable to verify payment setup ownership",
        settingsError?.code ?? lifetimeAccessError?.code,
      );
      return json({ error: "Unable to verify payment setup ownership" }, 500);
    }
    if (lifetimeAccess) {
      return json({
        error:
          "This instructor has lifetime access and does not need payment setup",
        code: "lifetime_access",
      }, 409);
    }
    if (!settings?.stripe_customer_id) {
      return json({ error: "No payment setup is available to reconcile" }, 409);
    }

    try {
      const observedAt = new Date().toISOString();
      const verified = await verifiedInstructorPaymentSetup(
        stripe,
        stripeConfig,
        sessionId,
        {
          accountId,
          instructorProfileId: profile.id,
          customerId: settings.stripe_customer_id,
        },
      );
      const { data: result, error: completionError } = await ctx.supabaseAdmin
        .rpc(
          "complete_instructor_payment_setup",
          {
            p_event_id:
              `hld-payment-setup-reconcile:${verified.session.id}:${verified.setupIntent.id}`,
            p_instructor_profile_id: profile.id,
            p_account_id: accountId,
            p_stripe_checkout_session_id: verified.session.id,
            p_stripe_setup_intent_id: verified.setupIntent.id,
            p_stripe_customer_id: verified.customerId,
            p_stripe_payment_method_id: verified.paymentMethodId,
            p_livemode: verified.session.livemode,
            p_setup_terms_version: INSTRUCTOR_PAYMENT_SETUP_TERMS_VERSION,
            p_observed_at: observedAt,
          },
        );
      if (completionError) {
        console.error(
          "Authenticated payment setup reconciliation failed",
          completionError.code,
          completionError.message,
        );
        return json(
          { error: "Unable to confirm your payment method yet" },
          500,
        );
      }

      const { data: completedProfile, error: completedProfileError } = await ctx
        .supabaseAdmin
        .from("instructor_profiles")
        .select("status")
        .eq("id", profile.id)
        .single();
      if (completedProfileError) {
        console.error(
          "Unable to confirm submitted profile status",
          completedProfileError.code,
        );
        return json(
          { error: "Unable to confirm your profile submission yet" },
          500,
        );
      }

      return json({
        reconciled: true,
        paymentMethodSaved: true,
        profileStatus: completedProfile.status,
        result: result?.result,
        entitlementId: result?.entitlementId ?? null,
        entitlementSource: result?.entitlementSource ?? null,
        offerCode: result?.offerCode ?? null,
        foundingPosition: result?.foundingPosition ?? null,
      });
    } catch (error) {
      console.error(
        "Payment setup reconciliation failed",
        error instanceof Error ? error.message : "unknown_reconciliation_error",
      );
      return json({ error: "Unable to confirm your payment method yet" }, 502);
    }
  }),
};
