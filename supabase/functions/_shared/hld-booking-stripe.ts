import Stripe from "npm:stripe@^22";

const PRODUCTION_HOSTS = new Set([
  "hirelinedancers.com",
  "www.hirelinedancers.com",
]);

export const BOOKING_PRODUCT_LINE = "hire_line_dancers_booking";

export const BOOKING_CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, idempotency-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export type BookingStripeConfig = {
  appUrl: URL;
  expectedLivemode: boolean;
};

export function bookingRequiredEnv(name: string): string {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`Missing required secret: ${name}`);
  return value;
}

// Booking payments need only the app URL and the Stripe mode. Membership
// Product and Price secrets are not required.
export function bookingStripeConfig(): BookingStripeConfig {
  const appUrl = new URL(bookingRequiredEnv("APP_URL"));
  const isLocal = appUrl.hostname === "localhost" || appUrl.hostname === "127.0.0.1";
  if (appUrl.protocol !== "https:" && !isLocal) {
    throw new Error("APP_URL must use HTTPS outside local development");
  }
  const expectedMode = bookingRequiredEnv("STRIPE_EXPECTED_MODE").toLowerCase();
  if (expectedMode !== "live" && expectedMode !== "test") {
    throw new Error("STRIPE_EXPECTED_MODE must be either live or test");
  }
  const expectedLivemode = expectedMode === "live";
  if (PRODUCTION_HOSTS.has(appUrl.hostname.toLowerCase()) && !expectedLivemode) {
    throw new Error("Production APP_URL requires STRIPE_EXPECTED_MODE=live");
  }
  return { appUrl, expectedLivemode };
}

export function bookingStripe(): Stripe {
  return new Stripe(bookingRequiredEnv("STRIPE_SECRET_KEY"));
}

export function stripeId(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "id" in value && typeof value.id === "string") {
    return value.id;
  }
  return null;
}

export function threadUrl(config: BookingStripeConfig, threadId: string, extra: Record<string, string> = {}): string {
  const url = new URL("/account/", config.appUrl);
  url.searchParams.set("tab", "inquiries");
  url.searchParams.set("thread", threadId);
  for (const [key, value] of Object.entries(extra)) url.searchParams.set(key, value);
  return url.toString();
}

export function payoutsUrl(config: BookingStripeConfig, state: string): string {
  const url = new URL("/account/", config.appUrl);
  url.searchParams.set("tab", "payouts");
  url.searchParams.set("payouts", state);
  return url.toString();
}

export type PayoutAccountSnapshot = {
  stripeAccountId: string;
  detailsSubmitted: boolean;
  payoutsEnabled: boolean;
  transfersCapability: string;
  requirementsCurrentlyDue: string[];
  disabledReason: string | null;
};

export function payoutAccountSnapshot(account: Stripe.Account): PayoutAccountSnapshot {
  const capability = account.capabilities?.transfers;
  return {
    stripeAccountId: account.id,
    detailsSubmitted: Boolean(account.details_submitted),
    payoutsEnabled: Boolean(account.payouts_enabled),
    transfersCapability: typeof capability === "string" ? capability : "unrequested",
    requirementsCurrentlyDue: account.requirements?.currently_due ?? [],
    disabledReason: account.requirements?.disabled_reason ?? null,
  };
}

// Stripe Account objects do not carry livemode, so the caller passes the
// configured mode of the secret key that created the account.
// deno-lint-ignore no-explicit-any
export async function syncPayoutAccount(admin: any, instructorProfileId: string, account: Stripe.Account, livemode: boolean) {
  const snapshot = payoutAccountSnapshot(account);
  const { data, error } = await admin.rpc("booking_sync_payout_account", {
    p_instructor_profile_id: instructorProfileId,
    p_stripe_account_id: snapshot.stripeAccountId,
    p_livemode: livemode,
    p_details_submitted: snapshot.detailsSubmitted,
    p_payouts_enabled: snapshot.payoutsEnabled,
    p_transfers_capability: snapshot.transfersCapability,
    p_requirements_currently_due: snapshot.requirementsCurrentlyDue,
    p_disabled_reason: snapshot.disabledReason,
  });
  if (error) throw new Error(`Unable to save payout account: ${error.message}`);
  return data as {
    stripeAccountId: string;
    payoutsReady: boolean;
    detailsSubmitted: boolean;
    requirementsCurrentlyDue: string[];
  };
}

