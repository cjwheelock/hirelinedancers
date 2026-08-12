import { withSupabase } from "npm:@supabase/server@^1";
import type { SupabaseClient } from "npm:@supabase/supabase-js@^2";
import Stripe from "npm:stripe@^22";
import {
  INSTRUCTOR_PAYMENT_SETUP_TERMS_VERSION,
  verifiedInstructorPaymentSetup,
} from "../_shared/hld-payment-setup.ts";
import {
  hldStripeConfig,
  MEMBERSHIP_CHECKOUT_TERMS_VERSION,
  MEMBERSHIP_GUARANTEE_TERMS_VERSION,
  requiredEnv,
  stripeObjectId,
  subscriptionHasExactCoupon,
  verifiedInstructorOfferCoupon,
  verifiedMembershipPrice,
} from "../_shared/hld-stripe.ts";

type ReviewRequest = {
  instructorProfileId?: unknown;
  decision?: unknown;
  slug?: unknown;
  note?: unknown;
  p_instructor_profile_id?: unknown;
  p_decision?: unknown;
  p_slug?: unknown;
  p_note?: unknown;
};

type OfferEntitlement = {
  id: string;
  source: "founding_first_100" | "private_invitation";
  offer_code: string;
  redeemed_at: string | null;
  redeemed_checkout_session_id: string | null;
  redeemed_subscription_id: string | null;
};

type DurableApproval = {
  profileStatus?: unknown;
  approvedAt?: unknown;
  approvedBy?: unknown;
  hasLifetimeAccess?: unknown;
  activationId?: unknown;
  setupSessionId?: unknown;
  stripeCustomerId?: unknown;
  stripeSetupIntentId?: unknown;
  stripePaymentMethodId?: unknown;
  livemode?: unknown;
  setupTermsVersion?: unknown;
  entitlementId?: unknown;
  entitlementSource?: unknown;
  offerCode?: unknown;
};

type ActivationReset = {
  reset?: unknown;
  profileStatus?: unknown;
  supersededSetupId?: unknown;
  retainedStripeCustomerId?: unknown;
  entitlementId?: unknown;
};

type ApprovalEmailStatus =
  | "pending"
  | "processing"
  | "sent"
  | "failed"
  | "canceled"
  | "missing";

type ApprovalReceipt = {
  profileStatus: unknown;
  slug: string | null;
  emailStatus: ApprovalEmailStatus;
};

const DEFINITIVE_PAYMENT_FAILURE_CODES = new Set([
  "card_declined",
  "expired_card",
  "incorrect_cvc",
  "incorrect_number",
  "invalid_cvc",
  "invalid_expiry_month",
  "invalid_expiry_year",
  "invalid_number",
  "payment_intent_authentication_failure",
  "payment_method_not_available",
  "payment_method_provider_decline",
  "processing_error",
]);

export function definitivePaymentFailureCode(error: unknown): string | null {
  if (!error || typeof error !== "object") return null;
  const candidate = error as {
    code?: unknown;
    raw?: { code?: unknown };
  };
  const code = typeof candidate.code === "string"
    ? candidate.code
    : typeof candidate.raw?.code === "string"
    ? candidate.raw.code
    : null;
  return code && DEFINITIVE_PAYMENT_FAILURE_CODES.has(code) ? code : null;
}

