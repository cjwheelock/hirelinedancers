import { withSupabase } from "npm:@supabase/server@^1";
import type { SupabaseClient } from "npm:@supabase/supabase-js@^2";

type AdminClient = SupabaseClient;

type NotificationJob = {
  job_id: number;
  channel: "email" | "sms";
  attempt_number: number;
  inquiry_recipient_id: string;
  delivered_to_email: string;
  delivered_to_phone_e164: string | null;
  inquiry_id: string;
  instructor_name: string;
  organizer_name: string;
  organizer_email: string;
  company_name: string | null;
  event_type: string | null;
  event_date: string | null;
  event_start_time: string | null;
  time_zone: string | null;
  venue_name: string | null;
  event_location: string | null;
  guest_count: number | null;
  budget_range: string | null;
  music_requests: string | null;
  venue_has_speakers: boolean | null;
  venue_has_microphone: boolean | null;
  inquiry_message: string | null;
};

class ProviderError extends Error {
  constructor(message: string, readonly retryable: boolean) {
    super(message);
    this.name = "ProviderError";
  }
}

class ConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigurationError";
  }
}

function requiredEnv(name: string): string {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new ConfigurationError(`Missing required secret: ${name}`);
  return value;
}

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function display(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return "Not provided";
  return String(value);
}

function yesNo(value: boolean | null): string {
  if (value === null) return "Not provided";
  return value ? "Yes" : "No";
}

function retryableStatus(status: number): boolean {
  return status === 408 || status === 409 || status === 425 || status === 429 || status >= 500;
}

function emailText(job: NotificationJob): string {
  return [
    `Hi ${job.instructor_name},`,
    "",
    `${job.organizer_name} sent you a new inquiry through Hire Line Dancers. Reply to this email to respond directly to the organizer.`,
    "",
    `Event type: ${display(job.event_type)}`,
    `Event date: ${display(job.event_date)}`,
    `Start time: ${display(job.event_start_time)}${job.time_zone ? ` ${job.time_zone}` : ""}`,
    `Company: ${display(job.company_name)}`,
    `Venue: ${display(job.venue_name)}`,
    `Location: ${display(job.event_location)}`,
    `Guests: ${display(job.guest_count)}`,
    `Budget: ${display(job.budget_range)}`,
    `Venue speakers: ${yesNo(job.venue_has_speakers)}`,
    `Venue microphone: ${yesNo(job.venue_has_microphone)}`,
    `Music requests: ${display(job.music_requests)}`,
    "",
    "Message:",
    display(job.inquiry_message),
    "",
    `Organizer email: ${job.organizer_email}`,
    "",
    "Please reply within 48 hours, even if you are not available.",
  ].join("\n");
}

function emailHtml(job: NotificationJob): string {
  const rows: Array<[string, string]> = [
    ["Event type", display(job.event_type)],
    ["Event date", display(job.event_date)],
    ["Start time", `${display(job.event_start_time)}${job.time_zone ? ` ${job.time_zone}` : ""}`],
    ["Company", display(job.company_name)],
    ["Venue", display(job.venue_name)],
    ["Location", display(job.event_location)],
    ["Guests", display(job.guest_count)],
    ["Budget", display(job.budget_range)],
    ["Venue speakers", yesNo(job.venue_has_speakers)],
    ["Venue microphone", yesNo(job.venue_has_microphone)],
    ["Music requests", display(job.music_requests)],
  ];

  const details = rows.map(([label, value]) => `
    <tr>
      <th align="left" style="padding:8px 12px 8px 0;color:#57607a;vertical-align:top">${escapeHtml(label)}</th>
      <td style="padding:8px 0;color:#1c2a44">${escapeHtml(value)}</td>
    </tr>`).join("");

  return `<!doctype html>
  <html lang="en">
    <body style="margin:0;background:#fbfaf5;color:#1c2a44;font-family:Arial,sans-serif;line-height:1.55">
      <div style="max-width:640px;margin:0 auto;padding:32px 20px">
        <div style="border-top:8px solid #e7a33c;background:#ffffff;padding:30px">
          <p style="margin:0 0 18px">Hi ${escapeHtml(job.instructor_name)},</p>
          <h1 style="margin:0 0 16px;font-size:28px;line-height:1.15">You have a new event inquiry</h1>
          <p style="margin:0 0 22px">${escapeHtml(job.organizer_name)} sent you an inquiry through Hire Line Dancers. Reply to this email to respond directly to the organizer.</p>
          <table role="presentation" style="width:100%;border-collapse:collapse">${details}</table>
          <div style="margin-top:22px;padding:18px;background:#f1efe8">
            <strong>Organizer message</strong>
            <p style="margin:8px 0 0;white-space:pre-wrap">${escapeHtml(display(job.inquiry_message))}</p>
          </div>
          <p style="margin:22px 0 0"><strong>Reply within 48 hours</strong>, even if you are not available. Your reply will go to ${escapeHtml(job.organizer_email)}.</p>
        </div>
      </div>
    </body>
  </html>`;
}

