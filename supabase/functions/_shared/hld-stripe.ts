import Stripe from "npm:stripe@^22";

const MONTHLY_PRICE_CENTS = 1499;
export const INSTRUCTOR_OUTREACH_OFFER_CODE =
  "outreach_two_months_90_day_v1";
export const INSTRUCTOR_OUTREACH_OFFER_MONTHS = 2;
export const MEMBERSHIP_CHECKOUT_TERMS_VERSION =
  "2026-08-07-membership-v2";
export const MEMBERSHIP_GUARANTEE_TERMS_VERSION =
  "2026-08-07-90-day-paid-invoice-v1";
const PRODUCTION_HOSTS = new Set([
  "hirelinedancers.com",
  "www.hirelinedancers.com",
]);

export type HldStripeConfig = {
  appUrl: URL;
  expectedLivemode: boolean;
  isProduction: boolean;
  priceId: string;
  productId: string;
};

export function requiredEnv(name: string): string {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`Missing required secret: ${name}`);
  return value;
}

export function hldStripeConfig(): HldStripeConfig {
  const configuredAppUrl = new URL(requiredEnv("APP_URL"));
  const isLocal = configuredAppUrl.hostname === "localhost" ||
    configuredAppUrl.hostname === "127.0.0.1";
  if (configuredAppUrl.protocol !== "https:" && !isLocal) {
    throw new Error("APP_URL must use HTTPS outside local development");
  }

  const expectedMode = requiredEnv("STRIPE_EXPECTED_MODE").toLowerCase();
  if (expectedMode !== "live" && expectedMode !== "test") {
    throw new Error("STRIPE_EXPECTED_MODE must be either live or test");
  }

  const isProduction = PRODUCTION_HOSTS.has(
    configuredAppUrl.hostname.toLowerCase(),
  );
  const expectedLivemode = expectedMode === "live";
  if (isProduction && !expectedLivemode) {
    throw new Error("Production APP_URL requires STRIPE_EXPECTED_MODE=live");
  }

  const priceId = requiredEnv("STRIPE_PRICE_ID");
  const productId = requiredEnv("STRIPE_PRODUCT_ID");
  if (!/^price_[A-Za-z0-9]+$/.test(priceId)) {
    throw new Error("STRIPE_PRICE_ID is not a valid Stripe Price identifier");
  }
  if (!/^prod_[A-Za-z0-9]+$/.test(productId)) {
    throw new Error(
      "STRIPE_PRODUCT_ID is not a valid Stripe Product identifier",
    );
  }

  return {
    appUrl: configuredAppUrl,
    expectedLivemode,
    isProduction,
    priceId,
    productId,
  };
}

export function checkoutTermsRequired(config: HldStripeConfig): boolean {
  const setting = requiredEnv("STRIPE_REQUIRE_TERMS_CONSENT").toLowerCase();
  if (setting !== "true" && setting !== "false") {
    throw new Error(
      "STRIPE_REQUIRE_TERMS_CONSENT must be either true or false",
    );
  }

  const required = setting === "true";
  if (config.expectedLivemode && !required) {
    throw new Error("Live Checkout requires STRIPE_REQUIRE_TERMS_CONSENT=true");
  }
  return required;
}

export async function verifiedMembershipPrice(
  stripe: Stripe,
  config: HldStripeConfig,
): Promise<Stripe.Price> {
  const price = await stripe.prices.retrieve(config.priceId);
  const actualProductId = typeof price.product === "string"
    ? price.product
    : price.product.id;

  if (
    !price.active ||
    price.livemode !== config.expectedLivemode ||
    actualProductId !== config.productId ||
    price.type !== "recurring" ||
    price.currency.toLowerCase() !== "usd" ||
    price.unit_amount !== MONTHLY_PRICE_CENTS ||
    price.recurring?.interval !== "month" ||
    price.recurring.interval_count !== 1
  ) {
    throw new Error(
      "Configured Stripe Price is not the expected Hire Line Dancers membership Price",
    );
  }

  const product = await stripe.products.retrieve(config.productId) as
    & Stripe.Product
    & {
      deleted?: boolean;
    };
  if (
    product.deleted || !product.active ||
    product.livemode !== config.expectedLivemode
  ) {
    throw new Error(
      "Configured Stripe Product is inactive, deleted, or in the wrong Stripe mode",
    );
  }

  return price;
}

export async function verifiedInstructorOfferCoupon(
  stripe: Stripe,
  config: HldStripeConfig,
): Promise<Stripe.Coupon> {
  const couponId = requiredEnv("STRIPE_INSTRUCTOR_OFFER_COUPON_ID");
  if (!/^[A-Za-z0-9_-]+$/.test(couponId)) {
    throw new Error(
      "STRIPE_INSTRUCTOR_OFFER_COUPON_ID is not a valid Stripe Coupon identifier",
    );
  }

  const coupon = await stripe.coupons.retrieve(couponId);
  const appliedProducts = coupon.applies_to?.products ?? [];
  if (
    !coupon.valid ||
    coupon.livemode !== config.expectedLivemode ||
    coupon.percent_off !== 100 ||
    coupon.amount_off !== null ||
    coupon.duration !== "repeating" ||
    coupon.duration_in_months !== INSTRUCTOR_OUTREACH_OFFER_MONTHS ||
    coupon.max_redemptions !== null ||
    coupon.redeem_by !== null ||
    appliedProducts.length !== 1 ||
    appliedProducts[0] !== config.productId
  ) {
    throw new Error(
      "Configured Stripe Coupon is not the exact two-month instructor outreach offer",
    );
  }

  return coupon;
}

