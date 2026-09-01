import { withSupabase } from "npm:@supabase/server@^1";
import Stripe from "npm:stripe@^22";
import {
  applyPendingMembershipCredit,
  MEMBERSHIP_FREE_MONTH_BENEFIT_CODE,
} from "../_shared/hld-membership-credit.ts";
import { supabaseServerOptions } from "../_shared/hld-supabase-admin.ts";
import { hldStripeConfig, requiredEnv } from "../_shared/hld-stripe.ts";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const sourceReferencePattern = /^[A-Za-z0-9][A-Za-z0-9:_-]{7,199}$/;
const allowedSources = new Set(["admin", "referral", "welcome_video"]);

function json(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function entitlementResponse(value: Record<string, unknown>) {
  return {
    id: value.id,
    instructorProfileId: value.instructor_profile_id,
    benefitCode: value.benefit_code,
    source: value.source,
    sourceReference: value.source_reference,
    status: value.status,
    adminNote: value.admin_note,
    awardedByAccountId: value.awarded_by_account_id,
    awardedAt: value.awarded_at,
    appliedAt: value.applied_at,
    consumedAt: value.consumed_at,
    voidedAt: value.voided_at,
    expiresAt: value.expires_at,
    deferredReason: value.last_deferred_reason,
  };
}

function applicationResponse(value: Record<string, unknown> | null) {
  if (!value) return null;
  return {
    id: value.id,
    status: value.status,
    deferredReason: value.deferred_reason,
  };
}

const stripe = new Stripe(requiredEnv("STRIPE_SECRET_KEY"));

export default {
  fetch: withSupabase<any>({
    auth: "user",
    supabaseOptions: supabaseServerOptions(),
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

    const accountId = ctx.userClaims?.id;
    if (!accountId) return json({ error: "Authentication required" }, 401);

    const { data: ownerAccess, error: ownerError } = await ctx.supabaseAdmin
      .from("marketplace_admins")
      .select("account_id")
      .eq("account_id", accountId)
      .eq("is_owner", true)
      .maybeSingle();
    if (ownerError) {
      console.error("Unable to verify marketplace owner", ownerError.code);
      return json({ error: "Unable to verify administrator access" }, 500);
    }
    if (!ownerAccess) {
      return json({ error: "Marketplace owner access required" }, 403);
    }

    const body = await req.json().catch(() => null) as {
      instructorProfileId?: unknown;
      source?: unknown;
      sourceReference?: unknown;
      idempotencyKey?: unknown;
      adminNote?: unknown;
    } | null;
    const instructorProfileId = typeof body?.instructorProfileId === "string"
      ? body.instructorProfileId.trim()
      : "";
    const source = typeof body?.source === "string"
      ? body.source.trim().toLowerCase()
      : "";
    const sourceReference = typeof body?.sourceReference === "string"
      ? body.sourceReference.trim()
      : "";
    const idempotencyKey = typeof body?.idempotencyKey === "string"
      ? body.idempotencyKey.trim()
      : "";
    const idempotencyHeader = req.headers.get("idempotency-key")?.trim() ?? "";
    const adminNote = body?.adminNote == null
      ? null
      : typeof body.adminNote === "string"
      ? body.adminNote.trim()
      : undefined;

    if (
      !uuidPattern.test(instructorProfileId) ||
      !allowedSources.has(source) ||
      !sourceReferencePattern.test(sourceReference) ||
      !uuidPattern.test(idempotencyKey) ||
      (idempotencyHeader !== "" &&
        (!uuidPattern.test(idempotencyHeader) ||
          idempotencyHeader !== idempotencyKey)) ||
      adminNote === undefined ||
      (adminNote != null && (adminNote.length < 1 || adminNote.length > 2000))
    ) {
      return json({ error: "Membership credit request is invalid" }, 400);
    }

    const { data: issueResult, error: issueError } = await ctx.supabaseAdmin
      .rpc(
        "issue_membership_credit_entitlement",
        {
          p_instructor_profile_id: instructorProfileId,
          p_source: source,
          p_source_reference: sourceReference,
          p_idempotency_key: idempotencyKey,
          p_awarded_by_account_id: accountId,
          p_admin_note: adminNote,
        },
      );
    if (issueError) {
      console.error(
        "Unable to issue membership credit",
        issueError.code,
        issueError.message,
      );
      if (issueError.message.includes("not found")) {
        return json({ error: "Instructor profile not found" }, 404);
      }
      if (
        issueError.message.includes("reused") ||
        issueError.message.includes("owner access")
      ) {
        return json({ error: "Membership credit request conflicts" }, 409);
      }
      return json({ error: "Unable to grant membership credit" }, 500);
    }

    const issued = issueResult?.entitlement as
      | Record<string, unknown>
      | undefined;
    const entitlementId = typeof issued?.id === "string" ? issued.id : "";
    if (
      !entitlementId ||
      issued?.benefit_code !== MEMBERSHIP_FREE_MONTH_BENEFIT_CODE
    ) {
      console.error("Membership credit issuance returned incomplete facts");
      return json({ error: "Unable to grant membership credit" }, 500);
    }

    let applyResult: Awaited<ReturnType<typeof applyPendingMembershipCredit>>;
    try {
      applyResult = await applyPendingMembershipCredit(
        stripe,
        ctx.supabaseAdmin,
        hldStripeConfig(),
        instructorProfileId,
        entitlementId,
      );
    } catch (error) {
      if (error instanceof Stripe.errors.StripeError) {
        console.error(
          "Stripe membership credit request failed",
          error.type,
          error.code ?? "no_code",
          error.requestId ?? "no_request_id",
        );
      } else {
        console.error(
          "Membership credit application failed",
          error instanceof Error ? error.message : "unknown_error",
        );
      }
      return json({ error: "Billing service is temporarily unavailable" }, 502);
    }

    const [{ data: currentEntitlement, error: entitlementError }, {
      data: latestApplication,
      error: applicationError,
    }] = await Promise.all([
      ctx.supabaseAdmin
        .from("membership_credit_entitlements")
        .select(
          "id,instructor_profile_id,benefit_code,source,source_reference,status,admin_note,awarded_by_account_id,awarded_at,applied_at,consumed_at,voided_at,expires_at,last_deferred_reason",
        )
        .eq("id", entitlementId)
        .single(),
      ctx.supabaseAdmin
        .from("membership_credit_applications")
        .select("id,status,deferred_reason")
        .eq("entitlement_id", entitlementId)
        .order("attempt_number", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);
    if (entitlementError || applicationError || !currentEntitlement) {
      console.error(
        "Unable to load granted membership credit",
        entitlementError?.code,
        applicationError?.code,
      );
      return json({ error: "Unable to confirm membership credit" }, 500);
    }

    return json({
      entitlement: entitlementResponse(currentEntitlement),
      application: applicationResponse(latestApplication),
      outcome: applyResult.outcome === "applied"
        ? "applied"
        : applyResult.outcome === "deferred"
        ? "deferred"
        : "existing",
    });
  }),
};
