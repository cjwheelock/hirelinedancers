import Stripe from "npm:stripe@^22";
import {
  hasCurrentMembershipTerms,
  type HldStripeConfig,
  requiredEnv,
  stripeInvoiceSubscriptionId,
  stripeObjectId,
  verifiedMembershipPrice,
} from "./hld-stripe.ts";
import { membershipCreditCouponMismatches } from "./hld-membership-credit-validation.ts";

export const MEMBERSHIP_FREE_MONTH_BENEFIT_CODE = "membership_free_month_v1";

type SupabaseAdmin = any;

type CreditApplication = {
  id: string;
  entitlement_id: string;
  instructor_profile_id: string;
  status: string;
  stripe_idempotency_key: string;
  stripe_customer_id: string;
  stripe_subscription_id: string;
  stripe_price_id: string;
  stripe_coupon_id: string | null;
  stripe_discount_id: string | null;
  livemode: boolean;
  started_at: string;
  applied_at: string | null;
};

type ApplyResult = {
  outcome: "applied" | "deferred" | "existing" | "empty";
  entitlementId: string | null;
  applicationId: string | null;
  deferredReason: string | null;
};

export type MembershipCreditConsumption = {
  invoiceId: string;
  customerId: string;
  subscriptionId: string;
  priceId: string;
  couponId: string;
  discountId: string;
  amountCents: number;
  currency: "usd";
  livemode: boolean;
};

class MembershipCreditConfigurationError extends Error {}

function stripeReadMayHaveFailed(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { type?: unknown; statusCode?: unknown };
  return candidate.type === "StripeAPIError" ||
    candidate.type === "StripeConnectionError" ||
    candidate.type === "StripeRateLimitError" ||
    candidate.statusCode === 429 ||
    (typeof candidate.statusCode === "number" && candidate.statusCode >= 500);
}

function failureCode(error: unknown): string {
  if (error instanceof Stripe.errors.StripeError) {
    const candidate = error.code ?? error.type ?? "stripe_request_rejected";
    return candidate.toLowerCase().replace(/[^a-z0-9_]+/g, "_").slice(0, 100);
  }
  return "stripe_request_rejected";
}

function discountCouponId(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as {
    coupon?: unknown;
    promotion_code?: unknown;
    source?: { type?: unknown; coupon?: unknown };
  };
  if (candidate.source?.type != null) {
    return candidate.source.type === "coupon"
      ? stripeObjectId(candidate.source.coupon)
      : null;
  }
  if (stripeObjectId(candidate.promotion_code)) return null;
  return stripeObjectId(candidate.coupon);
}

function exactInvoiceCouponDiscount(
  invoice: Stripe.Invoice,
  couponId: string,
): { discountId: string; couponId: string } | null {
  const discounts = (invoice as Stripe.Invoice & {
    discounts?: unknown[] | null;
  }).discounts ?? [];
  if (discounts.length !== 1) return null;

  const discountId = stripeObjectId(discounts[0]);
  if (!discountId || !/^di_[A-Za-z0-9]+$/.test(discountId)) return null;
  return discountCouponId(discounts[0]) === couponId
    ? { discountId, couponId }
    : null;
}

function exactSubscriptionDiscount(
  subscription: Stripe.Subscription,
  couponId: string,
): { discountId: string; couponId: string } | null {
  const candidate = subscription as unknown as {
    discounts?: unknown[] | null;
    items?: { data?: Array<{ discounts?: unknown[] | null }> };
  };
  const discounts = candidate.discounts ?? [];
  const hasItemDiscount = (candidate.items?.data ?? []).some((item) =>
    (item.discounts ?? []).length > 0
  );
  if (hasItemDiscount || discounts.length !== 1) return null;

  const discountId = stripeObjectId(discounts[0]);
  if (!discountId || !/^di_[A-Za-z0-9]+$/.test(discountId)) return null;
  return discountCouponId(discounts[0]) === couponId
    ? { discountId, couponId }
    : null;
}

function subscriptionHasAnyDiscount(
  subscription: Stripe.Subscription,
): boolean {
  const candidate = subscription as unknown as {
    discounts?: unknown[] | null;
    items?: { data?: Array<{ discounts?: unknown[] | null }> };
  };
  return (candidate.discounts ?? []).length > 0 ||
    (candidate.items?.data ?? []).some((item) =>
      (item.discounts ?? []).length > 0
    );
}

