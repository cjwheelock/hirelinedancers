// Instructor sends a signed booking agreement (a quote) from a message thread.
//
// POST { threadId, quote: { ...QuoteInput } }
//
// The function validates the quote, computes the amounts from the commercial
// terms, renders the exact agreement text, fingerprints it, and records the
// instructor's typed signature. The database re-checks every amount.
import { withSupabase } from "npm:@supabase/server@^1";
import {
  BOOKING_AGREEMENT_VERSION,
  BookingInputError,
  bookingJson as json,
  friendlyDatabaseError,
  parseQuoteInput,
  quoteAmounts,
  renderAgreement,
  requestIp,
  requestUserAgent,
  sha256Hex,
  validUuid,
} from "../_shared/hld-booking.ts";
import { BOOKING_CORS } from "../_shared/hld-booking-stripe.ts";
import { supabaseServerOptions } from "../_shared/hld-supabase-admin.ts";

const LEGAL_NAME = "OMG Goals Inc.";

export default {
  fetch: withSupabase<any>({
    auth: "user",
    cors: BOOKING_CORS,
    supabaseOptions: supabaseServerOptions(),
  }, async (req, ctx) => {
    if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
    const accountId = ctx.userClaims?.id;
    if (!accountId) return json({ error: "Authentication required" }, 401);

    let threadId: string | null;
    let input: ReturnType<typeof parseQuoteInput>;
    try {
      const body = await req.json() as { threadId?: unknown; quote?: unknown };
      threadId = validUuid(body.threadId);
      if (!threadId) return json({ error: "A conversation is required" }, 400);
      input = parseQuoteInput(body.quote);
    } catch (error) {
      if (error instanceof BookingInputError) return json({ error: error.message }, 400);
      return json({ error: "A valid JSON request is required" }, 400);
    }

    let amounts: ReturnType<typeof quoteAmounts>;
    try {
      amounts = quoteAmounts(input);
    } catch (error) {
      if (error instanceof BookingInputError) return json({ error: error.message }, 400);
      throw error;
    }

    const { data: thread, error: threadError } = await ctx.supabaseAdmin
      .from("inquiry_threads")
      .select("id, inquiry_id, instructor_profile_id, instructor_account_id, status")
      .eq("id", threadId)
      .maybeSingle();
    if (threadError) {
      console.error("Unable to load thread for quote", threadError.code);
      return json({ error: "Unable to load this conversation" }, 500);
    }
    if (!thread || thread.instructor_account_id !== accountId) {
      return json({ error: "Only the instructor in this conversation can send a quote" }, 403);
    }

    const [profileResult, inquiryResult, accountResult] = await Promise.all([
      ctx.supabaseAdmin
        .from("instructor_profiles")
        .select("display_name, business_name, liability_insurance_status")
        .eq("id", thread.instructor_profile_id)
        .maybeSingle(),
      ctx.supabaseAdmin
        .from("inquiries")
        .select("contact_name, name, company_name")
        .eq("id", thread.inquiry_id)
        .maybeSingle(),
      ctx.supabaseAdmin.from("accounts").select("email, full_name").eq("id", accountId).maybeSingle(),
    ]);
    const loadError = profileResult.error ?? inquiryResult.error ?? accountResult.error;
    if (loadError || !profileResult.data || !inquiryResult.data || !accountResult.data?.email) {
      console.error("Unable to load quote parties", loadError?.code);
      return json({ error: "Unable to prepare the agreement" }, 500);
    }
    if (
      input.insuranceChoice === "coi_on_file" &&
      profileResult.data.liability_insurance_status === "not_provided"
    ) {
      return json({
        error: "Your profile says you do not carry liability insurance. Update your profile or choose that you will handle insurance outside this agreement.",
      }, 400);
    }

    const agreementText = renderAgreement(input, amounts, {
      instructorName: profileResult.data.display_name,
      instructorBusiness: profileResult.data.business_name,
      organizerName: inquiryResult.data.contact_name || inquiryResult.data.name || "Client",
      organizerCompany: inquiryResult.data.company_name,
      legalName: LEGAL_NAME,
    });
    const agreementSha256 = await sha256Hex(agreementText);

    const { data, error } = await ctx.supabaseAdmin.rpc("booking_create_quote", {
      p_quote: {
        thread_id: thread.id,
        instructor_account_id: accountId,
        event_date: input.eventDate,
        start_time: input.startTime,
        end_time: input.endTime,
        time_zone: input.timeZone,
        venue_name: input.venueName,
        venue_address: input.venueAddress,
        service_description: input.serviceDescription,
        pricing_mode: input.pricingMode,
        hourly_rate_cents: input.hourlyRateCents,
        hours: input.hours,
        flat_price_cents: input.flatPriceCents,
        travel_fee_cents: input.travelFeeCents,
        provides_speakers: input.providesSpeakers,
        provides_microphone: input.providesMicrophone,
        cancellation_policy: input.cancellationPolicy,
        cancellation_windows: input.cancellationWindows,
        insurance_choice: input.insuranceChoice,
        instructor_fee_bps: amounts.instructorFeeBps,
        client_fee_bps: amounts.clientFeeBps,
        price_cents: amounts.priceCents,
        client_fee_cents: amounts.clientFeeCents,
        total_cents: amounts.totalCents,
        platform_fee_cents: amounts.platformFeeCents,
        instructor_payout_cents: amounts.instructorPayoutCents,
        agreement_version: BOOKING_AGREEMENT_VERSION,
        agreement_text: agreementText,
        agreement_sha256: agreementSha256,
        signature_name: input.signatureName,
        signature_email: accountResult.data.email,
        signature_ip: requestIp(req),
        signature_user_agent: requestUserAgent(req),
      },
    });
    if (error) {
      console.error("Quote creation failed", error.code, error.message);
      return json({ error: friendlyDatabaseError(error.message, "Unable to send the quote") }, 409);
    }
    return json({ ...(data as Record<string, unknown>), agreementSha256 });
  }),
};
