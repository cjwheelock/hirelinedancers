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