function customerHasDiscount(customer: Stripe.Customer): boolean {
  return Boolean(
    (customer as Stripe.Customer & { discount?: unknown }).discount,
  );
}

function expandedLatestInvoice(
  subscription: Stripe.Subscription,
): Stripe.Invoice | null {
  const invoice = subscription.latest_invoice;
  if (!invoice || typeof invoice === "string") return null;
  return invoice as Stripe.Invoice;
}

function applicationMetadataMatches(
  subscription: Stripe.Subscription,
  application: CreditApplication,
): boolean {
  return subscription.metadata.membership_credit_application_id ===
      application.id &&
    subscription.metadata.membership_credit_entitlement_id ===
      application.entitlement_id &&
    subscription.metadata.membership_credit_benefit ===
      MEMBERSHIP_FREE_MONTH_BENEFIT_CODE;
}

async function deferApplication(
  supabaseAdmin: SupabaseAdmin,
  applicationId: string,
  reason: string,
  options: { failureCode?: string; needsReview?: boolean } = {},
): Promise<ApplyResult> {
  const { data, error } = await supabaseAdmin.rpc(
    "defer_membership_credit_application",
    {
      p_application_id: applicationId,
      p_deferred_reason: reason,
      p_failure_code: options.failureCode ?? null,
      p_needs_review: options.needsReview ?? false,
    },
  );
  if (error) {
    throw new Error(`Unable to defer membership credit: ${error.code}`);
  }

  return {
    outcome: "deferred",
    entitlementId: data?.entitlementId ?? null,
    applicationId,
    deferredReason: reason,
  };
}

export async function verifiedMembershipCreditCoupon(
  stripe: Stripe,
  config: HldStripeConfig,
): Promise<Stripe.Coupon> {
  const couponId = requiredEnv("STRIPE_MEMBERSHIP_FREE_MONTH_COUPON_ID");
  if (
    !/^[A-Za-z0-9_-]+$/.test(couponId) ||
    couponId === "Z00npt3G" ||
    couponId.toLowerCase() === "freemonth"
  ) {
    throw new MembershipCreditConfigurationError(
      "The membership credit Coupon identifier is invalid or legacy",
    );
  }

  const coupon = await stripe.coupons.retrieve(couponId);
  const mismatches = membershipCreditCouponMismatches(coupon, {
    expectedLivemode: config.expectedLivemode,
    productId: config.productId,
  });
  if (mismatches.length > 0) {
    throw new MembershipCreditConfigurationError(
      `The membership credit Coupon is unsafe: ${mismatches.join(",")}`,
    );
  }

  const promotionCodes = await stripe.promotionCodes.list({
    coupon: coupon.id,
    limit: 1,
  });
  if (promotionCodes.data.length > 0 || promotionCodes.has_more) {
    throw new MembershipCreditConfigurationError(
      "The membership credit Coupon must not have a Promotion Code",
    );
  }

  return coupon;
}

async function markApplied(
  supabaseAdmin: SupabaseAdmin,
  application: CreditApplication,
  couponId: string,
  discountId: string,
  requestId: string | null,
): Promise<ApplyResult> {
  const { data, error } = await supabaseAdmin.rpc(
    "mark_membership_credit_applied",
    {
      p_application_id: application.id,
      p_stripe_customer_id: application.stripe_customer_id,
      p_stripe_subscription_id: application.stripe_subscription_id,
      p_stripe_price_id: application.stripe_price_id,
      p_stripe_coupon_id: couponId,
      p_stripe_discount_id: discountId,
      p_stripe_request_id: requestId,
      p_applied_at: new Date().toISOString(),
    },
  );
  if (error) {
    throw new Error(
      `Unable to record applied membership credit: ${error.code}`,
    );
  }

  return {
    outcome: data?.result === "existing" ? "existing" : "applied",
    entitlementId: application.entitlement_id,
    applicationId: application.id,
    deferredReason: null,
  };
}

