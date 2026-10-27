import twilio from "npm:twilio@6.1.1";
import { Webhook } from "npm:standardwebhooks@1.1.1";
import { notificationAdmin } from "../_shared/hld-notification-services.ts";

export default { fetch: async (req: Request) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const url = new URL(req.url);
  const raw = await req.text();
  if (raw.length > 100000) return new Response("Payload too large", { status: 413 });
  try {
    if (url.searchParams.get("provider") === "twilio") {
      const token = Deno.env.get("TWILIO_AUTH_TOKEN");
      const base = Deno.env.get("SUPABASE_URL");
      if (!token || !base) return new Response("Not configured", { status: 503 });
      const values = Object.fromEntries(new URLSearchParams(raw));
      const externalUrl = `${base}/functions/v1/inquiry-notification-webhook${url.search}`;
      if (!twilio.validateRequest(token, req.headers.get("x-twilio-signature") || "", externalUrl, values) || values.AccountSid !== Deno.env.get("TWILIO_ACCOUNT_SID")) return new Response("Invalid signature", { status: 401 });
      const admin = notificationAdmin();
      if (values.OptOutType === "STOP") {
        const { error } = await admin.rpc("disable_instructor_sms", { p_phone: values.From });
        if (error) throw error;
      } else if (values.MessageStatus) {
        const status = values.MessageStatus === "delivered" ? "delivered" : ["failed", "undelivered"].includes(values.MessageStatus) ? "failed" : "sent";
        const job = Number(url.searchParams.get("job"));
        if (!Number.isSafeInteger(job) || job <= 0) return new Response("Invalid job", { status: 400 });
        const { error } = await admin.rpc("record_inquiry_notification_delivery", {
          p_provider: "twilio", p_provider_message_id: values.MessageSid, p_status: status,
          p_occurred_at: new Date().toISOString(), p_job_id: job, p_phone: values.To, p_error: values.ErrorCode || null
        });
        if (error) throw error;
      }
      // Twilio handles opt-out confirmations. Other SMS replies direct people to the inbox.
      const response = values.Body && !values.OptOutType
        ? "<Response><Message>Please read and reply to your inquiry on Hire Line Dancers: https://hirelinedancers.com/account/?tab=inquiries</Message></Response>"
        : "<Response/>";
      return new Response(response, { headers: { "Content-Type": "text/xml" } });
    }
    const secret = Deno.env.get("RESEND_WEBHOOK_SECRET");
    if (!secret) return new Response("Not configured", { status: 503 });
    let event: { type?: string; created_at?: string; data?: { email_id?: string } };
    try { event = new Webhook(secret).verify(raw, Object.fromEntries(req.headers)) as typeof event; }
    catch { return new Response("Invalid signature", { status: 401 }); }
    const status = ({ "email.delivered": "delivered", "email.bounced": "bounced", "email.complained": "complained", "email.failed": "failed" } as Record<string, string>)[event.type || ""];
    if (status && event.data?.email_id && event.created_at && Number.isFinite(Date.parse(event.created_at))) {
      const { error } = await notificationAdmin().rpc("record_inquiry_notification_delivery", {
        p_provider: "resend", p_provider_message_id: event.data.email_id, p_status: status, p_occurred_at: event.created_at
      });
      if (error) throw error;
    }
    return new Response("OK");
  } catch {
    return new Response("Unable to record notification event", { status: 500 });
  }
} };
