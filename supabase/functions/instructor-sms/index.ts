import { notificationAdmin, smsReady, twilioVerification } from "../_shared/hld-notification-services.ts";

export default { fetch: async (req: Request) => {
  const allowedOrigin = Deno.env.get("APP_URL")?.replace(/\/$/, "");
  const headers = { "Access-Control-Allow-Origin": allowedOrigin || "https://hirelinedancers.com", "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info", "Access-Control-Allow-Methods": "POST, OPTIONS", "Cache-Control": "no-store", Vary: "Origin" };
  const json = (body: unknown, status = 200) => Response.json(body, { status, headers });
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    const admin = notificationAdmin();
    const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
    if (!token) return json({ error: "Sign in to manage text alerts" }, 401);
    const { data: { user }, error } = await admin.auth.getUser(token);
    if (error || !user) return json({ error: "Sign in to manage text alerts" }, 401);
    const { data: profile } = await admin.from("instructor_profiles").select("id").eq("account_id", user.id).maybeSingle();
    if (!profile) return json({ error: "Instructor account required" }, 403);
    const body = await req.json().catch(() => ({})) as { action?: string; phone?: string; consent?: boolean; code?: string; verificationId?: string };
    if (body.action === "status") {
      const { data, error: loadError } = await admin.from("instructor_sms_preferences").select("phone_e164,enabled").eq("account_id", user.id).maybeSingle();
      if (loadError) return json({ error: "Text alerts are currently unavailable" }, 503);
      return json({ available: smsReady(), enabled: data?.enabled ?? false, phone: data?.phone_e164 ?? "" });
    }
    if (body.action === "disable") {
      const { error: disabled } = await admin.rpc("disable_instructor_sms", { p_account_id: user.id });
      if (disabled) throw new Error("Unable to turn off text alerts");
      return json({ enabled: false });
    }
    if (!smsReady()) return json({ error: "Text alerts are currently unavailable" }, 503);
    if (body.action === "start") {
      const phone = typeof body.phone === "string" ? body.phone.trim() : "";
      if (body.consent !== true || !/^\+[1-9][0-9]{7,14}$/.test(phone)) return json({ error: "Enter your phone number with country code and agree to text alerts" }, 400);
      const { data: id, error: reserveError } = await admin.rpc("reserve_instructor_sms_verification", { p_account_id: user.id, p_phone: phone });
      if (reserveError) return json({ error: reserveError.message }, 429);
      await twilioVerification("Verifications", phone);
      return json({ verificationId: id });
    }
    if (body.action === "confirm") {
      if (body.consent !== true || typeof body.code !== "string" || !/^\d{4,10}$/.test(body.code) || typeof body.verificationId !== "string") return json({ error: "Enter the verification code" }, 400);
      const { data: phone, error: checkError } = await admin.rpc("check_instructor_sms_verification", { p_account_id: user.id, p_verification_id: body.verificationId });
      if (checkError || !phone) return json({ error: "Request a new verification code" }, 400);
      const verification = await twilioVerification("VerificationCheck", phone, body.code);
      if (verification.status !== "approved" || verification.to !== phone) return json({ error: "The verification code was not accepted" }, 400);
      const { error: saveError } = await admin.rpc("enable_verified_instructor_sms", { p_account_id: user.id, p_verification_id: body.verificationId, p_phone: phone });
      if (saveError) return json({ error: "Verification expired. Request a new code." }, 400);
      return json({ enabled: true, phone });
    }
    return json({ error: "Invalid action" }, 400);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Unable to update text alerts" }, 503);
  }
} };