export async function applyPendingMembershipCredit(
  stripe: Stripe,
  supabaseAdmin: SupabaseAdmin,
  config: HldStripeConfig,
  instructorProfileId: string,
  entitlementId: string | null = null,
): Promise<ApplyResult> {
  const { data: claim, error: claimError } = await supabaseAdmin.rpc(
    "claim_membership_credit_application",
    {
      p_instructor_profile_id: instructorProfileId,
      p_entitlement_id: entitlementId,
      p_expected_price_id: config.priceId,
      p_expected_livemode: config.expectedLivemode,
    },
  );
  if (claimError) {
    throw new Error(`Unable to claim membership credit: ${claimError.code}`);
  }

  if (claim?.result === "empty") {
    return {
      outcome: "empty",
      entitlementId,
      applicationId: null,
      deferredReason: null,
    };
  }
  if (claim?.result === "deferred") {
    return {
      outcome: "deferred",
      entitlementId: claim.entitlementId ?? entitlementId,
      applicationId: null,
      deferredReason: claim.deferredReason ?? "another_credit_in_progress",
    };
  }
  if (claim?.result === "existing" || claim?.result === "applied") {
    const existingApplication = claim.application as
      | CreditApplication
      | undefined;
    return {
      outcome: "existing",
      entitlementId: existingApplication?.entitlement_id ?? entitlementId,
      applicationId: existingApplication?.id ?? null,
      deferredReason: null,
    };
  }

  const application = claim?.application as CreditApplication | undefined;
  const isResuming = claim?.result === "resuming";
  if (
    !application?.id || !application.entitlement_id ||
    !application.stripe_idempotency_key
  ) {
    throw new Error("Membership credit claim returned incomplete facts");
  }

  let coupon: Stripe.Coupon;
  try {
    await verifiedMembershipPrice(stripe, config);
    coupon = await verifiedMembershipCreditCoupon(stripe, config);
  } catch (error) {
    if (stripeReadMayHaveFailed(error)) throw error;
    if (isResuming) {
      return {
        outcome: "existing",
        entitlementId: application.entitlement_id,
        applicationId: application.id,
        deferredReason: "stripe_reconciliation_pending",
      };
    }
    return await deferApplication(
      supabaseAdmin,
      application.id,
      "stripe_configuration",
      { failureCode: "membership_credit_configuration_invalid" },
    );
  }

  let subscription: Stripe.Subscription;
  let customer: Stripe.Customer | Stripe.DeletedCustomer;
  try {
    [subscription, customer] = await Promise.all([
      stripe.subscriptions.retrieve(application.stripe_subscription_id, {
        expand: ["items.data.price", "discounts", "latest_invoice"],
      }),
      stripe.customers.retrieve(application.stripe_customer_id),
    ]);
  } catch (error) {
    if (stripeReadMayHaveFailed(error)) throw error;
    return await deferApplication(
      supabaseAdmin,
      application.id,
      "stripe_state_changed",
      { failureCode: failureCode(error), needsReview: true },
    );
  }

  if (
    subscription.id !== application.stripe_subscription_id ||
    stripeObjectId(subscription.customer) !== application.stripe_customer_id ||
    subscription.livemode !== config.expectedLivemode ||
    subscription.metadata.product_line !== "hire_line_dancers" ||
    subscription.metadata.instructor_profile_id !== instructorProfileId ||
    !hasCurrentMembershipTerms(subscription.metadata) ||
    customer.deleted || customer.id !== application.stripe_customer_id ||
    customer.livemode !== config.expectedLivemode
  ) {
    return await deferApplication(
      supabaseAdmin,
      application.id,
      "billing_identity_mismatch",
      { needsReview: true },
    );
  }

  const cadenceMatches = !subscription.items.has_more &&
    subscription.items.data.length === 1 &&
    subscription.items.data[0].price.id === config.priceId &&
    subscription.items.data[0].quantity === 1 &&
    application.stripe_price_id === config.priceId;
  const existingCreditDiscount = exactSubscriptionDiscount(
    subscription,
    coupon.id,
  );
  if (isResuming && applicationMetadataMatches(subscription, application)) {
    if (
      existingCreditDiscount && cadenceMatches &&
      ["active", "trialing"].includes(subscription.status) &&
      !subscription.cancel_at_period_end
    ) {
      return await markApplied(
        supabaseAdmin,
        application,
        coupon.id,
        existingCreditDiscount.discountId,
        null,
      );
    }
    return {
      outcome: "existing",
      entitlementId: application.entitlement_id,
      applicationId: application.id,
      deferredReason: "stripe_reconciliation_pending",
    };
  }

  if (
    !cadenceMatches
  ) {
    return await deferApplication(
      supabaseAdmin,
      application.id,
      "unsupported_cadence",
    );
  }
  if (!["active", "trialing"].includes(subscription.status)) {
    return await deferApplication(
      supabaseAdmin,
      application.id,
      "membership_inactive",
    );
  }
  if (subscription.cancel_at_period_end) {
    return await deferApplication(
      supabaseAdmin,
      application.id,
      "cancellation_scheduled",
    );
  }

  if (existingCreditDiscount) {
    if (!applicationMetadataMatches(subscription, application)) {
      return await deferApplication(
        supabaseAdmin,
        application.id,
        "existing_discount",
      );
    }
    return await markApplied(
      supabaseAdmin,
      application,
      coupon.id,
      existingCreditDiscount.discountId,
      null,
    );
  }

  if (
    customerHasDiscount(customer) || subscriptionHasAnyDiscount(subscription)
  ) {
    return await deferApplication(
      supabaseAdmin,
      application.id,
      "existing_discount",
    );
  }

  const latestInvoice = expandedLatestInvoice(subscription);
  if (latestInvoice && ["draft", "open"].includes(latestInvoice.status ?? "")) {
    return await deferApplication(
      supabaseAdmin,
      application.id,
      "invoice_in_progress",
    );
  }

  let updated: Stripe.Subscription;
  try {
    updated = await stripe.subscriptions.update(
      subscription.id,
      {
        discounts: [{ coupon: coupon.id }],
        metadata: {
          membership_credit_application_id: application.id,
          membership_credit_entitlement_id: application.entitlement_id,
          membership_credit_benefit: MEMBERSHIP_FREE_MONTH_BENEFIT_CODE,
        },
        proration_behavior: "none",
        expand: ["items.data.price", "discounts", "latest_invoice"],
      },
      { idempotencyKey: application.stripe_idempotency_key },
    );
  } catch (error) {
    if (stripeReadMayHaveFailed(error)) throw error;
    return await deferApplication(
      supabaseAdmin,
      application.id,
      "stripe_request_rejected",
      { failureCode: failureCode(error) },
    );
  }

  const appliedDiscount = exactSubscriptionDiscount(updated, coupon.id);
  if (
    !appliedDiscount || !applicationMetadataMatches(updated, application) ||
    updated.id !== subscription.id ||
    stripeObjectId(updated.customer) !== application.stripe_customer_id
  ) {
    return await deferApplication(
      supabaseAdmin,
      application.id,
      "stripe_state_changed",
      { needsReview: true },
    );
  }

  const requestId = (updated as Stripe.Subscription & {
    lastResponse?: { requestId?: string };
  }).lastResponse?.requestId ?? null;
  return await markApplied(
    supabaseAdmin,
    application,
    coupon.id,
    appliedDiscount.discountId,
    requestId,
  );
}