async function sendEmail(job: NotificationJob): Promise<string> {
  const apiKey = requiredEnv("RESEND_API_KEY");
  const from = requiredEnv("RESEND_FROM_EMAIL");
  let response: Response;

  try {
    response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      signal: AbortSignal.timeout(15_000),
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": `hld-inquiry-${job.job_id}-email`,
      },
      body: JSON.stringify({
        from,
        to: [job.delivered_to_email],
        reply_to: job.organizer_email,
        subject: `New ${job.event_type || "event"} inquiry from ${job.organizer_name}`,
        text: emailText(job),
        html: emailHtml(job),
      }),
    });
  } catch (error) {
    throw new ProviderError(error instanceof Error ? error.message : "Resend request failed", true);
  }

  const payload = await response.json().catch(() => ({})) as { id?: string; message?: string };
  if (!response.ok || !payload.id) {
    throw new ProviderError(
      `Resend returned ${response.status}: ${payload.message || "email was not accepted"}`,
      retryableStatus(response.status),
    );
  }
  return payload.id;
}

async function sendSms(job: NotificationJob): Promise<string> {
  if (!job.delivered_to_phone_e164) {
    throw new ProviderError("SMS recipient is missing a phone number", false);
  }

  const accountSid = requiredEnv("TWILIO_ACCOUNT_SID");
  const authToken = requiredEnv("TWILIO_AUTH_TOKEN");
  const messagingServiceSid = Deno.env.get("TWILIO_MESSAGING_SERVICE_SID")?.trim();
  const fromNumber = Deno.env.get("TWILIO_FROM_NUMBER")?.trim();
  if (!messagingServiceSid && !fromNumber) {
    throw new ConfigurationError("Configure TWILIO_MESSAGING_SERVICE_SID or TWILIO_FROM_NUMBER");
  }

  const form = new URLSearchParams({
    To: job.delivered_to_phone_e164,
    Body: "Hire Line Dancers: You have a new inquiry to teach. Check your inbox and reply to the organizer by email. Manage text alerts at https://hirelinedancers.com/account/.",
  });
  if (messagingServiceSid) form.set("MessagingServiceSid", messagingServiceSid);
  else form.set("From", fromNumber!);

  let response: Response;
  try {
    response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Messages.json`,
      {
        method: "POST",
        signal: AbortSignal.timeout(15_000),
        headers: {
          Authorization: `Basic ${btoa(`${accountSid}:${authToken}`)}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: form,
      },
    );
  } catch (error) {
    throw new ProviderError(error instanceof Error ? error.message : "Twilio request failed", true);
  }

  const payload = await response.json().catch(() => ({})) as {
    sid?: string;
    message?: string;
  };
  if (!response.ok || !payload.sid) {
    throw new ProviderError(
      `Twilio returned ${response.status}: ${payload.message || "message was not accepted"}`,
      retryableStatus(response.status),
    );
  }
  return payload.sid;
}

async function requireCurrentSmsConsent(admin: AdminClient, job: NotificationJob): Promise<void> {
  const { data: recipient, error: recipientError } = await admin
    .from("inquiry_recipients")
    .select("instructor_profile_id")
    .eq("id", job.inquiry_recipient_id)
    .maybeSingle();

  if (recipientError) {
    throw new ProviderError("Unable to verify the current SMS recipient", true);
  }
  if (!recipient?.instructor_profile_id) {
    throw new ProviderError("SMS suppressed because the inquiry has no instructor profile", false);
  }

  const { data: settings, error: settingsError } = await admin
    .from("instructor_private_settings")
    .select("inquiry_phone_e164,sms_notifications_enabled,sms_consent_at,sms_opted_out_at")
    .eq("instructor_profile_id", recipient.instructor_profile_id)
    .maybeSingle();

  if (settingsError) {
    throw new ProviderError("Unable to verify current SMS consent", true);
  }
  if (
    !settings
    || !settings.sms_notifications_enabled
    || !settings.sms_consent_at
    || settings.sms_opted_out_at
    || settings.inquiry_phone_e164 !== job.delivered_to_phone_e164
  ) {
    throw new ProviderError("SMS suppressed because current consent is not active for this phone number", false);
  }
}

