import handler from "./index.ts";
import twilio from "npm:twilio@6.1.1";
import { Webhook } from "npm:standardwebhooks@1.1.1";
function assert(value: boolean, message: string) { if (!value) throw new Error(message); }
Deno.test("unsigned callbacks cannot change delivery or consent", async () => {
  Deno.env.set("TWILIO_AUTH_TOKEN", "test-token");
  Deno.env.set("SUPABASE_URL", "https://project.example.test");
  Deno.env.set("TWILIO_ACCOUNT_SID", "ACtest");
  const response = await handler.fetch(new Request("https://local/functions/v1/inquiry-notification-webhook?provider=twilio", {
    method: "POST", body: "AccountSid=ACtest&OptOutType=STOP&From=%2B15555550100"
  }));
  assert(response.status === 401, "unsigned Twilio callback rejected");
});
Deno.test("signed opt-out disables the authenticated sender's phone only", async () => {
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "test-service-key");
  const actualFetch = globalThis.fetch;
  const calls: { path: string; body: Record<string, unknown> }[] = [];
  globalThis.fetch = async (input, init) => {
    const req = new Request(input, init);
    calls.push({ path: new URL(req.url).pathname, body: await req.json() });
    return Response.json(null);
  };
  try {
    const values = { AccountSid: "ACtest", OptOutType: "STOP", From: "+15555550100", Body: "STOP" };
    const external = "https://project.example.test/functions/v1/inquiry-notification-webhook?provider=twilio";
    const response = await handler.fetch(new Request(external, { method: "POST", body: new URLSearchParams(values),
      headers: { "x-twilio-signature": twilio.getExpectedTwilioSignature("test-token", external, values) } }));
    assert(response.status === 200, "signed opt-out accepted");
    assert(calls.length === 1 && calls[0].path.endsWith("/disable_instructor_sms") && calls[0].body.p_phone === values.From, "correct phone disabled");
    assert(await response.text() === "<Response/>", "no duplicate opt-out reply");
  } finally { globalThis.fetch = actualFetch; }
});
Deno.test("Resend signatures bind callback body and reject altered content", async () => {
  const secret = "whsec_" + btoa("notification-webhook-secret-32-bytes");
  Deno.env.set("RESEND_WEBHOOK_SECRET", secret);
  const body = JSON.stringify({ type: "email.delivered", created_at: new Date().toISOString(), data: { email_id: "email-id" } });
  const stamp = new Date();
  const id = "event-test";
  const signature = new Webhook(secret).sign(id, stamp, body);
  const response = await handler.fetch(new Request("https://project.example.test/functions/v1/inquiry-notification-webhook", { method: "POST", body: body.replace("email-id", "another-id"),
    headers: { "webhook-id": id, "webhook-timestamp": String(Math.floor(stamp.getTime() / 1000)), "webhook-signature": signature } }));
  assert(response.status === 401, "altered callback rejected");
});