function json(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function validUuid(value: unknown): string | null {
  return typeof value === "string" &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
        .test(value)
    ? value
    : null;
}

function optionalText(value: unknown, max: number): string | null | undefined {
  if (value == null) return null;
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized.length <= max ? normalized || null : undefined;
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

function subscriptionMatches(
  subscription: Stripe.Subscription,
  expected: {
    accountId: string;
    activationId: string;
    couponId: string | null;
    customerId: string;
    paymentMethodId: string;
    priceId: string;
    profileId: string;
    setupSessionId: string;
    livemode: boolean;
  },
): boolean {
  const items = subscription.items.data.filter((item) =>
    item.price.id === expected.priceId
  );
  return subscription.livemode === expected.livemode &&
    stripeObjectId(subscription.customer) === expected.customerId &&
    stripeObjectId(subscription.default_payment_method) ===
      expected.paymentMethodId &&
    subscription.items.data.length === 1 && items.length === 1 &&
    items[0].quantity === 1 &&
    subscription.metadata.instructor_profile_id === expected.profileId &&
    subscription.metadata.account_id === expected.accountId &&
    subscription.metadata.product_line === "hire_line_dancers" &&
    subscription.metadata.payment_setup_activation_id ===
      expected.activationId &&
    subscription.metadata.payment_setup_checkout_session_id ===
      expected.setupSessionId &&
    subscription.metadata.payment_setup_terms_version ===
      INSTRUCTOR_PAYMENT_SETUP_TERMS_VERSION &&
    subscription.metadata.checkout_terms_version ===
      MEMBERSHIP_CHECKOUT_TERMS_VERSION &&
    subscription.metadata.guarantee_terms_version ===
      MEMBERSHIP_GUARANTEE_TERMS_VERSION &&
    subscriptionHasExactCoupon(subscription, expected.couponId);
}

async function loadApprovalReceipt(
  admin: SupabaseClient,
  instructorProfileId: string,
  fallbackProfileStatus: unknown,
): Promise<ApprovalReceipt> {
  const [profileResult, notificationResult] = await Promise.all([
    admin
      .from("instructor_profiles")
      .select("status,slug")
      .eq("id", instructorProfileId)
      .maybeSingle(),
    admin
      .from("instructor_service_notification_jobs")
      .select("status")
      .eq("instructor_profile_id", instructorProfileId)
      .eq("notification_type", "profile_approved")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  if (profileResult.error) {
    console.error(
      "Unable to load final instructor profile receipt",
      profileResult.error.code,
    );
  }
  if (notificationResult.error) {
    console.error(
      "Unable to load approval email receipt",
      notificationResult.error.code,
    );
  }

  const notificationStatus = notificationResult.data?.status;
  const emailStatus: ApprovalEmailStatus = [
      "pending",
      "processing",
      "sent",
      "failed",
      "canceled",
    ].includes(notificationStatus)
    ? notificationStatus
    : "missing";

  return {
    profileStatus: profileResult.data?.status ?? fallbackProfileStatus,
    slug: typeof profileResult.data?.slug === "string"
      ? profileResult.data.slug
      : null,
    emailStatus,
  };
}

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
    const adminAccountId = ctx.userClaims?.id;
    if (!adminAccountId) return json({ error: "Authentication required" }, 401);

    const [accountResult, adminResult] = await Promise.all([
      ctx.supabaseAdmin.from("accounts").select("role").eq("id", adminAccountId)
        .maybeSingle(),
      ctx.supabaseAdmin.from("marketplace_admins").select("account_id").eq(
        "account_id",
        adminAccountId,
      ).maybeSingle(),
    ]);
    if (accountResult.error || adminResult.error) {
      console.error(
        "Unable to verify profile reviewer",
        accountResult.error?.code ?? adminResult.error?.code,
      );
      return json({ error: "Unable to verify administrator access" }, 500);
    }
    if (accountResult.data?.role !== "admin" && !adminResult.data) {
      return json({ error: "Administrator access required" }, 403);
    }

    let body: ReviewRequest;
    try {
      body = await req.json() as ReviewRequest;
    } catch {
      return json({ error: "A valid JSON request is required" }, 400);
    }
    const instructorProfileId = validUuid(
      body.instructorProfileId ?? body.p_instructor_profile_id,
    );
    const decision = body.decision ?? body.p_decision;
    const slug = optionalText(body.slug ?? body.p_slug, 160);
    const note = optionalText(body.note ?? body.p_note, 4000);
    if (!instructorProfileId) {
      return json({ error: "A valid instructor profile is required" }, 400);
    }
    if (decision !== "approve") {
      return json({
        error:
          "Only approval uses this endpoint. Return-to-draft and suspension remain available through the standard review action",
        code: "unsupported_decision",
      }, 400);
    }
    if (
      slug === undefined || !slug ||
      !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)
    ) {
      return json(
        { error: "A valid profile slug is required for approval" },
        400,
      );
    }
    if (note === undefined) {
      return json({
        error: "The review note must be 4,000 characters or fewer",
      }, 400);
    }

    const [profileResult, settingsResult, lifetimeResult, entitlementResult] =
      await Promise.all([
        ctx.supabaseAdmin
          .from("instructor_profiles")
          .select("id, account_id, status")
          .eq("id", instructorProfileId)
          .maybeSingle(),
        ctx.supabaseAdmin
          .from("instructor_private_settings")
          .select(
            "stripe_customer_id, stripe_subscription_id, stripe_payment_method_id, stripe_payment_setup_intent_id, stripe_payment_setup_checkout_session_id",
          )
          .eq("instructor_profile_id", instructorProfileId)
          .maybeSingle(),
        ctx.supabaseAdmin
          .from("instructor_lifetime_access")
          .select("instructor_profile_id")
          .eq("instructor_profile_id", instructorProfileId)
          .maybeSingle(),
        ctx.supabaseAdmin
          .from("instructor_offer_entitlements")
          .select(
            "id, source, offer_code, redeemed_at, redeemed_checkout_session_id, redeemed_subscription_id",
          )
          .eq("instructor_profile_id", instructorProfileId)
          .maybeSingle(),
      ]);
    const loadError = profileResult.error ?? settingsResult.error ??
      lifetimeResult.error ?? entitlementResult.error;
    if (loadError) {
      console.error("Unable to load instructor approval state", loadError.code);
      return json({ error: "Unable to load instructor approval state" }, 500);
    }
    const profile = profileResult.data;
    if (!profile) return json({ error: "Instructor profile not found" }, 404);
    if (
      !["pending_review", "approved", "published"].includes(
        profile.status,
      )
    ) {
      return json({
        error: "This instructor profile is not ready for approval",
      }, 409);
    }

    if (lifetimeResult.data) {
      const { data, error } = await ctx.supabaseAdmin.rpc(
        "admin_approve_instructor_after_payment_setup",
        {
          p_instructor_profile_id: instructorProfileId,
          p_admin_account_id: adminAccountId,
          p_slug: slug,
          p_note: note,
        },
      );
      if (error) {
        console.error(
          "Unable to approve lifetime instructor",
          error.code,
          error.message,
        );
        return json({ error: "Unable to approve instructor profile" }, 500);
      }
      const approval = data as DurableApproval | null;
      if (approval?.hasLifetimeAccess !== true) {
        console.error("Lifetime approval did not return a lifetime grant");
        return json(
          { error: "Unable to verify lifetime instructor access" },
          409,
        );
      }
      const receipt = await loadApprovalReceipt(
        ctx.supabaseAdmin,
        instructorProfileId,
        approval.profileStatus,
      );
      return json({
        approved: true,
        lifetimeAccess: true,
        membershipStatus: null,
        profileStatus: receipt.profileStatus,
        slug: receipt.slug,
        emailStatus: receipt.emailStatus,
        approvedAt: approval.approvedAt,
        approvedBy: approval.approvedBy,
      });
    }

    let stripe: Stripe;
    let stripeConfig: ReturnType<typeof hldStripeConfig>;
    try {
      stripeConfig = hldStripeConfig();
      stripe = new Stripe(requiredEnv("STRIPE_SECRET_KEY"));
      await verifiedMembershipPrice(stripe, stripeConfig);
    } catch (error) {
      console.error(
        "Profile approval billing configuration is invalid",
        error instanceof Error ? error.message : "unknown_configuration_error",
      );
      return json(
        { error: "Membership billing is not configured correctly" },
        500,
      );
    }

    const settings = settingsResult.data;
    const canonicalSetupSessionId = settings
      ?.stripe_payment_setup_checkout_session_id;
    const { data: setup, error: setupError } = canonicalSetupSessionId
      ? await ctx.supabaseAdmin
        .from("instructor_payment_setups")
        .select(
          "id, stripe_checkout_session_id, stripe_customer_id, stripe_setup_intent_id, stripe_payment_method_id, livemode, setup_terms_version, status",
        )
        .eq("instructor_profile_id", instructorProfileId)
        .eq("stripe_checkout_session_id", canonicalSetupSessionId)
        .eq("status", "completed")
        .maybeSingle()
      : { data: null, error: null };
    if (setupError) {
      console.error("Unable to load instructor payment setup", setupError.code);
      return json({ error: "Unable to load instructor approval state" }, 500);
    }
    if (
      !setup || !settings ||
      !validUuid(setup.id) ||
      setup.setup_terms_version !== INSTRUCTOR_PAYMENT_SETUP_TERMS_VERSION ||
      setup.livemode !== stripeConfig.expectedLivemode ||
      setup.stripe_customer_id !== settings.stripe_customer_id ||
      setup.stripe_payment_method_id !== settings.stripe_payment_method_id ||
      setup.stripe_setup_intent_id !==
        settings.stripe_payment_setup_intent_id ||
      setup.stripe_checkout_session_id !==
        settings.stripe_payment_setup_checkout_session_id
    ) {
      return json({
        error: "A completed card setup is required before approval",
        code: "payment_setup_required",
      }, 409);
    }

    try {
      const verifiedSetup = await verifiedInstructorPaymentSetup(
        stripe,
        stripeConfig,
        setup.stripe_checkout_session_id,
        {
          accountId: profile.account_id,
          instructorProfileId,
          customerId: setup.stripe_customer_id,
        },
      );
      if (
        verifiedSetup.setupIntent.id !== setup.stripe_setup_intent_id ||
        verifiedSetup.paymentMethodId !== setup.stripe_payment_method_id
      ) {
        return json({ error: "Saved card verification did not match" }, 409);
      }

      const entitlement = entitlementResult.data as OfferEntitlement | null;
      const subscriptions = await stripe.subscriptions.list({
        customer: verifiedSetup.customerId,
        status: "all",
        limit: 100,
        expand: ["data.items.data.price", "data.discounts"],
      });
      if (
        subscriptions.has_more ||
        subscriptions.data.some((subscription) => subscription.items.has_more)
      ) {
        return json({
          error:
            "This instructor has subscription history that requires support",
          code: "membership_history_requires_support",
        }, 409);
      }
      const membershipSubscriptions = subscriptions.data.filter(
        (subscription) =>
          subscription.items.data.some((item) =>
            item.price.id === stripeConfig.priceId
          ),
      );
      const liveCandidates = membershipSubscriptions.filter((subscription) =>
        !["incomplete_expired", "canceled"].includes(subscription.status)
      );
      const currentSetupHistory = membershipSubscriptions.filter(
        (subscription) =>
          subscription.metadata.payment_setup_checkout_session_id ===
            verifiedSetup.session.id,
      );
      if (
        liveCandidates.length > 1 || currentSetupHistory.length > 1 ||
        (liveCandidates.length === 1 && currentSetupHistory.length === 1 &&
          liveCandidates[0].id !== currentSetupHistory[0].id)
      ) {
        return json({
          error: "Multiple memberships require support before approval",
          code: "membership_history_requires_support",
        }, 409);
      }

      let subscription = liveCandidates[0] ?? currentSetupHistory[0] ?? null;
      const recoveringRedeemedOffer = Boolean(
        entitlement?.redeemed_at && subscription &&
          entitlement.redeemed_checkout_session_id ===
            verifiedSetup.session.id &&
          entitlement.redeemed_subscription_id === subscription.id,
      );
      const offerEntitlement = entitlement &&
          (!entitlement.redeemed_at || recoveringRedeemedOffer)
        ? entitlement
        : null;
      let couponId: string | null = null;
      if (offerEntitlement) {
        const coupon = await verifiedInstructorOfferCoupon(
          stripe,
          stripeConfig,
        );
        couponId = coupon.id;
      }

      const offerMetadata = offerEntitlement
        ? {
          offer_code: offerEntitlement.offer_code,
          offer_entitlement_id: offerEntitlement.id,
          offer_coupon_id: couponId!,
        }
        : {
          offer_code: "none",
          offer_entitlement_id: "none",
          offer_coupon_id: "none",
        };
      const metadata = {
        instructor_profile_id: instructorProfileId,
        account_id: profile.account_id,
        product_line: "hire_line_dancers",
        payment_setup_activation_id: setup.id,
        payment_setup_checkout_session_id: verifiedSetup.session.id,
        payment_setup_terms_version: INSTRUCTOR_PAYMENT_SETUP_TERMS_VERSION,
        checkout_terms_version: MEMBERSHIP_CHECKOUT_TERMS_VERSION,
        guarantee_terms_version: MEMBERSHIP_GUARANTEE_TERMS_VERSION,
        ...offerMetadata,
      };

      const expectedSubscription = {
        accountId: profile.account_id,
        activationId: setup.id,
        couponId,
        customerId: verifiedSetup.customerId,
        paymentMethodId: verifiedSetup.paymentMethodId,
        priceId: stripeConfig.priceId,
        profileId: instructorProfileId,
        setupSessionId: verifiedSetup.session.id,
        livemode: stripeConfig.expectedLivemode,
      };
      if (subscription) {
        subscription = await stripe.subscriptions.retrieve(subscription.id, {
          expand: ["items.data.price", "discounts", "latest_invoice"],
        });
        if (
          !subscriptionMatches(subscription, expectedSubscription) ||
          !["active", "trialing"].includes(subscription.status)
        ) {
          return json({
            error:
              "The created Stripe subscription did not match this approval",
          }, 409);
        }
      } else {
        const customer = await stripe.customers.retrieve(
          verifiedSetup.customerId,
        );
        if (
          customer.deleted ||
          customer.livemode !== stripeConfig.expectedLivemode ||
          customer.discount
        ) {
          return json({
            error:
              "The Stripe customer has billing settings that require support before approval",
            code: "customer_billing_requires_support",
          }, 409);
        }
      }

      const { data: approvalData, error: approvalError } = await ctx
        .supabaseAdmin
        .rpc(
          "admin_approve_instructor_after_payment_setup",
          {
            p_instructor_profile_id: instructorProfileId,
            p_admin_account_id: adminAccountId,
            p_slug: slug,
            p_note: note,
            p_expected_stripe_checkout_session_id: verifiedSetup.session.id,
            p_expected_stripe_customer_id: verifiedSetup.customerId,
            p_expected_stripe_setup_intent_id: verifiedSetup.setupIntent.id,
            p_expected_stripe_payment_method_id: verifiedSetup.paymentMethodId,
            p_expected_entitlement_id: entitlement?.id ?? null,
          },
        );
      if (approvalError) {
        console.error(
          "Instructor approval state update failed",
          approvalError.code,
          approvalError.message,
        );
        return json({ error: "Unable to approve instructor profile" }, 500);
      }

      const approval = approvalData as DurableApproval | null;
      if (approval?.hasLifetimeAccess === true) {
        return json({
          approved: true,
          lifetimeAccess: true,
          profileStatus: approval.profileStatus,
          approvedAt: approval.approvedAt,
          approvedBy: approval.approvedBy,
        });
      }
      const approvalActivationId = validUuid(approval?.activationId);
      if (
        approval?.hasLifetimeAccess !== false ||
        !["approved", "published"].includes(
          typeof approval.profileStatus === "string"
            ? approval.profileStatus
            : "",
        ) ||
        typeof approval.approvedAt !== "string" ||
        !validUuid(approval.approvedBy) ||
        !approvalActivationId || approvalActivationId !== setup.id ||
        approval.setupSessionId !== verifiedSetup.session.id ||
        approval.stripeCustomerId !== verifiedSetup.customerId ||
        approval.stripeSetupIntentId !== verifiedSetup.setupIntent.id ||
        approval.stripePaymentMethodId !== verifiedSetup.paymentMethodId ||
        approval.livemode !== verifiedSetup.session.livemode ||
        approval.setupTermsVersion !==
          INSTRUCTOR_PAYMENT_SETUP_TERMS_VERSION ||
        approval.entitlementId !== (entitlement?.id ?? null) ||
        approval.entitlementSource !== (entitlement?.source ?? null) ||
        approval.offerCode !== (entitlement?.offer_code ?? null)
      ) {
        console.error("Durable approval returned different activation facts");
        return json({
          error: "Approval facts changed before membership activation",
          code: "approval_facts_changed",
        }, 409);
      }

      if (!subscription) {
        try {
          subscription = await stripe.subscriptions.create({
            customer: verifiedSetup.customerId,
            items: [{ price: stripeConfig.priceId, quantity: 1 }],
            default_payment_method: verifiedSetup.paymentMethodId,
            collection_method: "charge_automatically",
            off_session: true,
            payment_behavior: "error_if_incomplete",
            payment_settings: {
              save_default_payment_method: "on_subscription",
            },
            discounts: couponId ? [{ coupon: couponId }] : [],
            metadata: {
              ...metadata,
              payment_setup_activation_id: approvalActivationId,
            },
            expand: ["items.data.price", "discounts", "latest_invoice"],
          }, {
            idempotencyKey:
              `hld-payment-setup-activation-${approvalActivationId}`,
          });
        } catch (error) {
          const paymentFailureCode = definitivePaymentFailureCode(error);
          if (!paymentFailureCode) throw error;

          let postFailureSubscriptions: Stripe.ApiList<Stripe.Subscription>;
          try {
            postFailureSubscriptions = await stripe.subscriptions.list({
              customer: verifiedSetup.customerId,
              status: "all",
              limit: 100,
            });
          } catch (verificationError) {
            console.error(
              "Unable to verify Stripe state after payment failure",
              verificationError instanceof Error
                ? verificationError.message
                : "unknown_verification_error",
            );
            throw error;
          }
          const relevantSubscriptionExists =
            postFailureSubscriptions.has_more ||
            postFailureSubscriptions.data.some((candidate) =>
              candidate.items.has_more ||
              candidate.metadata.payment_setup_activation_id ===
                approvalActivationId ||
              candidate.metadata.payment_setup_checkout_session_id ===
                verifiedSetup.session.id ||
              (!["canceled", "incomplete_expired"].includes(
                candidate.status,
              ) && candidate.items.data.some((item) =>
                item.price.id === stripeConfig.priceId
              ))
            );
          if (relevantSubscriptionExists) throw error;

          const { data: resetData, error: resetError } = await ctx
            .supabaseAdmin.rpc(
              "reset_instructor_activation_after_payment_failure",
              {
                p_instructor_profile_id: instructorProfileId,
                p_admin_account_id: adminAccountId,
                p_expected_stripe_checkout_session_id: verifiedSetup.session.id,
                p_expected_stripe_customer_id: verifiedSetup.customerId,
                p_expected_stripe_setup_intent_id: verifiedSetup.setupIntent.id,
                p_expected_stripe_payment_method_id:
                  verifiedSetup.paymentMethodId,
                p_expected_entitlement_id: entitlement?.id ?? null,
                p_stripe_error_code: paymentFailureCode,
                p_note:
                  "Stripe could not activate the membership with the saved payment method.",
              },
            );
          if (resetError) {
            console.error(
              "Unable to reset failed instructor activation",
              resetError.code,
              resetError.message,
            );
            throw error;
          }
          const reset = resetData as ActivationReset | null;
          if (
            (reset?.reset !== true && reset?.reset !== false) ||
            reset.profileStatus !== "draft" ||
            reset.supersededSetupId !== setup.id ||
            reset.retainedStripeCustomerId !== verifiedSetup.customerId ||
            reset.entitlementId !== (entitlement?.id ?? null)
          ) {
            console.error("Payment failure reset returned unexpected facts");
            throw error;
          }
          const { data: notificationResult, error: notificationError } =
            await ctx.supabaseAdmin.rpc(
              "enqueue_instructor_activation_payment_failure",
              {
                p_instructor_profile_id: instructorProfileId,
                p_failed_activation_id: approvalActivationId,
              },
            );
          if (
            notificationError ||
            !["queued", "duplicate"].includes(String(notificationResult))
          ) {
            console.error(
              "Unable to queue instructor payment failure email",
              notificationError?.code ?? "unexpected_queue_result",
              notificationError?.message ?? String(notificationResult),
            );
          }
          return json({
            error:
              "The saved card could not start the membership. The instructor must save another payment method before review.",
            code: "payment_method_failed",
            profileStatus: "draft",
            paymentSetupRequired: true,
          }, 402);
        }
      }
      if (
        !subscriptionMatches(subscription, expectedSubscription) ||
        !["active", "trialing"].includes(subscription.status)
      ) {
        return json({
          error: "The created Stripe subscription did not match this approval",
        }, 409);
      }

      const membershipItem = subscription.items.data[0];
      const membershipStatus = normalizedStatus(subscription.status);
      const observedAt = new Date().toISOString();
      const eventId = [
        "hld-payment-setup-approval",
        verifiedSetup.session.id,
        subscription.id,
        membershipStatus,
        membershipItem.current_period_end,
      ].join(":");
      const { data: syncResult, error: syncError } = await ctx.supabaseAdmin
        .rpc(
          "apply_stripe_subscription_event",
          {
            p_event_id: eventId,
            p_event_type: "instructor.payment_setup.approved",
            p_event_created_at: observedAt,
            p_api_version: "authenticated-admin-payment-setup-v1",
            p_livemode: subscription.livemode,
            p_instructor_profile_id: instructorProfileId,
            p_customer_id: verifiedSetup.customerId,
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
            p_checkout_session_id: verifiedSetup.session.id,
            p_latest_invoice_id: stripeObjectId(subscription.latest_invoice),
            p_subscription_created_at: new Date(subscription.created * 1000)
              .toISOString(),
            p_observed_at: observedAt,
          },
        );
      if (syncError) {
        console.error(
          "Approved instructor membership sync failed",
          syncError.code,
          syncError.message,
        );
        return json(
          { error: "Membership was created but is still syncing" },
          500,
        );
      }

      let offerResult: string | null = null;
      if (entitlement && !entitlement.redeemed_at) {
        const { data, error } = await ctx.supabaseAdmin.rpc(
          "redeem_instructor_offer_entitlement",
          {
            p_instructor_profile_id: instructorProfileId,
            p_entitlement_id: entitlement.id,
            p_stripe_checkout_session_id: verifiedSetup.session.id,
            p_stripe_subscription_id: subscription.id,
          },
        );
        if (error) {
          console.error(
            "Unable to redeem instructor offer entitlement",
            error.code,
            error.message,
          );
          return json({
            error:
              "Membership is active but its founding offer is still syncing",
          }, 500);
        }
        offerResult = data;
      } else if (recoveringRedeemedOffer) {
        offerResult = "duplicate";
      }

      const receipt = await loadApprovalReceipt(
        ctx.supabaseAdmin,
        instructorProfileId,
        approval?.profileStatus,
      );
      return json({
        approved: true,
        lifetimeAccess: false,
        profileStatus: receipt.profileStatus,
        slug: receipt.slug,
        emailStatus: receipt.emailStatus,
        membershipStatus,
        subscriptionId: subscription.id,
        offerApplied: Boolean(offerEntitlement),
        offerResult,
        syncResult,
      });
    } catch (error) {
      const message = error instanceof Error
        ? error.message
        : "unknown_stripe_error";
      console.error(
        "Instructor approval billing failed",
        message,
      );
      if (message.includes("Configured Stripe Coupon")) {
        return json(
          {
            error:
              "The two-month instructor offer is not configured correctly in Stripe. No profile or membership changes were made.",
            code: "instructor_offer_configuration_invalid",
          },
          503,
        );
      }
      return json(
        {
          error:
            "Unable to activate the instructor membership. No duplicate membership was created. Try again or contact support.",
        },
        502,
      );
    }
  }),
};