export type VerifiedPaidMembershipInvoice = {
  invoiceId: string;
  customerId: string;
  subscriptionId: string;
  priceId: string;
  amountPaidCents: number;
  currency: "usd";
  paidAt: string;
  billingReason: "subscription_create" | "subscription_cycle";
  livemode: boolean;
};

export type InstructorCheckoutOffer = {
  invitationId: string;
  offerCode: typeof INSTRUCTOR_OUTREACH_OFFER_CODE;
  couponId: string;
};

type StripeMetadata = Record<string, string> | null | undefined;

export function hasCurrentMembershipTerms(
  metadata: StripeMetadata,
): boolean {
  return metadata?.checkout_terms_version ===
      MEMBERSHIP_CHECKOUT_TERMS_VERSION &&
    metadata?.guarantee_terms_version ===
      MEMBERSHIP_GUARANTEE_TERMS_VERSION;
}

export function membershipTermsState(
  metadata: StripeMetadata,
): "current" | "legacy" {
  if (hasCurrentMembershipTerms(metadata)) return "current";
  if (
    metadata?.checkout_terms_version === MEMBERSHIP_CHECKOUT_TERMS_VERSION ||
    metadata?.guarantee_terms_version ===
      MEMBERSHIP_GUARANTEE_TERMS_VERSION
  ) {
    throw new Error("Stripe membership terms metadata is inconsistent");
  }
  return "legacy";
}

export function instructorCheckoutOffer(
  metadata: StripeMetadata,
): InstructorCheckoutOffer | null {
  const offerCode = metadata?.offer_code;
  const invitationId = metadata?.offer_invitation_id;
  const couponId = metadata?.offer_coupon_id;

  if (
    offerCode === "none" && invitationId === "none" && couponId === "none"
  ) {
    return null;
  }
  if (
    offerCode !== INSTRUCTOR_OUTREACH_OFFER_CODE ||
    !invitationId ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      .test(invitationId) ||
    !couponId ||
    !/^[A-Za-z0-9_-]+$/.test(couponId)
  ) {
    throw new Error("Stripe Checkout offer metadata is invalid");
  }

  return {
    invitationId,
    offerCode: INSTRUCTOR_OUTREACH_OFFER_CODE,
    couponId,
  };
}

function stripeCouponId(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return null;

  const candidate = value as {
    id?: unknown;
    coupon?: unknown;
    source?: { type?: unknown; coupon?: unknown };
  };
  if (candidate.source?.type === "coupon") {
    return stripeObjectId(candidate.source.coupon);
  }
  return stripeObjectId(candidate.coupon);
}

export function checkoutSessionHasExactCoupon(
  session: Stripe.Checkout.Session,
  expectedCouponId: string | null,
): boolean {
  const candidate = session as unknown as {
    discounts?: Array<{
      coupon?: unknown;
      promotion_code?: unknown;
      source?: { type?: unknown; coupon?: unknown };
    }> | null;
  };
  const discounts = candidate.discounts ?? [];

  if (!expectedCouponId) return discounts.length === 0;
  return discounts.length === 1 &&
    stripeCouponId(discounts[0]) === expectedCouponId &&
    !stripeObjectId(discounts[0].promotion_code) &&
    discounts[0].source?.type !== "promotion_code";
}

export function subscriptionHasExactCoupon(
  subscription: Stripe.Subscription,
  expectedCouponId: string | null,
): boolean {
  const candidate = subscription as unknown as {
    discounts?: unknown[] | null;
    items?: { data?: Array<{ discounts?: unknown[] | null }> };
  };
  const discounts = candidate.discounts ?? [];
  const hasItemDiscount = (candidate.items?.data ?? []).some((item) =>
    (item.discounts ?? []).length > 0
  );

  if (hasItemDiscount) return false;
  if (!expectedCouponId) return discounts.length === 0;
  return discounts.length === 1 &&
    stripeCouponId(discounts[0]) === expectedCouponId;
}

function invoiceLinePriceId(line: Stripe.InvoiceLineItem): string | null {
  return stripeObjectId(line.pricing?.price_details?.price);
}

export function stripeInvoiceSubscriptionId(
  invoice: Stripe.Invoice,
): string | null {
  const value = invoice as unknown as {
    subscription?: unknown;
    parent?: { subscription_details?: { subscription?: unknown } };
  };
  return stripeObjectId(value.subscription) ??
    stripeObjectId(value.parent?.subscription_details?.subscription);
}