export function stripeErrorMessage(error: unknown): string {
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string") {
    return error.message;
  }
  return "Unknown Stripe error";
}

export type WebhookKind = "platform" | "connect";

export const WEBHOOK_EVENTS: Record<WebhookKind, Stripe.WebhookEndpointCreateParams.EnabledEvent[]> = {
  platform: [
    "checkout.session.completed",
    "checkout.session.async_payment_succeeded",
    "checkout.session.async_payment_failed",
    "charge.dispute.created",
    "refund.updated",
  ],
  connect: ["account.updated"],
};

type WebhookConfig = Partial<Record<WebhookKind, { endpointId: string; url: string; livemode: boolean; secret: string | null }>>;

// deno-lint-ignore no-explicit-any
export async function loadWebhookConfig(admin: any): Promise<WebhookConfig> {
  const { data, error } = await admin.rpc("booking_webhook_config");
  if (error) throw new Error(`Unable to load webhook configuration: ${error.message}`);
  return (data ?? {}) as WebhookConfig;
}

export function bookingWebhookUrl(): string {
  const base = bookingRequiredEnv("SUPABASE_URL").replace(/\/$/, "");
  return `${base}/functions/v1/booking-stripe-webhook`;
}

// Creates the booking webhook endpoints in Stripe the first time the worker
// runs with a working secret key, and stores their signing secrets in the
// database. Endpoints are recognized by metadata, so other endpoints on the
// Stripe account are never touched.
export async function ensureBookingWebhooks(
  stripe: Stripe,
  // deno-lint-ignore no-explicit-any
  admin: any,
  livemode: boolean,
): Promise<Record<WebhookKind, string>> {
  const url = bookingWebhookUrl();
  const config = await loadWebhookConfig(admin);
  const result = { platform: "ready", connect: "ready" } as Record<WebhookKind, string>;
  let existing: Stripe.WebhookEndpoint[] | null = null;

  for (const kind of ["platform", "connect"] as WebhookKind[]) {
    const saved = config[kind];
    if (saved?.secret && saved.url === url && saved.livemode === livemode) continue;
    try {
      existing ??= (await stripe.webhookEndpoints.list({ limit: 100 })).data;
      for (const endpoint of existing.filter((item) =>
        item.metadata?.hld_booking_webhook === kind && item.url === url
      )) {
        // Stripe shows a signing secret only at creation, so an endpoint we
        // no longer have the secret for is replaced.
        await stripe.webhookEndpoints.del(endpoint.id);
      }
      const created = await stripe.webhookEndpoints.create({
        url,
        enabled_events: WEBHOOK_EVENTS[kind],
        connect: kind === "connect",
        description: `Hire Line Dancers bookings (${kind === "connect" ? "connected accounts" : "payments"})`,
        metadata: { hld_booking_webhook: kind, product_line: BOOKING_PRODUCT_LINE },
      });
      if (!created.secret) throw new Error("Stripe did not return a signing secret");
      const { error } = await admin.rpc("booking_save_webhook_endpoint", {
        p_kind: kind,
        p_endpoint_id: created.id,
        p_url: url,
        p_livemode: created.livemode,
        p_signing_secret: created.secret,
      });
      if (error) throw new Error(`Unable to save webhook endpoint: ${error.message}`);
      result[kind] = "created";
    } catch (error) {
      result[kind] = `failed: ${stripeErrorMessage(error)}`;
      console.error("Unable to provision booking webhook", kind, stripeErrorMessage(error));
    }
  }
  return result;
}