function invoiceLinePriceId(line: Stripe.InvoiceLineItem): string | null {
  return stripeObjectId(line.pricing?.price_details?.price);
}

function lineDiscountAmount(
  line: Stripe.InvoiceLineItem,
  expectedDiscountId: string,
): number | null {
  const discountAmounts = (line as Stripe.InvoiceLineItem & {
    discount_amounts?: Array<{ amount?: number; discount?: unknown }>;
  }).discount_amounts ?? [];
  const matches = discountAmounts.filter((discountAmount) =>
    stripeObjectId(discountAmount.discount) === expectedDiscountId
  );
  if (
    matches.length !== 1 || !Number.isInteger(matches[0].amount) ||
    (matches[0].amount ?? 0) <= 0
  ) {
    return null;
  }
  return matches[0].amount ?? null;
}

function invoiceCreditApplicationId(invoice: Stripe.Invoice): string | null {
  const applicationId = invoice.parent?.subscription_details?.metadata
    ?.membership_credit_application_id;
  return typeof applicationId === "string" &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
        .test(applicationId)
    ? applicationId
    : null;
}

async function consumptionReadyApplication(
  stripe: Stripe,
  config: HldStripeConfig,
  application: CreditApplication,
  invoice: Stripe.Invoice,
  knownSubscription: Stripe.Subscription | null = null,
): Promise<{
  application: CreditApplication;
  invoice: Stripe.Invoice;
}> {
  const hasCoupon = application.stripe_coupon_id != null;
  const hasDiscount = application.stripe_discount_id != null;
  if (hasCoupon !== hasDiscount) {
    throw new Error("Membership credit has partial Stripe discount facts");
  }
  if (hasCoupon && hasDiscount) return { application, invoice };
  if (!["applying", "abandoned"].includes(application.status)) {
    throw new Error("Membership credit cannot recover Stripe discount facts");
  }

  await verifiedMembershipPrice(stripe, config);
  const [subscription, exactInvoice, coupon] = await Promise.all([
    knownSubscription ?? stripe.subscriptions.retrieve(
      application.stripe_subscription_id,
      { expand: ["items.data.price", "discounts", "latest_invoice"] },
    ),
    stripe.invoices.retrieve(invoice.id, { expand: ["discounts"] }),
    verifiedMembershipCreditCoupon(stripe, config),
  ]);

  if (
    exactInvoice.id !== invoice.id ||
    invoiceCreditApplicationId(exactInvoice) !== application.id ||
    subscription.id !== application.stripe_subscription_id ||
    stripeObjectId(subscription.customer) !== application.stripe_customer_id ||
    subscription.livemode !== config.expectedLivemode ||
    subscription.metadata.product_line !== "hire_line_dancers" ||
    subscription.metadata.instructor_profile_id !==
      application.instructor_profile_id ||
    !hasCurrentMembershipTerms(subscription.metadata) ||
    !applicationMetadataMatches(subscription, application) ||
    subscription.items.has_more || subscription.items.data.length !== 1 ||
    subscription.items.data[0].price.id !== config.priceId ||
    subscription.items.data[0].quantity !== 1 ||
    application.stripe_price_id !== config.priceId
  ) {
    throw new Error(
      "Membership credit recovery does not match the Stripe subscription",
    );
  }

  const invoiceDiscount = exactInvoiceCouponDiscount(exactInvoice, coupon.id);
  if (!invoiceDiscount) {
    throw new Error(
      "Membership credit recovery invoice has an unexpected discount",
    );
  }

  return {
    application: {
      ...application,
      status: "applied",
      stripe_coupon_id: coupon.id,
      stripe_discount_id: invoiceDiscount.discountId,
      applied_at: new Date().toISOString(),
    },
    invoice: exactInvoice,
  };
}

