import Stripe from "npm:stripe@^22";

const MONTHLY_PRICE_CENTS = 1499;
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
