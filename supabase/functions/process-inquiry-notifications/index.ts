import { withSupabase } from "npm:@supabase/server@^1";
import type { SupabaseClient } from "npm:@supabase/supabase-js@^2";

type AdminClient = SupabaseClient;

type NotificationType = "new_inquiry" | "booking_followup" | "completion_followup";

type NotificationJob = {
  job_id: number;
  notification_type: NotificationType | string;
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

type ProfileSubmissionJob = {
  job_id: number;
  attempt_number: number;
  instructor_profile_id: string;
  delivered_to_email: string;
  login_email: string;
  display_name: string;
  business_name: string | null;
  city: string | null;
  region: string | null;
  submitted_at: string;
};

type InstructorServiceNotificationType =
  | "profile_approved"
  | "activation_payment_failed"
  | "billing_grace_started"
  | "billing_access_paused";

type InstructorServiceJob = {
  job_id: number;
  attempt_number: number;
  notification_type: InstructorServiceNotificationType;
  instructor_profile_id: string;
  billing_recovery_id: string | null;
  delivered_to_email: string;
  login_email: string;
  display_name: string;
  profile_slug: string | null;
  recovery_status: "grace_period" | "access_paused" | null;
  has_prior_successful_payment: boolean | null;
  first_failed_at: string | null;
  grace_ends_at: string | null;
};

// Keep the Twilio implementation available for a future reviewed launch, but
// fail closed while the product is operating as email only.
const SMS_DELIVERY_PAUSED = true;

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

const EVENT_TYPE_LABELS: Record<string, string> = {
  weddings: "Wedding",
  "corporate-events": "Corporate event",
  "bachelorette-parties": "Bachelorette party",
  "bar-bat-mitzvahs": "Bar or bat mitzvah",
  "private-parties": "Private party",
  fundraisers: "Fundraiser",
  "summer-camps": "Summer camp",
  "after-school-programs": "After-school program",
  "fitness-classes": "Fitness class or studio program",
  venues: "Venue or bar event",
  "schools-community": "School or community event",
};

function eventTypeLabel(value: string | null): string {
  if (!value) return "Line dance event";
  const knownLabel = EVENT_TYPE_LABELS[value];
  if (knownLabel) return knownLabel;
  const readable = value.replaceAll("-", " ").trim();
  return readable ? `${readable.charAt(0).toUpperCase()}${readable.slice(1)}` : "Line dance event";
}

function eventTypeInSentence(value: string | null): string {
  return eventTypeLabel(value).toLocaleLowerCase("en-US");
}

function yesNo(value: boolean | null): string {
  if (value === null) return "Not provided";
  return value ? "Yes" : "No";
}

function retryableStatus(status: number): boolean {
  return status === 408 || status === 409 || status === 425 || status === 429 || status >= 500;
}

function normalizedNotificationType(job: NotificationJob): NotificationType {
  if (job.notification_type === "booking_followup" || job.notification_type === "completion_followup") {
    return job.notification_type;
  }
  return "new_inquiry";
}

function inquiryFeedbackUrl(job: NotificationJob, followup: "booking" | "completion"): string {
  const configuredAppUrl = Deno.env.get("APP_URL")?.trim() || "https://hirelinedancers.com";
  const base = configuredAppUrl.endsWith("/") ? configuredAppUrl : `${configuredAppUrl}/`;
  const url = new URL("account/", base);
  url.searchParams.set("tab", "inquiries");
  url.searchParams.set("inquiry", job.inquiry_id);
  url.searchParams.set("followup", followup);
  return url.toString();
}

function emailText(job: NotificationJob): string {
  const notificationType = normalizedNotificationType(job);
  if (notificationType === "booking_followup") {
    return [
      `Hi ${job.instructor_name},`,
      "",
      `${job.organizer_name}${job.company_name ? ` from ${job.company_name}` : ""} contacted you through Hire Line Dancers one week ago about a ${eventTypeInSentence(job.event_type)}.`,
      "",
      "Did this inquiry turn into a booking? Choose Yes, No, or In progress. Your private comments help us improve Hire Line Dancers.",
      "",
      `Event date: ${display(job.event_date)}`,
      `Location: ${display(job.event_location)}`,
      "",
      `Share the result: ${inquiryFeedbackUrl(job, "booking")}`,
    ].join("\n");
  }
  if (notificationType === "completion_followup") {
    return [
      `Hi ${job.instructor_name},`,
      "",
      `We hope your ${eventTypeInSentence(job.event_type)} on ${display(job.event_date)} went well.`,
      "",
      "Did the event happen? Choose Yes or No. Your private comments help us improve Hire Line Dancers.",
      "",
      `Share how it went: ${inquiryFeedbackUrl(job, "completion")}`,
    ].join("\n");
  }

  return [
    `Hi ${job.instructor_name},`,
    "",
    `${job.organizer_name} sent you a new inquiry through Hire Line Dancers. Reply to this email to respond directly to the organizer.`,
    "",
    `Event type: ${eventTypeLabel(job.event_type)}`,
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
  const notificationType = normalizedNotificationType(job);
  if (notificationType !== "new_inquiry") {
    const isBooking = notificationType === "booking_followup";
    const heading = isBooking ? "Did this inquiry turn into a booking?" : "Did the event happen?";
    const description = isBooking
      ? `${job.organizer_name}${job.company_name ? ` from ${job.company_name}` : ""} contacted you one week ago about a ${eventTypeInSentence(job.event_type)}.`
      : `We hope your ${eventTypeInSentence(job.event_type)} on ${display(job.event_date)} went well.`;
    const prompt = isBooking
      ? "Choose Yes, No, or In progress."
      : "Choose Yes or No.";
    const href = inquiryFeedbackUrl(job, isBooking ? "booking" : "completion");
    return `<!doctype html>
    <html lang="en">
      <body style="margin:0;background:#fbfaf5;color:#1c2a44;font-family:Arial,sans-serif;line-height:1.55">
        <div style="max-width:640px;margin:0 auto;padding:32px 20px">
          <div style="border-top:8px solid #e7a33c;background:#ffffff;padding:30px">
            <p style="margin:0 0 18px">Hi ${escapeHtml(job.instructor_name)},</p>
            <h1 style="margin:0 0 16px;font-size:28px;line-height:1.15">${escapeHtml(heading)}</h1>
            <p style="margin:0 0 12px">${escapeHtml(description)}</p>
            <p style="margin:0 0 24px">${escapeHtml(prompt)} Your private comments help us improve Hire Line Dancers.</p>
            <a href="${escapeHtml(href)}" style="display:inline-block;padding:14px 20px;background:#e7a33c;border:2px solid #1c2a44;color:#1c2a44;font-weight:700;text-decoration:none">Share the result</a>
          </div>
        </div>
      </body>
    </html>`;
  }

  const rows: Array<[string, string]> = [
    ["Event type", eventTypeLabel(job.event_type)],
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
  const supportEmail = Deno.env.get("SUPPORT_EMAIL")?.trim() || "hello@hirelinedancers.com";
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
        reply_to: normalizedNotificationType(job) === "new_inquiry"
          ? job.organizer_email
          : supportEmail,
        subject: normalizedNotificationType(job) === "booking_followup"
          ? "Did this inquiry turn into a booking?"
          : normalizedNotificationType(job) === "completion_followup"
          ? "How did your line dance event go?"
          : `New ${eventTypeInSentence(job.event_type)} inquiry from ${job.organizer_name}`,
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

function configuredAppUrl(): URL {
  const value = Deno.env.get("APP_URL")?.trim() || "https://hirelinedancers.com";
  const url = new URL(value);
  if (url.protocol !== "https:" && url.hostname !== "localhost" && url.hostname !== "127.0.0.1") {
    throw new ConfigurationError("APP_URL must use HTTPS outside local development");
  }
  return url;
}

async function profileReviewMagicLink(
  admin: AdminClient,
  job: ProfileSubmissionJob,
): Promise<string> {
  const appUrl = configuredAppUrl();
  const nextPath = `/admin/?tab=profiles&profile=${encodeURIComponent(job.instructor_profile_id)}`;
  const callback = new URL("auth/callback/", appUrl);
  callback.searchParams.set("next", nextPath);

  const { data, error } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: job.login_email,
    options: { redirectTo: callback.toString() },
  });
  const actionLink = data?.properties?.action_link;
  if (error || !actionLink) {
    throw new ProviderError(
      error?.message || "Unable to create the secure administrator review link",
      true,
    );
  }
  return actionLink;
}

function profileSubmissionText(job: ProfileSubmissionJob, reviewUrl: string): string {
  const location = [job.city, job.region].filter(Boolean).join(", ") || "Not provided";
  return [
    `${job.display_name} submitted an instructor profile for review.`,
    "",
    `Business: ${display(job.business_name)}`,
    `Location: ${location}`,
    `Submitted: ${new Date(job.submitted_at).toLocaleString("en-US", { timeZone: "America/New_York" })} ET`,
    "",
    `Review the profile: ${reviewUrl}`,
    "",
    "This private link signs in to your Hire Line Dancers administrator account and opens the submitted profile.",
  ].join("\n");
}

function profileSubmissionHtml(job: ProfileSubmissionJob, reviewUrl: string): string {
  const location = [job.city, job.region].filter(Boolean).join(", ") || "Not provided";
  const submitted = new Date(job.submitted_at).toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "America/New_York",
  });
  return `<!doctype html>
  <html lang="en">
    <body style="margin:0;background:#fbfaf5;color:#1c2a44;font-family:Arial,sans-serif;line-height:1.55">
      <div style="max-width:640px;margin:0 auto;padding:32px 20px">
        <div style="border-top:8px solid #e7a33c;background:#ffffff;padding:30px">
          <p style="margin:0 0 10px;color:#9b3822;font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase">Profile review</p>
          <h1 style="margin:0 0 16px;font-size:28px;line-height:1.15">${escapeHtml(job.display_name)} submitted a profile</h1>
          <table role="presentation" style="width:100%;margin:0 0 24px;border-collapse:collapse">
            <tr><th align="left" style="padding:7px 12px 7px 0;color:#57607a">Business</th><td style="padding:7px 0">${escapeHtml(display(job.business_name))}</td></tr>
            <tr><th align="left" style="padding:7px 12px 7px 0;color:#57607a">Location</th><td style="padding:7px 0">${escapeHtml(location)}</td></tr>
            <tr><th align="left" style="padding:7px 12px 7px 0;color:#57607a">Submitted</th><td style="padding:7px 0">${escapeHtml(`${submitted} ET`)}</td></tr>
          </table>
          <a href="${escapeHtml(reviewUrl)}" style="display:inline-block;padding:14px 20px;background:#e7a33c;border:2px solid #1c2a44;color:#1c2a44;font-weight:700;text-decoration:none">Sign in and review profile</a>
          <p style="margin:20px 0 0;color:#57607a;font-size:13px">This private link signs in to your administrator account and opens this submission directly.</p>
        </div>
      </div>
    </body>
  </html>`;
}