export async function verifiedMembershipCreditConsumption(
  stripe: Stripe,
  config: HldStripeConfig,
  invoiceId: string,
  application: CreditApplication,
  knownInvoice: Stripe.Invoice | null = null,
): Promise<MembershipCreditConsumption | null> {
  if (!/^in_[A-Za-z0-9]+$/.test(invoiceId)) {
    throw new Error("Stripe invoice identifier is invalid");
  }
  if (!application.stripe_coupon_id || !application.stripe_discount_id) {
    throw new Error("Applied membership credit is missing Stripe facts");
  }

  const invoice = knownInvoice ?? await stripe.invoices.retrieve(invoiceId);
  if (invoice.id !== invoiceId) {
    throw new Error("Stripe invoice identifier changed during verification");
  }
  const invoiceMetadata = invoice.parent?.subscription_details?.metadata;
  if (
    invoice.livemode !== config.expectedLivemode ||
    stripeObjectId(invoice.customer) !== application.stripe_customer_id ||
    stripeInvoiceSubscriptionId(invoice) !==
      application.stripe_subscription_id ||
    invoice.currency.toLowerCase() !== "usd" ||
    !["subscription_create", "subscription_cycle"].includes(
      invoice.billing_reason ?? "",
    ) ||
    !["open", "paid"].includes(invoice.status ?? "") ||
    invoiceMetadata?.product_line !== "hire_line_dancers" ||
    invoiceMetadata?.instructor_profile_id !==
      application.instructor_profile_id ||
    invoiceMetadata?.membership_credit_application_id !== application.id ||
    invoiceMetadata?.membership_credit_entitlement_id !==
      application.entitlement_id ||
    invoiceMetadata?.membership_credit_benefit !==
      MEMBERSHIP_FREE_MONTH_BENEFIT_CODE ||
    !hasCurrentMembershipTerms(invoiceMetadata)
  ) {
    return null;
  }

  const lineItems = await stripe.invoices.listLineItems(invoice.id, {
    limit: 100,
  });
  if (lineItems.has_more) {
    throw new Error("Stripe invoice has too many line items to verify safely");
  }
  const membershipLines = lineItems.data.filter((line) =>
    invoiceLinePriceId(line) === config.priceId
  );
  const hasOtherPricedAmount = lineItems.data.some((line) =>
    line.amount !== 0 && invoiceLinePriceId(line) !== config.priceId
  );
  if (
    membershipLines.length !== 1 || membershipLines[0].quantity !== 1 ||
    hasOtherPricedAmount || membershipLines[0].amount <= 0
  ) {
    return null;
  }

  const amountCents = lineDiscountAmount(
    membershipLines[0],
    application.stripe_discount_id,
  );
  if (amountCents !== membershipLines[0].amount) return null;

  return {
    invoiceId: invoice.id,
    customerId: application.stripe_customer_id,
    subscriptionId: application.stripe_subscription_id,
    priceId: application.stripe_price_id,
    couponId: application.stripe_coupon_id,
    discountId: application.stripe_discount_id,
    amountCents,
    currency: "usd",
    livemode: invoice.livemode,
  };
}

