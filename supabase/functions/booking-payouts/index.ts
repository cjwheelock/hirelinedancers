// Instructor payout setup through Stripe Connect Express.
//
// POST { action: "status" }     Refreshes and returns payout readiness.
// POST { action: "onboard" }    Creates the Express account if needed and
//                               returns a Stripe-hosted onboarding link.
// POST { action: "dashboard" }  Returns a login link to the Express dashboard.
import { withSupabase } from "npm:@supabase/server@^1";
import type Stripe from "npm:stripe@^22";
import { bookingJson as json } from "../_shared/hld-booking.ts";
import {
  BOOKING_CORS,
  BOOKING_PRODUCT_LINE,
  bookingStripe,
  bookingStripeConfig,
  payoutsUrl,
  stripeErrorMessage,
  syncPayoutAccount,
} from "../_shared/hld-booking-stripe.ts";
import { supabaseServerOptions } from "../_shared/hld-supabase-admin.ts";

type Action = "status" | "onboard" | "dashboard";

export default {
  fetch: withSupabase<any>({
    auth: "user",
    cors: BOOKING_CORS,
    supabaseOptions: supabaseServerOptions(),
  }, async (req, ctx) => {
    if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
    const accountId = ctx.userClaims?.id;
    if (!accountId) return json({ error: "Authentication required" }, 401);

    let action: Action;
    try {
      const body = await req.json() as { action?: unknown };
      if (body.action !== "status" && body.action !== "onboard" && body.action !== "dashboard") {
        return json({ error: "Unsupported payout action" }, 400);
      }
      action = body.action;
    } catch {
      return json({ error: "A valid JSON request is required" }, 400);
    }

    let config: ReturnType<typeof bookingStripeConfig>;
    try {
      config = bookingStripeConfig();
    } catch (error) {
      console.error("Payout configuration is invalid", error instanceof Error ? error.message : error);
      return json({ error: "Payouts are not configured yet" }, 503);
    }
    const stripe = bookingStripe();

    const [profileResult, accountResult] = await Promise.all([
      ctx.supabaseAdmin
        .from("instructor_profiles")
        .select("id, display_name, business_name, slug, status")
        .eq("account_id", accountId)
        .maybeSingle(),
      ctx.supabaseAdmin.from("accounts").select("email").eq("id", accountId).maybeSingle(),
    ]);
    if (profileResult.error || accountResult.error) {
      console.error("Unable to load instructor for payouts", profileResult.error?.code ?? accountResult.error?.code);
      return json({ error: "Unable to load your instructor profile" }, 500);
    }
    const profile = profileResult.data as {
      id: string;
      display_name: string;
      business_name: string | null;
      slug: string | null;
      status: string;
    } | null;
    if (!profile) return json({ error: "An instructor profile is required", code: "profile_required" }, 403);

    const { data: existing, error: existingError } = await ctx.supabaseAdmin
      .from("instructor_payout_accounts")
      .select("stripe_account_id, livemode")
      .eq("instructor_profile_id", profile.id)
      .maybeSingle();
    if (existingError) {
      console.error("Unable to read payout account", existingError.code);
      return json({ error: "Unable to load payout setup" }, 500);
    }
    if (existing && existing.livemode !== config.expectedLivemode) {
      console.error("Payout account mode does not match the configured Stripe mode", profile.id);
      return json({ error: "Payout setup needs attention from support" }, 409);
    }

    try {
      let account: Stripe.Account | null = existing
        ? await stripe.accounts.retrieve(existing.stripe_account_id)
        : null;

      if (!account && action !== "onboard") {
        return json({
          payoutsReady: false,
          detailsSubmitted: false,
          hasAccount: false,
          requirementsCurrentlyDue: [],
        });
      }

      if (!account) {
        const profileUrl = profile.slug
          ? new URL(`/profile/?instructor=${encodeURIComponent(profile.slug)}`, config.appUrl).toString()
          : config.appUrl.toString();
        account = await stripe.accounts.create({
          type: "express",
          country: "US",
          email: accountResult.data?.email ?? undefined,
          business_type: "individual",
          capabilities: { transfers: { requested: true } },
          business_profile: {
            mcc: "7911",
            name: profile.business_name || profile.display_name,
            product_description: "Line dance instruction for events booked through Hire Line Dancers.",
            url: profileUrl,
          },
          settings: {
            payouts: { schedule: { interval: "daily" } },
          },
          metadata: {
            product_line: BOOKING_PRODUCT_LINE,
            instructor_profile_id: profile.id,
            account_id: accountId,
          },
        }, { idempotencyKey: `hld-payout-account-${profile.id}` });
      }

      const status = await syncPayoutAccount(
        ctx.supabaseAdmin,
        profile.id,
        account,
        config.expectedLivemode,
      );

      if (action === "onboard") {
        const link = await stripe.accountLinks.create({
          account: account.id,
          type: "account_onboarding",
          refresh_url: payoutsUrl(config, "refresh"),
          return_url: payoutsUrl(config, "returned"),
        });
        return json({ ...status, hasAccount: true, url: link.url });
      }

      if (action === "dashboard") {
        if (!status.detailsSubmitted) {
          return json({ error: "Finish payout setup before opening the payout dashboard" }, 409);
        }
        const login = await stripe.accounts.createLoginLink(account.id);
        return json({ ...status, hasAccount: true, url: login.url });
      }

      return json({ ...status, hasAccount: true });
    } catch (error) {
      console.error("Payout setup failed", stripeErrorMessage(error));
      return json({ error: "Stripe could not open payout setup. Try again in a minute." }, 502);
    }
  }),
};