async function sendProfileSubmissionEmail(
  admin: AdminClient,
  job: ProfileSubmissionJob,
): Promise<string> {
  const apiKey = requiredEnv("RESEND_API_KEY");
  const from = requiredEnv("RESEND_FROM_EMAIL");
  const supportEmail = Deno.env.get("SUPPORT_EMAIL")?.trim() || "hello@hirelinedancers.com";
  const reviewUrl = await profileReviewMagicLink(admin, job);
  let response: Response;

  try {
    response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      signal: AbortSignal.timeout(15_000),
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": `hld-profile-submission-${job.job_id}-email`,
      },
      body: JSON.stringify({
        from,
        to: [job.delivered_to_email],
        reply_to: supportEmail,
        subject: `${job.display_name} submitted an instructor profile`,
        text: profileSubmissionText(job, reviewUrl),
        html: profileSubmissionHtml(job, reviewUrl),
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

function liveProfileUrl(job: InstructorServiceJob): string {
  const appUrl = configuredAppUrl();
  if (!job.profile_slug) return new URL("instructors/", appUrl).toString();
  return new URL(
    `instructors/${encodeURIComponent(job.profile_slug)}/`,
    appUrl,
  ).toString();
}

async function instructorServiceMagicLink(
  admin: AdminClient,
  job: InstructorServiceJob,
): Promise<string> {
  const appUrl = configuredAppUrl();
  const callback = new URL("auth/callback/", appUrl);
  const next = job.notification_type === "activation_payment_failed"
    ? "/account/?tab=profile&billing=activation-failed"
    : "/account/?tab=membership&billing=recovery";
  callback.searchParams.set("next", next);

  const { data, error } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: job.login_email,
    options: { redirectTo: callback.toString() },
  });
  const actionLink = data?.properties?.action_link;
  if (error || !actionLink) {
    throw new ProviderError(
      error?.message || "Unable to create the secure billing recovery link",
      true,
    );
  }
  return actionLink;
}

function approvalEmailText(
  job: InstructorServiceJob,
  profileUrl: string,
): string {
  return [
    `Hi ${job.display_name},`,
    "",
    "Wanted to let you know we just approved your profile. We are so glad to have you here.",
    "",
    "Now it is on us to connect with high-quality organizers near you, help you get work, and help you get booked.",
    "",
    "If you have any feedback about the platform, we would love to hear it. Our goal is to make this work as well as possible for you, and we are going to work very hard to make sure that happens.",
    "",
    `View your live profile: ${profileUrl}`,
    "",
    "Thank you so much,",
    "CJ",
  ].join("\n");
}

function approvalEmailHtml(
  job: InstructorServiceJob,
  profileUrl: string,
): string {
  return `<!doctype html>
  <html lang="en">
    <body style="margin:0;background:#fbfaf5;color:#1c2a44;font-family:Arial,sans-serif;line-height:1.55">
      <div style="max-width:640px;margin:0 auto;padding:32px 20px">
        <div style="border-top:8px solid #e7a33c;background:#ffffff;padding:30px">
          <p style="margin:0 0 18px">Hi ${escapeHtml(job.display_name)},</p>
          <h1 style="margin:0 0 16px;font-size:28px;line-height:1.15">Your profile has been approved</h1>
          <p style="margin:0 0 16px">Wanted to let you know we just approved your profile. We are so glad to have you here.</p>
          <p style="margin:0 0 16px">Now it is on us to connect with high-quality organizers near you, help you get work, and help you get booked.</p>
          <p style="margin:0 0 24px">If you have any feedback about the platform, we would love to hear it. Our goal is to make this work as well as possible for you, and we are going to work very hard to make sure that happens.</p>
          <a href="${escapeHtml(profileUrl)}" style="display:inline-block;padding:14px 20px;background:#e7a33c;border:2px solid #1c2a44;color:#1c2a44;font-weight:700;text-decoration:none">View your live profile</a>
          <p style="margin:24px 0 0">Thank you so much,<br>CJ</p>
        </div>
      </div>
    </body>
  </html>`;
}

function recoveryDeadline(value: string): string {
  return new Date(value).toLocaleDateString("en-US", {
    dateStyle: "long",
    timeZone: "America/New_York",
  });
}

function billingRecoveryEmailText(
  job: InstructorServiceJob,
  recoveryUrl: string,
): string {
  if (
    job.notification_type === "billing_grace_started" && job.grace_ends_at
  ) {
    const deadline = recoveryDeadline(job.grace_ends_at);
    return [
      `Hi ${job.display_name},`,
      "",
      "We had trouble processing your Hire Line Dancers membership payment. This can happen when a card expires, is replaced, or is declined by the card issuer.",
      "",
      `Because you have already completed a successful membership payment, we will keep your instructor profile live through ${deadline}. This gives you 14 days to update your payment method and resolve the overdue payment.`,
      "",
      `Update your payment method: ${recoveryUrl}`,
      "",
      "Stripe may retry the payment automatically. If the payment is not resolved by the deadline, your profile will be removed from the public directory until payment succeeds.",
      "",
      "If you need help, reply to this email.",
      "",
      "Thank you,",
      "CJ",
    ].join("\n");
  }

  return [
    `Hi ${job.display_name},`,
    "",
    "We could not process your first paid Hire Line Dancers membership charge. This can happen when a card expires, is replaced, or is declined by the card issuer.",
    "",
    "Because this membership has not completed its first successful payment, the instructor profile has been paused immediately. A 14-day grace period does not apply to the first successful payment.",
    "",
    `Update your payment method: ${recoveryUrl}`,
    "",
    "We will republish the profile automatically after Stripe confirms the overdue payment.",
    "",
    "If you need help, reply to this email.",
    "",
    "Thank you,",
    "CJ",
  ].join("\n");
}

function activationPaymentFailureEmailText(
  job: InstructorServiceJob,
  accountUrl: string,
): string {
  return [
    `Hi ${job.display_name},`,
    "",
    "We could not start your Hire Line Dancers membership with the payment method you saved. Your profile has not been published, and no 14-day grace period applies before the first successful payment.",
    "",
    `Save a new payment method and resubmit your profile: ${accountUrl}`,
    "",
    "Once your payment method works and your profile is approved, we will publish it and send your approval email.",
    "",
    "If you need help, reply to this email.",
    "",
    "Thank you,",
    "CJ",
  ].join("\n");
}

function activationPaymentFailureEmailHtml(
  job: InstructorServiceJob,
  accountUrl: string,
): string {
  return `<!doctype html>
  <html lang="en">
    <body style="margin:0;background:#fbfaf5;color:#1c2a44;font-family:Arial,sans-serif;line-height:1.55">
      <div style="max-width:640px;margin:0 auto;padding:32px 20px">
        <div style="border-top:8px solid #9b3822;background:#ffffff;padding:30px">
          <p style="margin:0 0 18px">Hi ${escapeHtml(job.display_name)},</p>
          <h1 style="margin:0 0 16px;font-size:28px;line-height:1.15">We could not start your membership</h1>
          <p style="margin:0 0 16px">We could not start your Hire Line Dancers membership with the payment method you saved.</p>
          <p style="margin:0 0 24px">Your profile has not been published, and no 14-day grace period applies before the first successful payment.</p>
          <a href="${escapeHtml(accountUrl)}" style="display:inline-block;padding:14px 20px;background:#e7a33c;border:2px solid #1c2a44;color:#1c2a44;font-weight:700;text-decoration:none">Save a new payment method</a>
          <p style="margin:24px 0 0">Once your payment method works and your profile is approved, we will publish it and send your approval email.</p>
          <p style="margin:16px 0 0">If you need help, reply to this email.</p>
          <p style="margin:24px 0 0">Thank you,<br>CJ</p>
        </div>
      </div>
    </body>
  </html>`;
}

function billingRecoveryEmailHtml(
  job: InstructorServiceJob,
  recoveryUrl: string,
): string {
  const hasGrace = job.notification_type === "billing_grace_started" &&
    Boolean(job.grace_ends_at);
  const deadline = job.grace_ends_at
    ? recoveryDeadline(job.grace_ends_at)
    : null;
  const statusCopy = hasGrace
    ? `Because you have already completed a successful membership payment, we will keep your instructor profile live through <strong>${escapeHtml(deadline)}</strong>. This gives you 14 days to update your payment method and resolve the overdue payment.`
    : "Because this membership has not completed its first successful payment, the instructor profile has been paused immediately. A 14-day grace period does not apply to the first successful payment.";
  const closingCopy = hasGrace
    ? "Stripe may retry the payment automatically. If the payment is not resolved by the deadline, your profile will be removed from the public directory until payment succeeds."
    : "We will republish the profile automatically after Stripe confirms the overdue payment.";

  return `<!doctype html>
  <html lang="en">
    <body style="margin:0;background:#fbfaf5;color:#1c2a44;font-family:Arial,sans-serif;line-height:1.55">
      <div style="max-width:640px;margin:0 auto;padding:32px 20px">
        <div style="border-top:8px solid #9b3822;background:#ffffff;padding:30px">
          <p style="margin:0 0 18px">Hi ${escapeHtml(job.display_name)},</p>
          <h1 style="margin:0 0 16px;font-size:28px;line-height:1.15">We could not process your membership payment</h1>
          <p style="margin:0 0 16px">This can happen when a card expires, is replaced, or is declined by the card issuer.</p>
          <p style="margin:0 0 24px">${statusCopy}</p>
          <a href="${escapeHtml(recoveryUrl)}" style="display:inline-block;padding:14px 20px;background:#e7a33c;border:2px solid #1c2a44;color:#1c2a44;font-weight:700;text-decoration:none">Update payment method</a>
          <p style="margin:24px 0 0">${closingCopy}</p>
          <p style="margin:16px 0 0">If you need help, reply to this email.</p>
          <p style="margin:24px 0 0">Thank you,<br>CJ</p>
        </div>
      </div>
    </body>
  </html>`;
}

async function sendInstructorServiceEmail(
  admin: AdminClient,
  job: InstructorServiceJob,
): Promise<string> {
  const apiKey = requiredEnv("RESEND_API_KEY");
  const from = requiredEnv("RESEND_FROM_EMAIL");
  const supportEmail = Deno.env.get("SUPPORT_EMAIL")?.trim() ||
    "hello@hirelinedancers.com";
  const isApproval = job.notification_type === "profile_approved";
  const isActivationFailure =
    job.notification_type === "activation_payment_failed";
  const destinationUrl = isApproval
    ? liveProfileUrl(job)
    : await instructorServiceMagicLink(admin, job);
  const subject = isApproval
    ? "Your Hire Line Dancers profile has been approved"
    : isActivationFailure
    ? "Action needed: save a new Hire Line Dancers payment method"
    : job.notification_type === "billing_grace_started"
    ? "Action needed: update your Hire Line Dancers payment method"
    : "Action needed: your Hire Line Dancers membership payment failed";
  const text = isApproval
    ? approvalEmailText(job, destinationUrl)
    : isActivationFailure
    ? activationPaymentFailureEmailText(job, destinationUrl)
    : billingRecoveryEmailText(job, destinationUrl);
  const html = isApproval
    ? approvalEmailHtml(job, destinationUrl)
    : isActivationFailure
    ? activationPaymentFailureEmailHtml(job, destinationUrl)
    : billingRecoveryEmailHtml(job, destinationUrl);

  let response: Response;
  try {
    response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      signal: AbortSignal.timeout(15_000),
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": `hld-instructor-service-${job.job_id}-email`,
      },
      body: JSON.stringify({
        from,
        to: [job.delivered_to_email],
        reply_to: supportEmail,
        subject,
        text,
        html,
      }),
    });
  } catch (error) {
    throw new ProviderError(
      error instanceof Error ? error.message : "Resend request failed",
      true,
    );
  }

  const payload = await response.json().catch(() => ({})) as {
    id?: string;
    message?: string;
  };
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

  const smsBody = normalizedNotificationType(job) === "booking_followup"
    ? `Hire Line Dancers: Did this inquiry become a booking? Update it at ${inquiryFeedbackUrl(job, "booking")}`
    : normalizedNotificationType(job) === "completion_followup"
    ? `Hire Line Dancers: Did your event happen? Update it at ${inquiryFeedbackUrl(job, "completion")}`
    : "Hire Line Dancers: You have a new inquiry to teach. Check your inbox and reply to the organizer by email. Manage text alerts at https://hirelinedancers.com/account/.";

  const form = new URLSearchParams({
    To: job.delivered_to_phone_e164,
    Body: smsBody,
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
      if (SMS_DELIVERY_PAUSED) {
        throw new ProviderError("SMS notifications are temporarily paused", false);
      }
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

async function finishProfileSubmissionJob(
  admin: AdminClient,
  job: ProfileSubmissionJob,
  result: { success: boolean; providerMessageId?: string; error?: string; retryable?: boolean },
): Promise<string> {
  const { data, error } = await admin.rpc("complete_profile_submission_notification_job", {
    p_job_id: job.job_id,
    p_success: result.success,
    p_provider_message_id: result.providerMessageId ?? null,
    p_error: result.error?.slice(0, 2000) ?? null,
    p_retryable: result.retryable ?? false,
  });
  if (error) throw new Error(`Unable to complete profile notification job ${job.job_id}: ${error.message}`);
  return String(data);
}

async function deferProfileSubmissionJob(
  admin: AdminClient,
  job: ProfileSubmissionJob,
  error: string,
): Promise<string> {
  const { data, error: deferError } = await admin.rpc("defer_profile_submission_notification_job", {
    p_job_id: job.job_id,
    p_error: error.slice(0, 2000),
    p_delay: "15 minutes",
  });
  if (deferError) throw new Error(`Unable to defer profile notification job ${job.job_id}: ${deferError.message}`);
  return String(data);
}

async function processProfileSubmissionJob(
  admin: AdminClient,
  job: ProfileSubmissionJob,
): Promise<string> {
  try {
    const providerMessageId = await sendProfileSubmissionEmail(admin, job);
    return await finishProfileSubmissionJob(admin, job, { success: true, providerMessageId });
  } catch (error) {
    if (error instanceof ConfigurationError) {
      console.error("Profile notification provider is not configured", job.job_id, error.message);
      return await deferProfileSubmissionJob(admin, job, error.message);
    }
    const providerError = error instanceof ProviderError
      ? error
      : new ProviderError(error instanceof Error ? error.message : "Profile notification failed", true);
    console.error("Profile notification request failed", job.job_id, providerError.message);
    return await finishProfileSubmissionJob(admin, job, {
      success: false,
      error: providerError.message,
      retryable: providerError.retryable,
    });
  }
}

async function finishInstructorServiceJob(
  admin: AdminClient,
  job: InstructorServiceJob,
  result: {
    success: boolean;
    providerMessageId?: string;
    error?: string;
    retryable?: boolean;
  },
): Promise<string> {
  const { data, error } = await admin.rpc(
    "complete_instructor_service_notification_job",
    {
      p_job_id: job.job_id,
      p_success: result.success,
      p_provider_message_id: result.providerMessageId ?? null,
      p_error: result.error?.slice(0, 2000) ?? null,
      p_retryable: result.retryable ?? false,
    },
  );
  if (error) {
    throw new Error(
      `Unable to complete instructor service notification ${job.job_id}: ${error.message}`,
    );
  }
  return String(data);
}

async function deferInstructorServiceJob(
  admin: AdminClient,
  job: InstructorServiceJob,
  error: string,
): Promise<string> {
  const { data, error: deferError } = await admin.rpc(
    "defer_instructor_service_notification_job",
    {
      p_job_id: job.job_id,
      p_error: error.slice(0, 2000),
      p_delay: "15 minutes",
    },
  );
  if (deferError) {
    throw new Error(
      `Unable to defer instructor service notification ${job.job_id}: ${deferError.message}`,
    );
  }
  return String(data);
}

async function processInstructorServiceJob(
  admin: AdminClient,
  job: InstructorServiceJob,
): Promise<string> {
  try {
    const providerMessageId = await sendInstructorServiceEmail(admin, job);
    return await finishInstructorServiceJob(admin, job, {
      success: true,
      providerMessageId,
    });
  } catch (error) {
    if (error instanceof ConfigurationError) {
      console.error(
        "Instructor service email provider is not configured",
        job.job_id,
        error.message,
      );
      return await deferInstructorServiceJob(admin, job, error.message);
    }
    const providerError = error instanceof ProviderError
      ? error
      : new ProviderError(
        error instanceof Error ? error.message : "Instructor service email failed",
        true,
      );
    console.error(
      "Instructor service email request failed",
      job.job_id,
      providerError.message,
    );
    return await finishInstructorServiceJob(admin, job, {
      success: false,
      error: providerError.message,
      retryable: providerError.retryable,
    });
  }
}

export default {
  fetch: withSupabase<any>({ auth: "secret:automations", cors: false }, async (req, ctx) => {
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
    const { data: expiredGracePeriods, error: expiryError } = await ctx
      .supabaseAdmin.rpc("expire_instructor_billing_grace_periods");
    if (expiryError) {
      console.error(
        "Unable to expire instructor billing grace periods",
        expiryError.code,
        expiryError.message,
      );
      return Response.json(
        { error: "Unable to enforce billing grace periods" },
        { status: 500 },
      );
    }

    const { error: enqueueError } = await ctx.supabaseAdmin.rpc("enqueue_due_inquiry_followups");
    if (enqueueError) {
      console.error("Unable to enqueue due inquiry follow-ups", enqueueError.code, enqueueError.message);
      return Response.json({ error: "Unable to enqueue inquiry follow-ups" }, { status: 500 });
    }

    const { data, error } = await ctx.supabaseAdmin.rpc("claim_inquiry_notification_jobs_v2", {
      p_limit: limit,
      p_lock_timeout: "10 minutes",
    });

    if (error) {
      console.error("Unable to claim notification jobs", error.code, error.message);
      return Response.json({ error: "Unable to claim notification jobs" }, { status: 500 });
    }

    const jobs = (data ?? []) as NotificationJob[];
    const { data: profileData, error: profileError } = await ctx.supabaseAdmin.rpc(
      "claim_profile_submission_notification_jobs",
      { p_limit: limit, p_lock_timeout: "10 minutes" },
    );
    if (profileError) {
      console.error("Unable to claim profile submission notifications", profileError.code, profileError.message);
      return Response.json({ error: "Unable to claim profile submission notifications" }, { status: 500 });
    }

    const profileJobs = (profileData ?? []) as ProfileSubmissionJob[];
    const { data: serviceData, error: serviceError } = await ctx.supabaseAdmin
      .rpc(
        "claim_instructor_service_notification_jobs",
        { p_limit: limit, p_lock_timeout: "10 minutes" },
      );
    if (serviceError) {
      console.error(
        "Unable to claim instructor service notifications",
        serviceError.code,
        serviceError.message,
      );
      return Response.json(
        { error: "Unable to claim instructor service notifications" },
        { status: 500 },
      );
    }

    const serviceJobs = (serviceData ?? []) as InstructorServiceJob[];
    const [inquirySettled, profileSettled, serviceSettled] = await Promise.all([
      Promise.allSettled(jobs.map((job) => processJob(ctx.supabaseAdmin, job))),
      Promise.allSettled(profileJobs.map((job) => processProfileSubmissionJob(ctx.supabaseAdmin, job))),
      Promise.allSettled(serviceJobs.map((job) => processInstructorServiceJob(ctx.supabaseAdmin, job))),
    ]);
    const outcomes = inquirySettled.map((result) => result.status === "fulfilled" ? result.value : "worker_error");
    const profileOutcomes = profileSettled.map((result) => result.status === "fulfilled" ? result.value : "worker_error");
    const serviceOutcomes = serviceSettled.map((result) => result.status === "fulfilled" ? result.value : "worker_error");
    const allOutcomes = [...outcomes, ...profileOutcomes, ...serviceOutcomes];

    return Response.json({
      claimed: jobs.length + profileJobs.length + serviceJobs.length,
      inquiryClaimed: jobs.length,
      profileClaimed: profileJobs.length,
      serviceClaimed: serviceJobs.length,
      expiredGracePeriods: Number(expiredGracePeriods ?? 0),
      sent: allOutcomes.filter((status) => status === "sent").length,
      rescheduled: allOutcomes.filter((status) => status === "pending").length,
      failed: allOutcomes.filter((status) => status === "failed" || status === "worker_error").length,
    }, {
      headers: { "Cache-Control": "no-store" },
    });
  }),
};