async function recordMembershipCreditConsumption(
  supabaseAdmin: SupabaseAdmin,
  sourceEventId: string,
  application: CreditApplication,
  consumption: MembershipCreditConsumption,
  consumedAt: string,
): Promise<Record<string, unknown>> {
  const { data: result, error: consumeError } = await supabaseAdmin.rpc(
    "consume_membership_credit_application",
    {
      p_event_id: sourceEventId,
      p_application_id: application.id,
      p_stripe_customer_id: consumption.customerId,
      p_stripe_subscription_id: consumption.subscriptionId,
      p_stripe_price_id: consumption.priceId,
      p_stripe_coupon_id: consumption.couponId,
      p_stripe_discount_id: consumption.discountId,
      p_stripe_invoice_id: consumption.invoiceId,
      p_actual_discount_amount_cents: consumption.amountCents,
      p_currency: consumption.currency,
      p_livemode: consumption.livemode,
      p_consumed_at: consumedAt,
    },
  );
  if (consumeError) {
    throw new Error(
      `Unable to consume membership credit: ${consumeError.code}`,
    );
  }
  return result;
}

export async function reconcileMembershipCreditInvoice(
  stripe: Stripe,
  supabaseAdmin: SupabaseAdmin,
  config: HldStripeConfig,
  event: Stripe.Event,
  invoice: Stripe.Invoice,
): Promise<Record<string, unknown> | null> {
  const subscriptionId = stripeInvoiceSubscriptionId(invoice);
  const applicationId = invoiceCreditApplicationId(invoice);
  if (!subscriptionId || !applicationId) return null;

  const { data, error } = await supabaseAdmin
    .from("membership_credit_applications")
    .select(
      "id,entitlement_id,instructor_profile_id,status,stripe_idempotency_key,stripe_customer_id,stripe_subscription_id,stripe_price_id,stripe_coupon_id,stripe_discount_id,livemode,started_at,applied_at",
    )
    .eq("id", applicationId)
    .eq("stripe_subscription_id", subscriptionId)
    .in("status", ["applying", "applied", "abandoned"])
    .maybeSingle();
  if (error) {
    throw new Error(`Unable to load applied membership credit: ${error.code}`);
  }
  const application = data as CreditApplication | null;
  if (!application) return null;

  const ready = await consumptionReadyApplication(
    stripe,
    config,
    application,
    invoice,
  );
  const consumption = await verifiedMembershipCreditConsumption(
    stripe,
    config,
    ready.invoice.id,
    ready.application,
    ready.invoice,
  );
  if (!consumption) return null;

  return await recordMembershipCreditConsumption(
    supabaseAdmin,
    event.id,
    ready.application,
    consumption,
    new Date(event.created * 1000).toISOString(),
  );
}

