import { inquiryThreadPath, inquiryThreadRecipientPath } from "./index.ts";

function assertEquals(actual: string, expected: string): void {
  if (actual !== expected) {
    throw new Error(`Expected ${expected}, received ${actual}`);
  }
}

Deno.test("thread links route account recipients to the inquiry inbox", () => {
  assertEquals(
    inquiryThreadPath("thread/id"),
    "/account/?tab=inquiries&thread=thread%2Fid",
  );
});

Deno.test("thread links route support recipients to admin messages", () => {
  assertEquals(
    inquiryThreadPath("thread/id", true),
    "/admin/?tab=messages&thread=thread%2Fid",
  );
});

Deno.test("legacy static-support jobs use the admin messages inbox", () => {
  assertEquals(
    inquiryThreadRecipientPath("legacy-thread", null),
    "/admin/?tab=messages&thread=legacy-thread",
  );
  assertEquals(
    inquiryThreadRecipientPath("legacy-thread", "instructor@example.com"),
    "/account/?tab=inquiries&thread=legacy-thread",
  );
});

import { recommendationUrl, threadNotificationContent, threadNotificationHtml, threadNotificationSms, type ThreadNotificationJob } from "./index.ts";
const notification = (type: ThreadNotificationJob["notification_type"], version = 2): ThreadNotificationJob => ({
  job_id: 1, notification_type: type, channel: "email", response_policy_version: version,
  delivered_to_phone_e164: null, inquiry_recipient_id: null, attempt_number: 1, recipient_account_id: "account",
  delivered_to_email: "instructor@example.test", thread_id: "thread", inquiry_id: "event", assignment_order: 1,
  instructor_name: "Jordan", organizer_name: "Alex", company_name: null, event_type: "corporate-events",
  event_date: "2026-12-20", event_start_time: null, time_zone: "America/New_York", venue_name: null,
  event_location: "Austin, TX", guest_count: 40, message_id: null, message_body: null, sender_name: null,
  response_due_at: "2026-09-18T12:00:00Z", fallback_consent: false
});
function assert(condition: boolean, message: string) { if (!condition) throw new Error(message); }
Deno.test("new alerts use 48 hours while historical alerts retain 72", () => {
  assert(threadNotificationContent(notification("new_thread")).instruction!.includes("48 hours"), "new deadline");
  assert(threadNotificationContent(notification("new_thread", 1)).instruction!.includes("72 hours"), "legacy deadline");
});
Deno.test("47-hour alert gives a one-hour warning and permits a late reply", () => {
  const content = threadNotificationContent(notification("response_reminder_47"));
  assert(content.instruction!.includes("next hour") && content.instruction!.includes("still reply"), "final warning");
});
Deno.test("recommendation links preserve the thread and encode the instructor", () => {
  const result = new URL(recommendationUrl("https://hirelinedancers.com/account/?tab=inquiries&thread=source", "id/with space"));
  assertEquals(result.searchParams.get("thread")!, "source");
  assertEquals(result.searchParams.get("recommend")!, "id/with space");
});
Deno.test("recommendation email escapes profile content and omits insecure images", () => {
  const job = notification("response_timeout_organizer");
  job.recommendations = [{ instructor_profile_id: "candidate", display_name: "<script>bad</script>", slug: null,
    bio: "<img src=x onerror=bad>", city: "Austin", region: "TX", headshot_path: null, headshot_url: "javascript:bad" }];
  const html = threadNotificationHtml(job, "https://hirelinedancers.com/account/?thread=source");
  assert(!html.includes("<script>") && !html.includes("javascript:") && html.includes("&lt;script&gt;"), "HTML injection blocked");
  assert(html.includes("Reach Out") && html.includes("recommend=candidate"), "recommendation CTA included");
});
Deno.test("no-match email does not invent replacement instructors", () => {
  const content = threadNotificationContent(notification("response_timeout_organizer"));
  assert(content.instruction!.includes("could not find") && content.instruction!.includes("our team"), "no-match fallback");
});
Deno.test("new inquiry SMS identifies sender and provides opt-out", () => {
  const body = threadNotificationSms(notification("new_thread"), "https://hirelinedancers.com/account/?thread=thread");
  assert(body.startsWith("Hire Line Dancers:") && body.includes("STOP") && body.includes("48 hours"), "SMS copy");
});

Deno.test("legacy timeout and unavailable alerts preserve their existing consent-based wording", () => {
  const timeout = notification("response_timeout_organizer", 1);
  assertEquals(threadNotificationContent(timeout).description, "The instructor has not responded within 72 hours.");
  assertEquals(threadNotificationContent(timeout).instruction!, "Open the conversation to review the inquiry status.");
  timeout.fallback_consent = true;
  assert(threadNotificationContent(timeout).instruction!.includes("administrator fallback review"), "legacy consent");
  const declined = notification("thread_declined", 1);
  assertEquals(threadNotificationContent(declined).instruction!, "Open the conversation to review the inquiry status.");
  declined.fallback_consent = true;
  assert(threadNotificationContent(declined).instruction!.includes("review another eligible instructor"), "legacy decline consent");
});
Deno.test("booking updates keep their original action and do not request a reply", () => {
  const html = threadNotificationHtml(notification("booking_update"), "https://hirelinedancers.com/account/");
  assert(html.includes("Open conversation") && !html.includes("Please reply on Hire Line Dancers"), "booking action");
});
