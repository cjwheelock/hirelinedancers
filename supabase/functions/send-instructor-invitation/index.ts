import { withSupabase } from "npm:@supabase/server@^1";

type InvitationRequest = {
  email?: unknown;
  grantsLifetimeAccess?: unknown;
  requestKey?: unknown;
  invitationToken?: unknown;
};

function requiredEnv(name: string): string {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`Missing required secret: ${name}`);
  return value;
}

function appUrl(): URL {
  const url = new URL(requiredEnv("APP_URL"));
  if (url.protocol !== "https:" && url.hostname !== "localhost" && url.hostname !== "127.0.0.1") {
    throw new Error("APP_URL must use HTTPS outside local development");
  }
  return url;
}

function json(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function normalizeEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  if (
    !email
    || email.length > 320
    || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  ) return null;
  return email;
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function providerError(body: unknown, status: number): string {
  if (body && typeof body === "object" && "message" in body && typeof body.message === "string") {
    return body.message.slice(0, 1000);
  }
  return `Invitation email provider returned HTTP ${status}`;
}

export default {
  fetch: withSupabase({
    auth: "user",
    cors: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, idempotency-key",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
    },
  }, async (req, ctx) => {
    if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

    const accountId = ctx.userClaims?.id;
    if (!accountId) return json({ error: "Authentication required" }, 401);

    const [accountResult, adminResult] = await Promise.all([
      ctx.supabaseAdmin
        .from("accounts")
        .select("role")
        .eq("id", accountId)
        .maybeSingle(),
      ctx.supabaseAdmin
        .from("marketplace_admins")
        .select("account_id")
        .eq("account_id", accountId)
        .maybeSingle(),
    ]);

    if (accountResult.error || adminResult.error) {
      console.error("Unable to verify invitation sender", accountResult.error?.code, adminResult.error?.code);
      return json({ error: "Unable to verify administrator access" }, 500);
    }
    if (accountResult.data?.role !== "admin" && !adminResult.data) {
      return json({ error: "Administrator access required" }, 403);
    }

    let body: InvitationRequest;
    try {
      body = await req.json() as InvitationRequest;
    } catch {
      return json({ error: "A valid JSON request is required" }, 400);
    }

    const email = normalizeEmail(body.email);
    if (!email) return json({ error: "Enter a valid instructor email address" }, 400);
    if (typeof body.grantsLifetimeAccess !== "boolean") {
      return json({ error: "Lifetime access selection is required" }, 400);
    }
    const requestKey = typeof body.requestKey === "string" && /^[A-Za-z0-9_-]{8,64}$/.test(body.requestKey)
      ? body.requestKey
      : null;
    const token = typeof body.invitationToken === "string" && /^[a-f0-9]{64}$/.test(body.invitationToken)
      ? body.invitationToken
      : null;
    if (!requestKey || !token) return json({ error: "A valid invitation request key is required" }, 400);
    const headerKey = req.headers.get("Idempotency-Key")?.trim();
    if (headerKey && headerKey !== requestKey) return json({ error: "Invitation request keys do not match" }, 400);
    const tokenHash = await sha256(token);

    let baseUrl: URL;
    let resendApiKey: string;
    let from: string;
    try {
      baseUrl = appUrl();
      resendApiKey = requiredEnv("RESEND_API_KEY");
      from = Deno.env.get("RESEND_INVITATION_FROM_EMAIL")?.trim()
        || requiredEnv("RESEND_FROM_EMAIL");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Invitation delivery is not configured";
      console.error("Instructor invitation configuration error", message);
      return json({ error: "Instructor invitation delivery is not configured" }, 500);
    }

    const { data: existingAccount, error: existingAccountError } = await ctx.supabaseAdmin
      .from("accounts")
      .select("id,role")
      .eq("email", email)
      .limit(1)
      .maybeSingle();

    if (existingAccountError) {
      console.error("Unable to check invited account", existingAccountError.code);
      return json({ error: "Unable to prepare the invitation" }, 500);
    }
    if (existingAccount?.role && existingAccount.role !== "instructor") {
      return json({
        error: "That email already belongs to a non-instructor account. Contact support before changing its account type",
      }, 409);
    }

    if (existingAccount?.id && body.grantsLifetimeAccess) {
      const { data: existingProfile, error: existingProfileError } = await ctx.supabaseAdmin
        .from("instructor_profiles")
        .select("id")
        .eq("account_id", existingAccount.id)
        .maybeSingle();

      if (existingProfileError) {
        console.error("Unable to check the invited instructor", existingProfileError.code);
        return json({ error: "Unable to prepare the invitation" }, 500);
      }

      if (existingProfile?.id) {
        const [accessResult, membershipResult, settingsResult, checkoutResult] = await Promise.all([
          ctx.supabaseAdmin
            .from("instructor_lifetime_access")
            .select("instructor_profile_id")
            .eq("instructor_profile_id", existingProfile.id)
            .maybeSingle(),
          ctx.supabaseAdmin
            .from("instructor_memberships")
            .select("status")
            .eq("instructor_profile_id", existingProfile.id)
            .maybeSingle(),
          ctx.supabaseAdmin
            .from("instructor_private_settings")
            .select("subscription_status")
            .eq("instructor_profile_id", existingProfile.id)
            .maybeSingle(),
          ctx.supabaseAdmin
            .from("stripe_checkout_attempts")
            .select("id")
            .eq("instructor_profile_id", existingProfile.id)
            .eq("status", "open")
            .gt("expires_at", new Date().toISOString())
            .limit(1)
            .maybeSingle(),
        ]);

        const lookupError = accessResult.error ?? membershipResult.error ?? settingsResult.error ?? checkoutResult.error;
        if (lookupError) {
          console.error("Unable to check existing instructor access", lookupError.code);
          return json({ error: "Unable to prepare the invitation" }, 500);
        }

        const billingStatus = membershipResult.data?.status
          ?? settingsResult.data?.subscription_status
          ?? "inactive";
        if (
          !accessResult.data
          && ["trialing", "active", "past_due", "unpaid", "paused"].includes(billingStatus)
        ) {
          return json({
            error: "Cancel the existing Stripe membership before inviting this instructor with lifetime access",
          }, 409);
        }
        if (!accessResult.data && checkoutResult.data) {
          return json({
            error: "Wait for the instructor's open Stripe checkout to expire before sending lifetime access",
          }, 409);
        }
      }
    }

    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    let { data: invitation, error: invitationLookupError } = await ctx.supabaseAdmin
      .from("instructor_invitations")
      .select("id,email,token_hash,grants_lifetime_access,status,expires_at")
      .eq("request_key", requestKey)
      .maybeSingle();

    if (invitationLookupError) {
      console.error("Unable to look up instructor invitation", invitationLookupError.code);
      return json({ error: "Unable to create the invitation" }, 500);
    }

    if (!invitation) {
      const insertResult = await ctx.supabaseAdmin
        .rpc("create_instructor_invitation", {
          p_email: email,
          p_token_hash: tokenHash,
          p_request_key: requestKey,
          p_grants_lifetime_access: body.grantsLifetimeAccess,
          p_invited_by: accountId,
          p_expires_at: expiresAt,
        })
        .single();
      invitation = insertResult.data;
      invitationLookupError = insertResult.error;
    }

    if (invitationLookupError || !invitation) {
      console.error("Unable to create instructor invitation", invitationLookupError?.code);
      return json({ error: "Unable to create the invitation" }, 500);
    }
    if (
      invitation.email !== email
      || invitation.token_hash !== tokenHash
      || invitation.grants_lifetime_access !== body.grantsLifetimeAccess
    ) {
      return json({ error: "That invitation request key was already used for different details" }, 409);
    }
    if (["sent", "accepted"].includes(invitation.status)) {
      return json({
        invitationId: invitation.id,
        email,
        grantsLifetimeAccess: body.grantsLifetimeAccess,
        expiresAt: invitation.expires_at,
        reused: true,
      });
    }
    if (invitation.status === "revoked") {
      return json({ error: "This invitation was replaced by a newer invitation" }, 409);
    }
    if (new Date(invitation.expires_at).getTime() <= Date.now()) {
      return json({ error: "That invitation request has expired. Start a new invitation" }, 409);
    }

    let { data: deliveryClaim, error: deliveryClaimError } = await ctx.supabaseAdmin
      .from("instructor_invitations")
      .update({ status: "sending", delivery_error: null })
      .eq("id", invitation.id)
      .in("status", ["pending", "delivery_failed"])
      .select("id")
      .maybeSingle();

    if (!deliveryClaim && !deliveryClaimError && invitation.status === "sending") {
      const staleClaim = await ctx.supabaseAdmin
        .from("instructor_invitations")
        .update({ status: "sending", delivery_error: null })
        .eq("id", invitation.id)
        .eq("status", "sending")
        .lt("updated_at", new Date(Date.now() - 2 * 60 * 1000).toISOString())
        .select("id")
        .maybeSingle();
      deliveryClaim = staleClaim.data;
      deliveryClaimError = staleClaim.error;
    }

    if (deliveryClaimError) {
      console.error("Unable to claim instructor invitation delivery", deliveryClaimError.code);
      return json({ error: "Unable to send the invitation" }, 500);
    }
    if (!deliveryClaim) {
      return json({
        invitationId: invitation.id,
        email,
        grantsLifetimeAccess: body.grantsLifetimeAccess,
        expiresAt: invitation.expires_at,
        deliveryPending: true,
      }, 202);
    }

    const invitationUrl = new URL("/login/", baseUrl);
    invitationUrl.searchParams.set("role", "instructor");
    invitationUrl.searchParams.set("invite", token);

    const lifetimeText = body.grantsLifetimeAccess
      ? " This invitation includes complimentary lifetime access, so you will not be asked for payment details to create or activate your profile."
      : " After your profile is approved, your account will show the available membership activation options.";
    const textBody = [
      "You are invited to join Hire Line Dancers as an instructor.",
      lifetimeText.trim(),
      "",
      `Accept your invitation: ${invitationUrl.toString()}`,
      "",
      "This private invitation expires in 30 days. Sign in with the email address that received it.",
    ].join("\n");
    const safeUrl = escapeHtml(invitationUrl.toString());
    const htmlBody = `
      <div style="font-family:Arial,sans-serif;line-height:1.6;color:#1c2a44;max-width:620px;margin:0 auto;padding:24px">
        <p style="font-size:13px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#b5472b">Hire Line Dancers</p>
        <h1 style="font-size:30px;line-height:1.15">You are invited to join as an instructor</h1>
        <p>Build your instructor profile, share your services, and connect with people planning events in your area.</p>
        <p>${escapeHtml(lifetimeText.trim())}</p>
        <p style="margin:28px 0"><a href="${safeUrl}" style="display:inline-block;background:#e7a33c;color:#1c2a44;border:2px solid #1c2a44;padding:12px 18px;font-weight:700;text-decoration:none">Accept instructor invitation</a></p>
        <p style="font-size:14px;color:#57607a">This private invitation expires in 30 days. Sign in with the email address that received it.</p>
      </div>
    `;

    const replyTo = Deno.env.get("SUPPORT_EMAIL")?.trim() || "hello@hirelinedancers.com";

    let response: Response;
    try {
      response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${resendApiKey}`,
          "Content-Type": "application/json",
          "Idempotency-Key": requestKey,
        },
        body: JSON.stringify({
          from,
          to: [email],
          reply_to: replyTo,
          subject: "You are invited to join Hire Line Dancers",
          text: textBody,
          html: htmlBody,
        }),
        signal: AbortSignal.timeout(15_000),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message.slice(0, 1000) : "Invitation email request failed";
      console.error("Instructor invitation email failed", message);
      const failedUpdate = await ctx.supabaseAdmin
        .from("instructor_invitations")
        .update({ status: "delivery_failed", delivery_error: message })
        .eq("id", invitation.id)
        .eq("status", "sending")
        .select("id")
        .maybeSingle();
      if (!failedUpdate.data && !failedUpdate.error) {
        return json({ error: "This invitation was replaced before delivery completed" }, 409);
      }
      return json({ error: "The invitation was not sent. Please try again" }, 502);
    }

    const responseBody = await response.json().catch(() => null) as { id?: unknown; message?: unknown } | null;
    if (!response.ok || typeof responseBody?.id !== "string") {
      const message = providerError(responseBody, response.status);
      console.error("Instructor invitation provider rejected email", response.status, message);
      const failedUpdate = await ctx.supabaseAdmin
        .from("instructor_invitations")
        .update({ status: "delivery_failed", delivery_error: message })
        .eq("id", invitation.id)
        .eq("status", "sending")
        .select("id")
        .maybeSingle();
      if (!failedUpdate.data && !failedUpdate.error) {
        return json({ error: "This invitation was replaced before delivery completed" }, 409);
      }
      return json({ error: "The invitation was not sent. Please verify the email and try again" }, 502);
    }

    const { data: sentUpdate, error: sentError } = await ctx.supabaseAdmin
      .from("instructor_invitations")
      .update({
        status: "sent",
        sent_at: new Date().toISOString(),
        email_provider_message_id: responseBody.id,
        delivery_error: null,
      })
      .eq("id", invitation.id)
      .eq("status", "sending")
      .select("id")
      .maybeSingle();

    if (sentError) {
      console.error("Invitation email sent but status update failed", sentError.code, invitation.id);
    }
    if (!sentError && !sentUpdate) {
      return json({ error: "This invitation was replaced before delivery completed" }, 409);
    }

    return json({
      invitationId: invitation.id,
      email,
      grantsLifetimeAccess: body.grantsLifetimeAccess,
      expiresAt: invitation.expires_at,
    });
  }),
};