export async function reconcileOrRequeueCanceledMembershipCredits(
  stripe: Stripe,
  supabaseAdmin: SupabaseAdmin,
  config: HldStripeConfig,
  event: Stripe.Event,
  subscription: Stripe.Subscription,
  instructorProfileId: string,
): Promise<{
  requeuedCount: number;
  consumptionResult: Record<string, unknown> | null;
}> {
  const { data, error } = await supabaseAdmin
    .from("membership_credit_applications")
    .select(
      "id,entitlement_id,instructor_profile_id,status,stripe_idempotency_key,stripe_customer_id,stripe_subscription_id,stripe_price_id,stripe_coupon_id,stripe_discount_id,livemode,started_at,applied_at",
    )
    .eq("instructor_profile_id", instructorProfileId)
    .eq("stripe_subscription_id", subscription.id)
    .in("status", ["applying", "applied"])
    .maybeSingle();
  if (error) {
    throw new Error(
      `Unable to load canceling membership credit: ${error.code}`,
    );
  }

  const application = data as CreditApplication | null;
  if (application) {
    const startedAt = Date.parse(
      application.applied_at ?? application.started_at,
    );
    if (!Number.isFinite(startedAt)) {
      throw new Error("Membership credit application time is invalid");
    }
    const invoices = await stripe.invoices.list({
      subscription: subscription.id,
      created: { gte: Math.max(0, Math.floor(startedAt / 1000) - 300) },
      limit: 100,
    });
    if (invoices.has_more) {
      throw new Error(
        "Too many cancellation invoices to verify membership credit safely",
      );
    }

    const matchingInvoices = invoices.data.filter((invoice) =>
      invoiceCreditApplicationId(invoice) === application.id
    );
    if (matchingInvoices.length > 1) {
      throw new Error(
        "Multiple cancellation invoices reference one membership credit",
      );
    }

    const matchingInvoice = matchingInvoices[0] ?? null;
    if (
      matchingInvoice &&
      ["draft", "open", "paid"].includes(matchingInvoice.status ?? "")
    ) {
      if (matchingInvoice.status === "draft") {
        throw new Error(
          "Canceling membership credit has a draft Stripe invoice",
        );
      }

      const ready = await consumptionReadyApplication(
        stripe,
        config,
        application,
        matchingInvoice,
        subscription,
      );
      const consumption = await verifiedMembershipCreditConsumption(
        stripe,
        config,
        ready.invoice.id,
        ready.application,
        ready.invoice,
      );
      if (!consumption) {
        throw new Error(
          "Canceling membership credit invoice could not be verified",
        );
      }
      const finalizedAt = matchingInvoice.status_transitions?.finalized_at;
      const consumptionResult = await recordMembershipCreditConsumption(
        supabaseAdmin,
        `${event.id}:cancellation:${matchingInvoice.id}`,
        ready.application,
        consumption,
        new Date((finalizedAt ?? event.created) * 1000).toISOString(),
      );
      return { requeuedCount: 0, consumptionResult };
    }
    if (
      matchingInvoice &&
      !["void", "uncollectible"].includes(matchingInvoice.status ?? "")
    ) {
      throw new Error(
        "Canceling membership credit invoice has an unknown status",
      );
    }
  }

  return {
    requeuedCount: await requeueCanceledMembershipCredits(
      supabaseAdmin,
      instructorProfileId,
      subscription.id,
    ),
    consumptionResult: null,
  };
}

export async function requeueCanceledMembershipCredits(
  supabaseAdmin: SupabaseAdmin,
  instructorProfileId: string,
  subscriptionId: string,
): Promise<number> {
  const { data, error } = await supabaseAdmin.rpc(
    "requeue_canceled_membership_credits",
    {
      p_instructor_profile_id: instructorProfileId,
      p_stripe_subscription_id: subscriptionId,
    },
  );
  if (error) {
    throw new Error(`Unable to requeue membership credit: ${error.code}`);
  }
  return Number(data ?? 0);
}
