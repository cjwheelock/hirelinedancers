import { withSupabase } from "npm:@supabase/server@^1";
import Stripe from "npm:stripe@^22";
import {
  INSTRUCTOR_PAYMENT_SETUP_TERMS_VERSION,
  instructorPaymentSetupMetadata,
  validUuid,
} from "../_shared/hld-payment-setup.ts";
import {
  checkoutTermsRequired,
  hldStripeConfig,
  requiredEnv,
  stripeObjectId,
  verifiedMembershipPrice,
} from "../_shared/hld-stripe.ts";
import {
  GUARANTEE_COVERAGE_DAYS,
  INSTRUCTOR_OFFER_FREE_PERIOD_LABEL,
  MONTHLY_PRICE_CENTS,
} from "../_shared/hld-commercial-terms.ts";

type RegistrationResult = {
  registered?: boolean;
  reused?: boolean;
  url?: string;
  sessionId?: string;
  requestKey?: string;
  expiresAt?: string;
};

function json(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function requestKey(req: Request): string {
  const supplied = req.headers.get("Idempotency-Key")?.trim();
  return supplied && /^[A-Za-z0-9_-]{8,64}$/.test(supplied)
    ? supplied
    : crypto.randomUUID();
}

function stripeErrorCode(error: unknown): string | null {
  if (!error || typeof error !== "object") return null;
  const candidate = error as { code?: unknown; raw?: { code?: unknown } };
  if (typeof candidate.code === "string") return candidate.code;
  return typeof candidate.raw?.code === "string" ? candidate.raw.code : null;
}

function validEmail(value: unknown): value is string {
  return typeof value === "string" &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function openSessionMatches(
  session: Stripe.Checkout.Session,
  expected: {
    accountId: string;
    customerId: string;
    instructorProfileId: string;
    livemode: boolean;
  },
): boolean {
  return session.status === "open" && session.mode === "setup" &&
    session.livemode === expected.livemode &&
    stripeObjectId(session.customer) === expected.customerId &&
    session.client_reference_id === expected.instructorProfileId &&
    session.metadata?.instructor_profile_id === expected.instructorProfileId &&
    session.metadata?.account_id === expected.accountId &&
    session.metadata?.product_line === "hire_line_dancers" &&
    session.metadata?.payment_setup_terms_version ===
      INSTRUCTOR_PAYMENT_SETUP_TERMS_VERSION &&
    session.payment_method_types?.length === 1 &&
    session.payment_method_types[0] === "card";
}

const stripe = new Stripe(requiredEnv("STRIPE_SECRET_KEY"));

export default {
  fetch: withSupabase<any>({
    auth: "user",
    cors: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers":
        "authorization, x-client-info, apikey, content-type, idempotency-key",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
    },
  }, async (req, ctx) => {
    if (req.method !== "POST") {
      return json({ error: "Method not allowed" }, 405);
    }
    const accountId = ctx.userClaims?.id;
    if (!accountId) return json({ error: "Authentication required" }, 401);

    let requestedProfileId: string | null = null;
    try {
      const body = await req.json() as { instructorProfileId?: unknown };
      if (body.instructorProfileId != null) {
        requestedProfileId = validUuid(body.instructorProfileId);
        if (!requestedProfileId) {
          return json({ error: "A valid instructor profile is required" }, 400);
        }
      }
    } catch {
      return json({ error: "A valid JSON request is required" }, 400);
    }

    let stripeConfig: ReturnType<typeof hldStripeConfig>;
    let requireTermsConsent: boolean;
    try {
      stripeConfig = hldStripeConfig();
      requireTermsConsent = checkoutTermsRequired(stripeConfig);
      await verifiedMembershipPrice(stripe, stripeConfig);
    } catch (error) {
      console.error(
        "Payment setup configuration is invalid",
        error instanceof Error ? error.message : "unknown_configuration_error",
      );
      return json({ error: "Payment setup is not configured correctly" }, 500);
    }

    const { data: profile, error: profileError } = await ctx.supabaseAdmin
      .from("instructor_profiles")
      .select("id, status, display_name, bio, city, region, event_types")
      .eq("account_id", accountId)
      .maybeSingle();
    if (profileError) {
      console.error("Unable to read instructor profile", profileError.code);
      return json({ error: "Unable to load the instructor profile" }, 500);
    }
    if (!profile || (requestedProfileId && requestedProfileId !== profile.id)) {
      return json({ error: "An instructor profile is required" }, 403);
    }
    if (profile.status !== "draft") {
      return json({
        error: "Payment setup is available only before profile review",
        code: "profile_not_draft",
      }, 409);
    }

    const now = new Date().toISOString();
    const [
      settingsResult,
      headshotResult,
      lifetimeResult,
      membershipResult,
      legacyCheckoutResult,
    ] = await Promise.all([
      ctx.supabaseAdmin
        .from("instructor_private_settings")
        .select(
          "inquiry_email, stripe_customer_id, subscription_status",
        )
        .eq("instructor_profile_id", profile.id)
        .maybeSingle(),
      ctx.supabaseAdmin
        .from("profile_media")
        .select("id")
        .eq("instructor_profile_id", profile.id)
        .eq("media_type", "headshot")
        .eq("status", "ready")
        .limit(1),
      ctx.supabaseAdmin
        .from("instructor_lifetime_access")
        .select("instructor_profile_id")
        .eq("instructor_profile_id", profile.id)
        .maybeSingle(),
      ctx.supabaseAdmin
        .from("instructor_memberships")
        .select("status")
        .eq("instructor_profile_id", profile.id)
        .maybeSingle(),
      ctx.supabaseAdmin
        .from("stripe_checkout_attempts")
        .select("id")
        .eq("instructor_profile_id", profile.id)
        .eq("status", "open")
        .gt("expires_at", now)
        .limit(1)
        .maybeSingle(),
    ]);
    const loadError = settingsResult.error ?? headshotResult.error ??
      lifetimeResult.error ?? membershipResult.error ??
      legacyCheckoutResult.error;
    if (loadError) {
      console.error(
        "Unable to verify payment setup eligibility",
        loadError.code,
      );
      return json({ error: "Unable to verify payment setup eligibility" }, 500);
    }
    if (lifetimeResult.data) {
      return json({
        error:
          "This instructor has lifetime access and does not need payment setup",
        code: "lifetime_access",
      }, 409);
    }
    if (legacyCheckoutResult.data) {
      return json({
        error:
          "A still-active membership Checkout must be resolved before payment setup can begin. Contact support for help.",
        code: "membership_checkout_requires_support",
      }, 409);
    }
    const liveMembershipStatuses = [
      "trialing",
      "active",
      "past_due",
      "unpaid",
      "paused",
    ];
    if (
      liveMembershipStatuses.includes(membershipResult.data?.status ?? "") ||
      liveMembershipStatuses.includes(
        settingsResult.data?.subscription_status ?? "",
      )
    ) {
      return json({
        error: "This instructor already has a membership",
        code: "membership_exists",
      }, 409);
    }
    const completeProfile = Boolean(
      profile.display_name?.trim() && profile.bio?.trim() &&
        profile.city?.trim() && profile.region?.trim() &&
        Array.isArray(profile.event_types) && profile.event_types.length > 0 &&
        validEmail(settingsResult.data?.inquiry_email) &&
        (headshotResult.data?.length ?? 0) > 0,
    );
    if (!completeProfile) {
      return json({
        error:
          "Complete your public name, bio, location, event types, inquiry email, and main headshot before continuing",
        code: "profile_incomplete",
      }, 409);
    }

    let customerId = settingsResult.data?.stripe_customer_id as string | null;
    try {
      if (customerId) {
        try {
          const customer = await stripe.customers.retrieve(customerId);
          if (
            customer.deleted ||
            customer.livemode !== stripeConfig.expectedLivemode ||
            (customer.metadata.instructor_profile_id &&
              customer.metadata.instructor_profile_id !== profile.id) ||
            (customer.metadata.account_id &&
              customer.metadata.account_id !== accountId)
          ) {
            throw new Error(
              "Stored Stripe Customer does not belong to this instructor",
            );
          }
        } catch (error) {
          if (stripeErrorCode(error) === "resource_missing") customerId = null;
          else throw error;
        }
      }
      if (!customerId) {
        const customer = await stripe.customers.create({
          email: settingsResult.data!.inquiry_email,
          metadata: {
            instructor_profile_id: profile.id,
            account_id: accountId,
            product_line: "hire_line_dancers",
          },
        }, { idempotencyKey: `hld-customer-${profile.id}` });
        customerId = customer.id;
        const { error: customerSaveError } = await ctx.supabaseAdmin
          .from("instructor_private_settings")
          .update({ stripe_customer_id: customerId })
          .eq("instructor_profile_id", profile.id);
        if (customerSaveError) {
          console.error(
            "Unable to save Stripe Customer",
            customerSaveError.code,
          );
          return json({ error: "Unable to prepare payment setup" }, 500);
        }
      }

      const subscriptions = await stripe.subscriptions.list({
        customer: customerId,
        status: "all",
        limit: 100,
      });
      if (
        subscriptions.has_more ||
        subscriptions.data.some((subscription) =>
          subscription.items.has_more ||
          (["incomplete", "trialing", "active", "past_due", "unpaid", "paused"]
            .includes(subscription.status) &&
            subscription.items.data.some((item) =>
              item.price.id === stripeConfig.priceId
            ))
        )
      ) {
        return json({
          error:
            "This instructor already has membership activity that requires support",
          code: "membership_history_requires_support",
        }, 409);
      }

      const key = requestKey(req);
      const identity = {
        accountId,
        instructorProfileId: profile.id,
      };
      const metadata = instructorPaymentSetupMetadata(identity);
      const successUrl = new URL("/account/", stripeConfig.appUrl);
      successUrl.searchParams.set("payment_setup", "success");
      successUrl.searchParams.set("session_id", "{CHECKOUT_SESSION_ID}");
      const checkoutSuccessUrl = successUrl.toString().replace(
        "%7BCHECKOUT_SESSION_ID%7D",
        "{CHECKOUT_SESSION_ID}",
      );
      const cancelUrl = new URL("/account/", stripeConfig.appUrl);
      cancelUrl.searchParams.set("payment_setup", "canceled");

      const session = await stripe.checkout.sessions.create({
        mode: "setup",
        customer: customerId,
        client_reference_id: profile.id,
        payment_method_types: ["card"],
        setup_intent_data: { metadata },
        ...(requireTermsConsent
          ? { consent_collection: { terms_of_service: "required" as const } }
          : {}),
        custom_text: {
          submit: {
            message: `Your card will not be charged today. If approved, your $${(MONTHLY_PRICE_CENTS / 100).toFixed(2)} monthly membership will begin. Eligible founding instructors receive their first ${INSTRUCTOR_OFFER_FREE_PERIOD_LABEL} free, plus our ${GUARANTEE_COVERAGE_DAYS}-day money-back guarantee.`,
          },
        },
        success_url: checkoutSuccessUrl,
        cancel_url: cancelUrl.toString(),
        metadata,
      }, { idempotencyKey: `hld-payment-setup-${profile.id}-${key}` });
      if (!session.url) {
        return json(
          { error: "Stripe did not return a payment setup URL" },
          502,
        );
      }

      const { data, error: registrationError } = await ctx.supabaseAdmin.rpc(
        "register_instructor_payment_setup",
        {
          p_instructor_profile_id: profile.id,
          p_request_key: key,
          p_stripe_checkout_session_id: session.id,
          p_stripe_customer_id: customerId,
          p_checkout_url: session.url,
          p_expires_at: new Date(session.expires_at * 1000).toISOString(),
          p_livemode: session.livemode,
          p_setup_terms_version: INSTRUCTOR_PAYMENT_SETUP_TERMS_VERSION,
        },
      );
      if (registrationError) {
        // The RPC may have committed even if its response was lost. Keep the
        // idempotent Stripe Session usable so either request-key replay can
        // recover the same registered setup instead of stranding an open row.
        console.error(
          "Unable to register instructor payment setup",
          registrationError.code,
          registrationError.message,
        );
        return json({ error: "Unable to save payment setup" }, 500);
      }

      const registration = (data ?? {}) as RegistrationResult;
      if (
        !registration.url || !registration.sessionId ||
        !registration.requestKey
      ) {
        // Treat an incomplete response as ambiguous for the same reason. An
        // unregistered Session expires naturally and was never disclosed.
        return json(
          { error: "Payment setup registration was incomplete" },
          500,
        );
      }
      if (registration.sessionId !== session.id) {
        await stripe.checkout.sessions.expire(session.id).catch(() =>
          undefined
        );
        const winner = await stripe.checkout.sessions.retrieve(
          registration.sessionId,
        );
        if (
          !openSessionMatches(winner, {
            accountId,
            customerId,
            instructorProfileId: profile.id,
            livemode: stripeConfig.expectedLivemode,
          })
        ) {
          return json({
            error:
              "The existing payment setup is no longer available. Try again shortly",
          }, 409);
        }
      }

      return json({
        url: registration.url,
        sessionId: registration.sessionId,
        requestId: registration.requestKey,
        reused: Boolean(registration.reused),
      }, registration.registered ? 201 : 200);
    } catch (error) {
      console.error(
        "Instructor payment setup creation failed",
        error instanceof Error ? error.message : "unknown_stripe_error",
      );
      return json({ error: "Unable to open secure payment setup" }, 502);
    }
  }),
};