async function finishJob(
  admin: AdminClient,
  job: NotificationJob,
  result: { success: boolean; providerMessageId?: string; error?: string; retryable?: boolean },
): Promise<string> {
  const { data, error } = await admin.rpc("complete_inquiry_notification_job", {
    p_job_id: job.job_id,
    p_success: result.success,
    p_provider_message_id: result.providerMessageId ?? null,
    p_error: result.error?.slice(0, 2000) ?? null,
    p_retryable: result.retryable ?? false,
  });
  if (error) throw new Error(`Unable to complete notification job ${job.job_id}: ${error.message}`);
  return String(data);
}

async function deferJob(admin: AdminClient, job: NotificationJob, error: string): Promise<string> {
  const { data, error: deferError } = await admin.rpc("defer_inquiry_notification_job", {
    p_job_id: job.job_id,
    p_error: error.slice(0, 2000),
    p_delay: "15 minutes",
  });
  if (deferError) throw new Error(`Unable to defer notification job ${job.job_id}: ${deferError.message}`);
  return String(data);
}

async function processJob(admin: AdminClient, job: NotificationJob): Promise<string> {
  try {
    if (job.channel === "sms") {
      await requireCurrentSmsConsent(admin, job);
    }
    const providerMessageId = job.channel === "email"
      ? await sendEmail(job)
      : await sendSms(job);
    return await finishJob(admin, job, { success: true, providerMessageId });
  } catch (error) {
    if (error instanceof ConfigurationError) {
      console.error("Notification provider is not configured", job.job_id, job.channel, error.message);
      return await deferJob(admin, job, error.message);
    }
    const providerError = error instanceof ProviderError
      ? error
      : new ProviderError(error instanceof Error ? error.message : "Notification failed", true);
    console.error("Notification provider request failed", job.job_id, job.channel, providerError.message);
    return await finishJob(admin, job, {
      success: false,
      error: providerError.message,
      retryable: providerError.retryable,
    });
  }
}

export default {
  fetch: withSupabase({ auth: "secret:automations", cors: false }, async (req, ctx) => {
    if (req.method !== "POST") {
      return Response.json({ error: "Method not allowed" }, { status: 405 });
    }

    try {
      requiredEnv("RESEND_API_KEY");
      requiredEnv("RESEND_FROM_EMAIL");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Email provider is not configured";
      console.error("Notification worker configuration error", message);
      return Response.json({ error: "Notification worker is not configured" }, { status: 503 });
    }

    const body = await req.json().catch(() => ({})) as { limit?: number };
    const requestedLimit = Number.isInteger(body.limit) ? Number(body.limit) : 10;
    const limit = Math.max(1, Math.min(requestedLimit, 25));
    const { data, error } = await ctx.supabaseAdmin.rpc("claim_inquiry_notification_jobs", {
      p_limit: limit,
      p_lock_timeout: "10 minutes",
    });

    if (error) {
      console.error("Unable to claim notification jobs", error.code, error.message);
      return Response.json({ error: "Unable to claim notification jobs" }, { status: 500 });
    }

    const jobs = (data ?? []) as NotificationJob[];
    const settled = await Promise.allSettled(jobs.map((job) => processJob(ctx.supabaseAdmin, job)));
    const outcomes = settled.map((result) => result.status === "fulfilled" ? result.value : "worker_error");

    return Response.json({
      claimed: jobs.length,
      sent: outcomes.filter((status) => status === "sent").length,
      rescheduled: outcomes.filter((status) => status === "pending").length,
      failed: outcomes.filter((status) => status === "failed" || status === "worker_error").length,
    }, {
      headers: { "Cache-Control": "no-store" },
    });
  }),
};
