import { withSupabase } from "npm:@supabase/server@^1";
import Stripe from "npm:stripe@^22";
import {
  checkoutSessionHasExactCoupon,
  checkoutTermsRequired,
  hldStripeConfig,
  INSTRUCTOR_OUTREACH_OFFER_CODE,
  INSTRUCTOR_OUTREACH_OFFER_MONTHS,
  MEMBERSHIP_CHECKOUT_TERMS_VERSION,
  MEMBERSHIP_GUARANTEE_TERMS_VERSION,
  requiredEnv,
  stripeObjectId,
  verifiedInstructorOfferCoupon,
  verifiedMembershipPrice,
} from "../_shared/hld-stripe.ts";

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
  fetch: withSupabase<any>({
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
      .select("inquiry_email, stripe_customer_id, stripe_subscription_id, subscription_status, stripe_payment_method_id, stripe_payment_setup_intent_id, stripe_payment_setup_checkout_session_id, payment_setup_completed_at")
      .eq("instructor_profile_id", profile.id)
      .maybeSingle();

    if (settingsError || !settings?.inquiry_email) {
      console.error("Unable to read instructor billing settings", settingsError?.code);
      return json({ error: "Complete your instructor contact settings before checkout" }, 409);
    }

    const [completedPaymentSetupResult, setupMembershipResult,
      setupEntitlementResult, setupGuaranteeResult] = await Promise.all([
      ctx.supabaseAdmin
        .from("instructor_payment_setups")
        .select("id, stripe_checkout_session_id, stripe_customer_id, stripe_setup_intent_id, stripe_payment_method_id")
        .eq("instructor_profile_id", profile.id)
        .eq("status", "completed")
        .limit(1)
        .maybeSingle(),
      ctx.supabaseAdmin
        .from("instructor_memberships")
        .select("instructor_profile_id, stripe_customer_id, stripe_subscription_id, stripe_price_id, status, latest_checkout_session_id")
        .eq("instructor_profile_id", profile.id)
        .maybeSingle(),
      ctx.supabaseAdmin
        .from("instructor_offer_entitlements")
        .select("id, redeemed_at, redeemed_checkout_session_id, redeemed_subscription_id")
        .eq("instructor_profile_id", profile.id)
        .maybeSingle(),
      ctx.supabaseAdmin
        .from("instructor_guarantees")
        .select("activation_checkout_session_id, first_stripe_customer_id, first_stripe_subscription_id, guarantee_terms_version")
        .eq("instructor_profile_id", profile.id)
        .maybeSingle(),
    ]);
    const setupStateError = completedPaymentSetupResult.error ??
      setupMembershipResult.error ?? setupEntitlementResult.error ??
      setupGuaranteeResult.error;
    if (setupStateError) {
      console.error(
        "Unable to verify pre-review payment setup history",
        setupStateError.code,
      );
      return json({ error: "Unable to verify checkout eligibility" }, 500);
    }
    const completedPaymentSetup = completedPaymentSetupResult.data;
    const setupMembership = setupMembershipResult.data;
    const setupEntitlement = setupEntitlementResult.data;
    const setupGuarantee = setupGuaranteeResult.data;
    const hasPaymentSetupState = Boolean(
      completedPaymentSetup || settings.payment_setup_completed_at ||
      settings.stripe_payment_method_id ||
      settings.stripe_payment_setup_intent_id ||
      settings.stripe_payment_setup_checkout_session_id,
    );
    const canonicalSetup = completedPaymentSetup &&
      settings.payment_setup_completed_at &&
      completedPaymentSetup.stripe_checkout_session_id ===
        settings.stripe_payment_setup_checkout_session_id &&
      completedPaymentSetup.stripe_customer_id === settings.stripe_customer_id &&
      completedPaymentSetup.stripe_setup_intent_id ===
        settings.stripe_payment_setup_intent_id &&
      completedPaymentSetup.stripe_payment_method_id ===
        settings.stripe_payment_method_id
      ? completedPaymentSetup
      : null;
    const canonicalSetupMembership = canonicalSetup && setupMembership &&
        setupMembership.stripe_customer_id === canonicalSetup.stripe_customer_id &&
        setupMembership.stripe_subscription_id === settings.stripe_subscription_id &&
        setupMembership.stripe_price_id === priceId &&
        setupMembership.latest_checkout_session_id ===
          canonicalSetup.stripe_checkout_session_id
      ? setupMembership
      : null;
    const canonicalSetupGuarantee = canonicalSetup && setupGuarantee &&
        setupGuarantee.guarantee_terms_version ===
          MEMBERSHIP_GUARANTEE_TERMS_VERSION &&
        setupGuarantee.activation_checkout_session_id ===
          canonicalSetup.stripe_checkout_session_id &&
        setupGuarantee.first_stripe_customer_id ===
          canonicalSetup.stripe_customer_id &&
        typeof setupGuarantee.first_stripe_subscription_id === "string" &&
        /^sub_[A-Za-z0-9]+$/.test(setupGuarantee.first_stripe_subscription_id)
      ? setupGuarantee
      : null;
    const canonicalSetupSubscriptionId =
      canonicalSetupMembership?.stripe_subscription_id ??
      canonicalSetupGuarantee?.first_stripe_subscription_id ?? null;
    const setupEntitlementSettled = !setupEntitlement || Boolean(
      setupEntitlement.redeemed_at && canonicalSetupSubscriptionId &&
        setupEntitlement.redeemed_checkout_session_id ===
          canonicalSetup?.stripe_checkout_session_id &&
        setupEntitlement.redeemed_subscription_id ===
          canonicalSetupSubscriptionId,
    );
    if (
      hasPaymentSetupState &&
      ((!canonicalSetupMembership && !canonicalSetupGuarantee) ||
        !setupEntitlementSettled)
    ) {
      return json({
        error:
          "Automatic membership activation is still being completed. Contact support before opening another Checkout.",
        code: "payment_setup_activation_incomplete",
      }, 409);
    }

    if (["trialing", "active", "past_due", "unpaid", "paused"].includes(settings.subscription_status)) {
      return json({
        error: "This instructor already has a membership",
        code: "membership_exists",
      }, 409);
    }

    const [
      { data: completedCheckout, error: completedCheckoutError },
      { data: earnedInvitation, error: earnedInvitationError },
    ] = await Promise.all([
      ctx.supabaseAdmin
        .from("stripe_checkout_attempts")
        .select("id")
        .eq("instructor_profile_id", profile.id)
        .eq("status", "completed")
        .limit(1)
        .maybeSingle(),
      ctx.supabaseAdmin
        .from("instructor_invitations")
        .select("id, offer_code, offer_earned_at, offer_redeemed_at")
        .eq("accepted_profile_id", profile.id)
        .eq("offer_code", INSTRUCTOR_OUTREACH_OFFER_CODE)
        .eq("offer_eligible", true)
        .not("offer_earned_at", "is", null)
        .maybeSingle(),
    ]);

    if (
      completedCheckoutError || earnedInvitationError
    ) {
      console.error(
        "Unable to verify instructor offer eligibility",
        completedCheckoutError?.code ?? earnedInvitationError?.code,
      );
      return json({ error: "Unable to verify checkout eligibility" }, 500);
    }

    const hasPriorDatabaseMembership = Boolean(
      setupMembership || completedCheckout || settings.stripe_subscription_id,
    );
    const earnedOffer = !hasPriorDatabaseMembership &&
        earnedInvitation && !earnedInvitation.offer_redeemed_at
      ? earnedInvitation
      : null;

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

    const { data: openAttempt, error: openAttemptError } = await ctx.supabaseAdmin
      .from("stripe_checkout_attempts")
      .select("checkout_url, stripe_checkout_session_id, request_key, expires_at, instructor_invitation_id, offer_code, stripe_coupon_id, checkout_terms_version, guarantee_terms_version")
      .eq("instructor_profile_id", profile.id)
      .eq("status", "open")
      .gt("expires_at", now)
      .maybeSingle();

    if (openAttemptError) {
      console.error("Unable to inspect an open Checkout attempt", openAttemptError.code);
      return json({ error: "Unable to prepare checkout" }, 500);
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
      if (subscriptions.has_more) {
        console.warn(
          "Stripe returned more subscriptions than checkout can verify safely",
          profile.id,
        );
        return json({
          error: "This instructor has membership history that requires support",
          code: "membership_history_requires_support",
        }, 409);
      }
      if (subscriptions.data.some((subscription) => subscription.items.has_more)) {
        console.warn(
          "A Stripe subscription has too many items to verify safely",
          profile.id,
        );
        return json({
          error: "This instructor has membership history that requires support",
          code: "membership_history_requires_support",
        }, 409);
      }
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

      const hasPriorStripeMembership = subscriptions.data.some((subscription) => (
        !["incomplete", "incomplete_expired"].includes(subscription.status) &&
        subscription.items.data.some((item) => item.price.id === priceId)
      ));
      const appliedOffer = earnedOffer && !hasPriorStripeMembership
        ? earnedOffer
        : null;
      let offerCoupon: Stripe.Coupon | null = null;
      if (appliedOffer) {
        try {
          offerCoupon = await verifiedInstructorOfferCoupon(stripe, stripeConfig);
        } catch (error) {
          const message = error instanceof Error
            ? error.message
            : "Unknown Stripe Coupon error";
          console.error("Instructor offer Coupon validation failed", message);
          return json({
            error: "The earned instructor offer is not configured correctly",
          }, 500);
        }
      }

      if (openAttempt) {
        try {
          const existingSession = await stripe.checkout.sessions.retrieve(
            openAttempt.stripe_checkout_session_id,
            { expand: ["discounts"] },
          );
          const expectedOfferCode = appliedOffer?.offer_code ?? "none";
          const expectedInvitationId = appliedOffer?.id ?? "none";
          const expectedCouponId = offerCoupon?.id ?? "none";
          const attemptMatches =
            openAttempt.checkout_terms_version ===
              MEMBERSHIP_CHECKOUT_TERMS_VERSION &&
            openAttempt.guarantee_terms_version ===
              MEMBERSHIP_GUARANTEE_TERMS_VERSION &&
            openAttempt.offer_code === (appliedOffer?.offer_code ?? null) &&
            openAttempt.instructor_invitation_id ===
              (appliedOffer?.id ?? null) &&
            openAttempt.stripe_coupon_id === (offerCoupon?.id ?? null);
          const sessionMatches =
            existingSession.status === "open" &&
            existingSession.mode === "subscription" &&
            existingSession.livemode === stripeConfig.expectedLivemode &&
            stripeObjectId(existingSession.customer) === customerId &&
            existingSession.client_reference_id === profile.id &&
            existingSession.metadata?.instructor_profile_id === profile.id &&
            existingSession.metadata?.account_id === accountId &&
            existingSession.metadata?.product_line === "hire_line_dancers" &&
            existingSession.metadata?.checkout_terms_version ===
              MEMBERSHIP_CHECKOUT_TERMS_VERSION &&
            existingSession.metadata?.guarantee_terms_version ===
              MEMBERSHIP_GUARANTEE_TERMS_VERSION &&
            existingSession.metadata?.offer_code === expectedOfferCode &&
            existingSession.metadata?.offer_invitation_id ===
              expectedInvitationId &&
            existingSession.metadata?.offer_coupon_id === expectedCouponId &&
            existingSession.allow_promotion_codes !== true &&
            checkoutSessionHasExactCoupon(
              existingSession,
              offerCoupon?.id ?? null,
            );

          if (attemptMatches && sessionMatches) {
            return json({
              url: openAttempt.checkout_url,
              sessionId: openAttempt.stripe_checkout_session_id,
              requestId: openAttempt.request_key,
              reused: true,
              offerApplied: Boolean(appliedOffer),
            });
          }

          if (existingSession.status === "open") {
            await stripe.checkout.sessions.expire(existingSession.id);
          }
        } catch (error) {
          if (stripeErrorCode(error) === "resource_missing") {
            console.warn(
              "Existing Checkout Session is unavailable in the current Stripe mode",
            );
          } else {
            const message = error instanceof Error
              ? error.message
              : "Unknown Stripe error";
            console.error(
              "Unable to verify an existing Checkout Session",
              message,
            );
            return json({ error: "Unable to verify an existing checkout" }, 502);
          }
        }

        const { error: closeAttemptError } = await ctx.supabaseAdmin
          .from("stripe_checkout_attempts")
          .update({ status: "expired" })
          .eq(
            "stripe_checkout_session_id",
            openAttempt.stripe_checkout_session_id,
          )
          .eq("status", "open");

        if (closeAttemptError) {
          console.error(
            "Unable to close an outdated Checkout attempt",
            closeAttemptError.code,
          );
          return json({ error: "Unable to prepare checkout" }, 500);
        }
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
        ...(offerCoupon ? { discounts: [{ coupon: offerCoupon.id }] } : {}),
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
          checkout_terms_version: MEMBERSHIP_CHECKOUT_TERMS_VERSION,
          guarantee_terms_version: MEMBERSHIP_GUARANTEE_TERMS_VERSION,
          offer_code: appliedOffer?.offer_code ?? "none",
          offer_invitation_id: appliedOffer?.id ?? "none",
          offer_coupon_id: offerCoupon?.id ?? "none",
        },
        subscription_data: {
          metadata: {
            instructor_profile_id: profile.id,
            account_id: accountId,
            product_line: "hire_line_dancers",
            checkout_terms_version: MEMBERSHIP_CHECKOUT_TERMS_VERSION,
            guarantee_terms_version: MEMBERSHIP_GUARANTEE_TERMS_VERSION,
            offer_code: appliedOffer?.offer_code ?? "none",
            offer_invitation_id: appliedOffer?.id ?? "none",
            offer_coupon_id: offerCoupon?.id ?? "none",
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
          p_instructor_invitation_id: appliedOffer?.id ?? null,
          p_offer_code: appliedOffer?.offer_code ?? null,
          p_offer_earned_at: appliedOffer?.offer_earned_at ?? null,
          p_stripe_coupon_id: offerCoupon?.id ?? null,
          p_offer_free_months: appliedOffer
            ? INSTRUCTOR_OUTREACH_OFFER_MONTHS
            : null,
          p_checkout_terms_version: MEMBERSHIP_CHECKOUT_TERMS_VERSION,
          p_guarantee_terms_version: MEMBERSHIP_GUARANTEE_TERMS_VERSION,
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
            .select("checkout_url, stripe_checkout_session_id, request_key, instructor_invitation_id, offer_code, stripe_coupon_id, checkout_terms_version, guarantee_terms_version")
            .eq("instructor_profile_id", profile.id)
            .eq("status", "open")
            .gt("expires_at", new Date().toISOString())
            .maybeSingle();

          const winnerMatches = winner &&
            winner.checkout_terms_version ===
              MEMBERSHIP_CHECKOUT_TERMS_VERSION &&
            winner.guarantee_terms_version ===
              MEMBERSHIP_GUARANTEE_TERMS_VERSION &&
            winner.instructor_invitation_id === (appliedOffer?.id ?? null) &&
            winner.offer_code === (appliedOffer?.offer_code ?? null) &&
            winner.stripe_coupon_id === (offerCoupon?.id ?? null);

          if (winnerMatches) {
            try {
              const winnerSession = await stripe.checkout.sessions.retrieve(
                winner.stripe_checkout_session_id,
                { expand: ["discounts"] },
              );
              const winnerSessionMatches =
                winnerSession.status === "open" &&
                winnerSession.mode === "subscription" &&
                winnerSession.livemode === stripeConfig.expectedLivemode &&
                stripeObjectId(winnerSession.customer) === customerId &&
                winnerSession.client_reference_id === profile.id &&
                winnerSession.metadata?.instructor_profile_id === profile.id &&
                winnerSession.metadata?.account_id === accountId &&
                winnerSession.metadata?.product_line === "hire_line_dancers" &&
                winnerSession.metadata?.checkout_terms_version ===
                  MEMBERSHIP_CHECKOUT_TERMS_VERSION &&
                winnerSession.metadata?.guarantee_terms_version ===
                  MEMBERSHIP_GUARANTEE_TERMS_VERSION &&
                winnerSession.metadata?.offer_code ===
                  (appliedOffer?.offer_code ?? "none") &&
                winnerSession.metadata?.offer_invitation_id ===
                  (appliedOffer?.id ?? "none") &&
                winnerSession.metadata?.offer_coupon_id ===
                  (offerCoupon?.id ?? "none") &&
                winnerSession.allow_promotion_codes !== true &&
                checkoutSessionHasExactCoupon(
                  winnerSession,
                  offerCoupon?.id ?? null,
                );
              if (winnerSessionMatches) {
                if (winner.stripe_checkout_session_id !== session.id) {
                  await stripe.checkout.sessions.expire(session.id).catch(
                    () => undefined,
                  );
                }
                return json({
                  url: winner.checkout_url,
                  sessionId: winner.stripe_checkout_session_id,
                  requestId: winner.request_key,
                  reused: true,
                  offerApplied: Boolean(appliedOffer),
                });
              }
            } catch (error) {
              console.warn(
                "Unable to verify the winning Checkout attempt",
                error instanceof Error ? error.message : "unknown_error",
              );
            }
          }
        }
        await stripe.checkout.sessions.expire(session.id).catch(() => undefined);
        console.error("Unable to save Checkout attempt", saveError.code);
        return json({ error: "Unable to save checkout" }, 500);
      }

      return json({
        url: session.url,
        sessionId: session.id,
        requestId: key,
        reused: false,
        offerApplied: Boolean(appliedOffer),
      }, 201);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown Stripe error";
      console.error("Checkout creation failed", message);
      return json({ error: "Unable to create Stripe Checkout" }, 502);
    }
  }),
};
