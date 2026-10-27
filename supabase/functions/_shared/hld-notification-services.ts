import { createClient } from "npm:@supabase/supabase-js@2.108.2";
import { supabaseServerOptions } from "./hld-supabase-admin.ts";

export function notificationAdmin() {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("Notification service is not configured");
  return createClient(url, key, { ...supabaseServerOptions(), auth: { persistSession: false, autoRefreshToken: false } });
}

export function smsReady(): boolean {
  return Deno.env.get("HLD_SMS_ENABLED") === "true" &&
    ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_MESSAGING_SERVICE_SID", "TWILIO_VERIFY_SERVICE_SID"]
      .every((name) => Boolean(Deno.env.get(name)?.trim()));
}

export async function twilioVerification(path: "Verifications" | "VerificationCheck", phone: string, code?: string) {
  const account = Deno.env.get("TWILIO_ACCOUNT_SID")!;
  const token = Deno.env.get("TWILIO_AUTH_TOKEN")!;
  const service = Deno.env.get("TWILIO_VERIFY_SERVICE_SID")!;
  const body = new URLSearchParams({ To: phone, ...(code ? { Code: code } : { Channel: "sms" }) });
  const response = await fetch(`https://verify.twilio.com/v2/Services/${encodeURIComponent(service)}/${path}`, {
    method: "POST", signal: AbortSignal.timeout(15000),
    headers: { Authorization: `Basic ${btoa(`${account}:${token}`)}`, "Content-Type": "application/x-www-form-urlencoded" }, body
  });
  const data = await response.json().catch(() => ({})) as { status?: string; to?: string };
  if (!response.ok) throw new Error("Unable to verify this phone number. Please try again later.");
  return data;
}
