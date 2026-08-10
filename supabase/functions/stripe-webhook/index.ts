import { withSupabase } from "npm:@supabase/server@^1";
import Stripe from "npm:stripe@^22";
import {
  checkoutSessionHasExactCoupon,
  hldStripeConfig,
  instructorCheckoutOffer,
  MEMBERSHIP_CHECKOUT_TERMS_VERSION,
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
import {
  INSTRUCTOR_PAYMENT_SETUP_TERMS_VERSION,
  validCheckoutSessionId,
  validUuid as validPaymentSetupUuid,
  verifiedInstructorPaymentSetup,
} from "../_shared/hld-payment-setup.ts";

function validUuid(value: string | null | undefined): string | null {
  if (!value) return null;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      .test(value)
    ? value
    : null;
}

type SetupOfferEntitlement = {
  id: string;
  source: "founding_first_100" | "private_invitation";
  offer_code: string;
  redeemed_at: string | null;
  redeemed_checkout_session_id: string | null;
  redeemed_subscription_id: string | null;
};

type SetupActivationCheck =
  | { kind: "not_setup" }
  | { kind: "ignored"; reason: string }
  | {
    kind: "verified";
    activationId: string;
    entitlement: SetupOfferEntitlement | null;
    instructorProfileId: string;
    membershipAlreadyCanonical: boolean;
    setupSessionId: string;
  };

function setupActivationMarker(
  subscription: Stripe.Subscription,
): boolean {
  return Boolean(
    subscription.metadata.payment_setup_activation_id ||
      subscription.metadata.payment_setup_checkout_session_id ||
      subscription.metadata.payment_setup_terms_version,
  );
}

function recoverableStripeReadError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { type?: unknown; statusCode?: unknown };
  return candidate.type === "StripeAPIError" ||
    candidate.type === "StripeConnectionError" ||
    candidate.type === "StripeRateLimitError" ||
    candidate.statusCode === 429 ||
    (typeof candidate.statusCode === "number" && candidate.statusCode >= 500);
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

async function processInstructorPaymentSetupCompleted(
  event: Stripe.Event,
  ctx: any,
  stripeConfig: ReturnType<typeof hldStripeConfig>,
): Promise<Response> {
  const eventSession = event.data.object as Stripe.Checkout.Session;
  const instructorProfileId = validPaymentSetupUuid(
    eventSession.metadata?.instructor_profile_id ??
      eventSession.client_reference_id,
  );
  const accountId = validPaymentSetupUuid(eventSession.metadata?.account_id);
  if (!instructorProfileId || !accountId) {
    console.warn("Ignoring payment setup without valid ownership metadata");
    return Response.json({ received: true, ignored: true });
  }

  const [{ data: profile, error: profileError }, {
    data: settings,
    error: settingsError,
  }, { data: lifetimeAccess, error: lifetimeAccessError }] = await Promise.all([
    ctx.supabaseAdmin
      .from("instructor_profiles")
      .select("id, account_id, status")
      .eq("id", instructorProfileId)
      .maybeSingle(),
    ctx.supabaseAdmin
      .from("instructor_private_settings")
      .select("stripe_customer_id")
      .eq("instructor_profile_id", instructorProfileId)
      .maybeSingle(),
    ctx.supabaseAdmin
      .from("instructor_lifetime_access")
      .select("instructor_profile_id")
      .eq("instructor_profile_id", instructorProfileId)
      .maybeSingle(),
  ]);
  if (profileError || settingsError || lifetimeAccessError) {
    throw new Error(
      `Unable to verify payment setup ownership: ${
        profileError?.code ?? settingsError?.code ?? lifetimeAccessError?.code
      }`,
    );
  }
  if (
    !profile || profile.account_id !== accountId ||
    !["draft", "pending_review", "approved", "published", "suspended"]
      .includes(profile.status) ||
    !settings?.stripe_customer_id || lifetimeAccess
  ) {
    console.info(
      "Ignoring terminal payment setup event",
      event.id,
      instructorProfileId,
    );
    return Response.json({ received: true, ignored: true });
  }

  let verified: Awaited<ReturnType<typeof verifiedInstructorPaymentSetup>>;
  try {
    verified = await verifiedInstructorPaymentSetup(
      stripe,
      stripeConfig,
      eventSession.id,
      {
        accountId,
        instructorProfileId,
        customerId: settings.stripe_customer_id,
      },
    );
  } catch (error) {
    if (recoverableStripeReadError(error)) throw error;
    console.warn(
      "Ignoring terminal payment setup verification failure",
      event.id,
      error instanceof Error ? error.message : "invalid_payment_setup",
    );
    return Response.json({ received: true, ignored: true });
  }
  const { data: result, error } = await ctx.supabaseAdmin.rpc(
    "complete_instructor_payment_setup",
    {
      p_event_id: event.id,
      p_instructor_profile_id: instructorProfileId,
      p_account_id: accountId,
      p_stripe_checkout_session_id: verified.session.id,
      p_stripe_setup_intent_id: verified.setupIntent.id,
      p_stripe_customer_id: verified.customerId,
      p_stripe_payment_method_id: verified.paymentMethodId,
      p_livemode: verified.session.livemode,
      p_setup_terms_version: INSTRUCTOR_PAYMENT_SETUP_TERMS_VERSION,
      p_observed_at: new Date().toISOString(),
    },
  );
  if (error) {
    if (error.code === "P0001" || error.code?.startsWith("23")) {
      console.warn(
        "Ignoring terminal payment setup database state",
        event.id,
        error.code,
      );
      return Response.json({ received: true, ignored: true });
    }
    throw new Error(
      `Unable to complete instructor payment setup: ${error.code}`,
    );
  }

  console.info(
    "Instructor payment setup sync complete",
    event.id,
    result?.result,
  );
  return Response.json({
    received: true,
    result: result?.result,
    profileStatus: result?.profileStatus,
    paymentMethodSaved: true,
    entitlementId: result?.entitlementId ?? null,
    entitlementSource: result?.entitlementSource ?? null,
    offerCode: result?.offerCode ?? null,
    foundingPosition: result?.foundingPosition ?? null,
  });
}

async function canonicalSetupActivation(
  subscription: Stripe.Subscription,
  customerId: string,
  membershipItem: Stripe.SubscriptionItem | null,
  ctx: any,
  stripeConfig: ReturnType<typeof hldStripeConfig>,
): Promise<SetupActivationCheck> {
  if (!setupActivationMarker(subscription)) return { kind: "not_setup" };

  const activationId = validPaymentSetupUuid(
    subscription.metadata.payment_setup_activation_id,
  );
  const setupSessionId = validCheckoutSessionId(
    subscription.metadata.payment_setup_checkout_session_id,
  );
  const instructorProfileId = validPaymentSetupUuid(
    subscription.metadata.instructor_profile_id,
  );
  const accountId = validPaymentSetupUuid(subscription.metadata.account_id);
  if (
    !activationId || !setupSessionId || !instructorProfileId || !accountId ||
    subscription.metadata.product_line !== "hire_line_dancers" ||
    subscription.metadata.payment_setup_terms_version !==
      INSTRUCTOR_PAYMENT_SETUP_TERMS_VERSION ||
    subscription.metadata.checkout_terms_version !==
      MEMBERSHIP_CHECKOUT_TERMS_VERSION ||
    subscription.metadata.guarantee_terms_version !==
      MEMBERSHIP_GUARANTEE_TERMS_VERSION ||
    subscription.livemode !== stripeConfig.expectedLivemode ||
    (membershipItem &&
      (membershipItem.price.id !== stripeConfig.priceId ||
        membershipItem.quantity !== 1 || subscription.items.data.length !== 1))
  ) {
    return { kind: "ignored", reason: "invalid_setup_subscription_metadata" };
  }

  const [profileResult, settingsResult, setupResult, lifetimeResult,
    entitlementResult, membershipResult] = await Promise.all([
    ctx.supabaseAdmin
      .from("instructor_profiles")
      .select("id, account_id, status")
      .eq("id", instructorProfileId)
      .maybeSingle(),
    ctx.supabaseAdmin
      .from("instructor_private_settings")
      .select(
        "stripe_customer_id, stripe_subscription_id, stripe_payment_method_id, stripe_payment_setup_intent_id, stripe_payment_setup_checkout_session_id, payment_setup_completed_at",
      )
      .eq("instructor_profile_id", instructorProfileId)
      .maybeSingle(),
    ctx.supabaseAdmin
      .from("instructor_payment_setups")
      .select(
        "id, instructor_profile_id, stripe_checkout_session_id, stripe_customer_id, stripe_setup_intent_id, stripe_payment_method_id, livemode, setup_terms_version, status",
      )
      .eq("id", activationId)
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
    ctx.supabaseAdmin
      .from("instructor_memberships")
      .select(
        "instructor_profile_id, stripe_customer_id, stripe_subscription_id, stripe_price_id, status, latest_checkout_session_id",
      )
      .eq("instructor_profile_id", instructorProfileId)
      .maybeSingle(),
  ]);
  const databaseError = profileResult.error ?? settingsResult.error ??
    setupResult.error ?? lifetimeResult.error ?? entitlementResult.error ??
    membershipResult.error;
  if (databaseError) {
    throw new Error(
      `Unable to load canonical payment activation: ${databaseError.code}`,
    );
  }

  const profile = profileResult.data;
  const settings = settingsResult.data;
  const setup = setupResult.data;
  if (
    !profile || !settings || !setup || lifetimeResult.data ||
    profile.account_id !== accountId ||
    !["approved", "published", "suspended"].includes(profile.status)
  ) {
    return { kind: "ignored", reason: "setup_profile_not_billable" };
  }
  if (
    setup.instructor_profile_id !== instructorProfileId ||
    setup.status !== "completed" ||
    setup.stripe_checkout_session_id !== setupSessionId ||
    setup.stripe_customer_id !== customerId ||
    setup.livemode !== stripeConfig.expectedLivemode ||
    setup.setup_terms_version !== INSTRUCTOR_PAYMENT_SETUP_TERMS_VERSION ||
    !settings.payment_setup_completed_at ||
    settings.stripe_customer_id !== customerId ||
    settings.stripe_payment_method_id !== setup.stripe_payment_method_id ||
    settings.stripe_payment_setup_intent_id !== setup.stripe_setup_intent_id ||
    settings.stripe_payment_setup_checkout_session_id !== setupSessionId
  ) {
    return { kind: "ignored", reason: "setup_activation_not_canonical" };
  }

  const membership = membershipResult.data;
  const membershipAlreadyCanonical = Boolean(
    membership &&
      membership.stripe_customer_id === customerId &&
      membership.stripe_subscription_id === subscription.id &&
      membership.stripe_price_id === stripeConfig.priceId &&
      membership.latest_checkout_session_id === setupSessionId &&
      settings.stripe_subscription_id === subscription.id,
  );
  if (!membershipItem && !membershipAlreadyCanonical) {
    return { kind: "ignored", reason: "initial_setup_membership_price_missing" };
  }
  if (
    !membershipAlreadyCanonical &&
    !["active", "trialing"].includes(subscription.status)
  ) {
    return { kind: "ignored", reason: "initial_setup_membership_not_active" };
  }
  if (
    !membershipAlreadyCanonical &&
    stripeObjectId(subscription.default_payment_method) !==
      setup.stripe_payment_method_id
  ) {
    return { kind: "ignored", reason: "initial_setup_payment_method_changed" };
  }

  const storedEntitlement = entitlementResult.data as
    | SetupOfferEntitlement
    | null;
  const entitlementRedeemedForSubscription = Boolean(
    storedEntitlement?.redeemed_at &&
      storedEntitlement.redeemed_checkout_session_id === setupSessionId &&
      storedEntitlement.redeemed_subscription_id === subscription.id,
  );
  // A benefit redeemed on an older membership is historical only. A later
  // setup-managed rejoin must carry the explicit no-offer tuple and no
  // discount, while the original subscription keeps its canonical tuple.
  const entitlement = storedEntitlement &&
      (!storedEntitlement.redeemed_at || entitlementRedeemedForSubscription)
    ? storedEntitlement
    : null;
  const metadataEntitlementId = subscription.metadata.offer_entitlement_id;
  const metadataOfferCode = subscription.metadata.offer_code;
  const metadataCouponId = subscription.metadata.offer_coupon_id;
  if (entitlement) {
    if (
      validPaymentSetupUuid(metadataEntitlementId) !== entitlement.id ||
      metadataOfferCode !== entitlement.offer_code ||
      !metadataCouponId || !/^[A-Za-z0-9_-]+$/.test(metadataCouponId)
    ) {
      return { kind: "ignored", reason: "setup_offer_tuple_mismatch" };
    }
  } else if (
    metadataEntitlementId !== "none" || metadataOfferCode !== "none" ||
    metadataCouponId !== "none"
  ) {
    return { kind: "ignored", reason: "unexpected_setup_offer" };
  }

  if (!membershipAlreadyCanonical) {
    await verifiedMembershipPrice(stripe, stripeConfig);
  }
  if (
    entitlement && !entitlementRedeemedForSubscription &&
    !membershipAlreadyCanonical
  ) {
    const coupon = await verifiedInstructorOfferCoupon(stripe, stripeConfig);
    if (
      coupon.id !== metadataCouponId ||
      !subscriptionHasExactCoupon(subscription, coupon.id)
    ) {
      return { kind: "ignored", reason: "initial_setup_coupon_mismatch" };
    }
  } else if (
    !entitlement && !membershipAlreadyCanonical &&
    !subscriptionHasExactCoupon(subscription, null)
  ) {
    return { kind: "ignored", reason: "unexpected_initial_setup_discount" };
  }

  return {
    kind: "verified",
    activationId,
    entitlement,
    instructorProfileId,
    membershipAlreadyCanonical,
    setupSessionId,
  };
}

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

    const setupSession = event.type === "checkout.session.completed"
      ? event.data.object as Stripe.Checkout.Session
      : null;
    if (
      setupSession?.mode === "setup" &&
      (setupSession.metadata?.product_line !== "hire_line_dancers" ||
        setupSession.metadata?.payment_setup_terms_version !==
          INSTRUCTOR_PAYMENT_SETUP_TERMS_VERSION)
    ) {
      return Response.json({ received: true, ignored: true });
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

    if (setupSession?.mode === "setup") {
      try {
        return await processInstructorPaymentSetupCompleted(
          event,
          ctx,
          stripeConfig,
        );
      } catch (error) {
        const message = error instanceof Error
          ? error.message
          : "Unknown payment setup sync error";
        console.error(
          "Stripe payment setup webhook processing failed",
          event.id,
          message,
        );
        return new Response("Payment setup sync failed", { status: 500 });
      }
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
      const isSetupManagedSubscription = setupActivationMarker(subscription);
      if (subscription.livemode !== stripeConfig.expectedLivemode) {
        if (isSetupManagedSubscription) {
          return Response.json({ received: true, ignored: true });
        }
        throw new Error("Subscription is in the wrong Stripe mode");
      }
      if (subscription.items.has_more) {
        if (isSetupManagedSubscription) {
          return Response.json({ received: true, ignored: true });
        }
        throw new Error("Subscription has too many items to verify safely");
      }

      const expectedPriceId = stripeConfig.priceId;
      const membershipItems = subscription.items.data.filter((item) =>
        item.price.id === expectedPriceId
      );
      let membershipItem: Stripe.SubscriptionItem | null =
        membershipItems[0] ?? null;
      if (
        membershipItem &&
        (membershipItems.length !== 1 || membershipItem.quantity !== 1 ||
          subscription.items.data.length !== 1)
      ) {
        if (isSetupManagedSubscription) {
          membershipItem = null;
        } else {
          throw new Error(
            "Subscription is not exactly one instructor membership",
          );
        }
      }

      const customerId = stripeObjectId(subscription.customer);
      if (!customerId) {
        if (isSetupManagedSubscription) {
          return Response.json({ received: true, ignored: true });
        }
        throw new Error("Subscription is missing a customer identifier");
      }

      let instructorProfileId = validUuid(
        subscription.metadata?.instructor_profile_id,
      ) ?? identifiers.instructorProfileId;
      const subscriptionUsesCurrentTerms = isSetupManagedSubscription ||
        membershipTermsState(subscription.metadata) === "current";
      if (
        subscriptionUsesCurrentTerms && !instructorProfileId &&
        !isSetupManagedSubscription
      ) {
        throw new Error(
          "Current membership terms require an instructor profile identifier",
        );
      }

      let setupActivation: Extract<
        SetupActivationCheck,
        { kind: "verified" }
      > | null = null;
      if (isSetupManagedSubscription) {
        const setupCheck = await canonicalSetupActivation(
          subscription,
          customerId,
          membershipItem,
          ctx,
          stripeConfig,
        );
        if (setupCheck.kind === "ignored") {
          console.warn(
            "Ignoring terminal setup membership event",
            event.id,
            setupCheck.reason,
          );
          return Response.json({ received: true, ignored: true });
        }
        if (setupCheck.kind !== "verified") {
          return Response.json({ received: true, ignored: true });
        }
        setupActivation = setupCheck;
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
          p_checkout_session_id: setupActivation?.setupSessionId ??
            checkoutSession?.id ?? null,
          p_latest_invoice_id: latestInvoiceId,
          p_subscription_created_at: new Date(subscription.created * 1000)
            .toISOString(),
          p_observed_at: observedAt,
        },
      );

      if (syncError) {
        if (
          setupActivation &&
          (syncError.code === "P0001" || syncError.code?.startsWith("23"))
        ) {
          console.warn(
            "Ignoring terminal setup membership database state",
            event.id,
            syncError.code,
          );
          return Response.json({ received: true, ignored: true });
        }
        console.error(
          "Stripe subscription sync failed",
          event.id,
          syncError.code,
          syncError.message,
        );
        return new Response("Subscription sync failed", { status: 500 });
      }

      let billingRecoveryResult: unknown = null;
      if (
        event.type === "invoice.payment_failed" && instructorProfileId &&
        membershipItem && syncResult !== "lifetime_access_ignored" &&
        syncResult !== "stale_subscription"
      ) {
        const failedInvoice = event.data.object as Stripe.Invoice;
        const failedInvoiceSubscriptionId = stripeInvoiceSubscriptionId(
          failedInvoice,
        );
        const failedInvoiceCustomerId = stripeObjectId(failedInvoice.customer);
        if (
          failedInvoiceSubscriptionId !== subscription.id ||
          failedInvoiceCustomerId !== customerId ||
          failedInvoice.currency.toLowerCase() !== "usd" ||
          failedInvoice.amount_due <= 0 ||
          !["subscription_create", "subscription_cycle"].includes(
            failedInvoice.billing_reason ?? "",
          )
        ) {
          throw new Error(
            "Failed invoice does not match the instructor membership",
          );
        }

        const { data, error } = await ctx.supabaseAdmin.rpc(
          "begin_instructor_billing_recovery",
          {
            p_event_id: event.id,
            p_instructor_profile_id: instructorProfileId,
            p_stripe_customer_id: customerId,
            p_stripe_subscription_id: subscription.id,
            p_stripe_invoice_id: failedInvoice.id,
            p_failed_at: new Date(event.created * 1000).toISOString(),
          },
        );
        if (error) {
          throw new Error(
            `Unable to start instructor billing recovery: ${error.code}`,
          );
        }
        billingRecoveryResult = data;
      } else if (
        event.type !== "invoice.payment_failed" && instructorProfileId &&
        ["inactive", "paused", "canceled", "refunded"].includes(
          membershipStatus,
        ) && syncResult !== "lifetime_access_ignored" &&
        syncResult !== "stale_subscription"
      ) {
        const { data, error } = await ctx.supabaseAdmin.rpc(
          "close_instructor_billing_recovery",
          {
            p_instructor_profile_id: instructorProfileId,
            p_stripe_subscription_id: subscription.id,
            p_reason: `subscription_${membershipStatus}`,
            p_closed_at: observedAt,
          },
        );
        if (error) {
          throw new Error(
            `Unable to close instructor billing recovery: ${error.code}`,
          );
        }
        billingRecoveryResult = data;
      }

      let offerResult: string | null = null;
      if (
        membershipItem && setupActivation?.entitlement &&
        ["active", "trialing"].includes(subscription.status) &&
        syncResult !== "lifetime_access_ignored" &&
        syncResult !== "stale_subscription"
      ) {
        const { data, error } = await ctx.supabaseAdmin.rpc(
          "redeem_instructor_offer_entitlement",
          {
            p_instructor_profile_id: setupActivation.instructorProfileId,
            p_entitlement_id: setupActivation.entitlement.id,
            p_stripe_checkout_session_id: setupActivation.setupSessionId,
            p_stripe_subscription_id: subscription.id,
          },
        );
        if (error) {
          throw new Error(
            `Unable to redeem the setup membership offer: ${error.code}`,
          );
        }
        offerResult = data;
      } else if (
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
      const billingRecoveryResolutions: string[] = [];
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

            const { data: recoveryResolution, error: recoveryError } = await ctx
              .supabaseAdmin.rpc(
                "resolve_instructor_billing_recovery",
                {
                  p_instructor_profile_id: instructorProfileId,
                  p_stripe_subscription_id: subscription.id,
                  p_stripe_invoice_id: paidInvoice.invoiceId,
                  p_recovered_at: paidInvoice.paidAt,
                },
              );
            if (recoveryError) {
              throw new Error(
                `Unable to resolve instructor billing recovery: ${recoveryError.code}`,
              );
            }
            billingRecoveryResolutions.push(String(recoveryResolution));
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
        billingRecoveryResult,
        billingRecoveryResolutions,
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