export async function verifiedPaidMembershipInvoice(
  stripe: Stripe,
  config: HldStripeConfig,
  invoiceId: string,
  expected: {
    customerId: string;
    subscriptionId: string;
    instructorProfileId: string;
  },
): Promise<VerifiedPaidMembershipInvoice | null> {
  if (!/^in_[A-Za-z0-9]+$/.test(invoiceId)) {
    throw new Error("Stripe invoice identifier is invalid");
  }

  const invoice = await stripe.invoices.retrieve(invoiceId);
  const customerId = stripeObjectId(invoice.customer);
  const subscriptionId = stripeInvoiceSubscriptionId(invoice);
  const billingReason = invoice.billing_reason;
  const subscriptionMetadata = invoice.parent?.subscription_details?.metadata;

  if (
    invoice.livemode !== config.expectedLivemode ||
    invoice.status !== "paid" ||
    customerId !== expected.customerId ||
    subscriptionId !== expected.subscriptionId ||
    invoice.currency.toLowerCase() !== "usd" ||
    (billingReason !== "subscription_create" &&
      billingReason !== "subscription_cycle") ||
    subscriptionMetadata?.product_line !== "hire_line_dancers" ||
    subscriptionMetadata?.instructor_profile_id !==
      expected.instructorProfileId ||
    !hasCurrentMembershipTerms(subscriptionMetadata)
  ) {
    throw new Error(
      "Stripe invoice does not match the canonical instructor membership",
    );
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
    hasOtherPricedAmount
  ) {
    throw new Error(
      "Stripe invoice is not exactly one instructor membership",
    );
  }

  if (invoice.amount_paid === 0) return null;
  if (invoice.amount_paid < 0) {
    throw new Error("Stripe invoice has an invalid paid amount");
  }

  const paidAt = invoice.status_transitions.paid_at;
  if (!paidAt) {
    throw new Error("Paid Stripe invoice is missing its paid timestamp");
  }

  return {
    invoiceId: invoice.id,
    customerId,
    subscriptionId,
    priceId: config.priceId,
    amountPaidCents: invoice.amount_paid,
    currency: "usd",
    paidAt: new Date(paidAt * 1000).toISOString(),
    billingReason,
    livemode: invoice.livemode,
  };
}

export async function verifiedPaidMembershipInvoices(
  stripe: Stripe,
  config: HldStripeConfig,
  expected: {
    customerId: string;
    subscriptionId: string;
    instructorProfileId: string;
  },
  requiredInvoiceId?: string,
  knownInvoiceIds: Iterable<string> = [],
): Promise<VerifiedPaidMembershipInvoice[]> {
  const invoices = await stripe.invoices.list({
    customer: expected.customerId,
    subscription: expected.subscriptionId,
    status: "paid",
    limit: 100,
  });
  if (invoices.has_more && !requiredInvoiceId) {
    throw new Error(
      "Stripe returned too many paid membership invoices to reconcile safely",
    );
  }

  const known = new Set(knownInvoiceIds);
  const invoiceIds = new Set(
    invoices.has_more
      ? []
      : invoices.data
        .map((invoice) => invoice.id)
        .filter((invoiceId) => !known.has(invoiceId)),
  );
  if (requiredInvoiceId) invoiceIds.add(requiredInvoiceId);

  const verified: VerifiedPaidMembershipInvoice[] = [];
  for (const invoiceId of invoiceIds) {
    const invoice = await verifiedPaidMembershipInvoice(
      stripe,
      config,
      invoiceId,
      expected,
    );
    if (invoice) verified.push(invoice);
  }

  return verified.sort((left, right) =>
    left.paidAt.localeCompare(right.paidAt) ||
    left.invoiceId.localeCompare(right.invoiceId)
  );
}

export async function verifiedPortalConfigurationId(
  stripe: Stripe,
  config: HldStripeConfig,
): Promise<string | undefined> {
  const configurationId = Deno.env.get("STRIPE_BILLING_PORTAL_CONFIGURATION_ID")
    ?.trim();
  if (!configurationId) {
    if (config.expectedLivemode) {
      throw new Error(
        "Live billing requires STRIPE_BILLING_PORTAL_CONFIGURATION_ID",
      );
    }
    return undefined;
  }
  if (!/^bpc_[A-Za-z0-9]+$/.test(configurationId)) {
    throw new Error("STRIPE_BILLING_PORTAL_CONFIGURATION_ID is not valid");
  }

  const configuration = await stripe.billingPortal.configurations.retrieve(
    configurationId,
  );
  if (
    !configuration.active || configuration.livemode !== config.expectedLivemode
  ) {
    throw new Error(
      "Stripe Customer Portal configuration is inactive or in the wrong mode",
    );
  }
  if (
    config.expectedLivemode &&
    (
      !configuration.features.payment_method_update.enabled ||
      !configuration.features.invoice_history.enabled ||
      !configuration.features.subscription_cancel.enabled ||
      configuration.features.subscription_cancel.mode !== "at_period_end" ||
      configuration.features.subscription_update.enabled
    )
  ) {
    throw new Error(
      "Production Customer Portal configuration does not match the approved membership controls",
    );
  }
  return configuration.id;
}

export function stripeObjectId(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (
    value && typeof value === "object" && "id" in value &&
    typeof value.id === "string"
  ) {
    return value.id;
  }
  return null;
}
