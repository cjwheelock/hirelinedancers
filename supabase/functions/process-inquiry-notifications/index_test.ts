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

import { DECLINE_NOTICE_BODY, DECLINE_NOTICE_SUBJECT, STILL_LOOKING_BODY, STILL_LOOKING_SUBJECT, recommendationUrl, threadActionLabel, threadActionUrl, threadNotificationContent, threadNotificationHtml, threadNotificationSms, threadNotificationSubject, threadNotificationText, type ThreadNotificationJob } from "./index.ts";
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


import { approvalEmailHtml, approvalEmailText, greetingFirstName, liveProfileUrl, type InstructorServiceJob } from "./index.ts";
const approval: InstructorServiceJob = {
  job_id: 1, attempt_number: 1, notification_type: "profile_approved", instructor_profile_id: "profile",
  billing_recovery_id: null, delivered_to_email: "cj@example.test", login_email: "cj@example.test",
  display_name: "CJ Wheelock", profile_slug: "cj-wheelock-new-york-ny", recovery_status: null,
  has_prior_successful_payment: null, first_failed_at: null, grace_ends_at: null, recipient_first_name: "CJ",
};
Deno.test("approval links use the deployed database profile route and encode the identifier", () => {
  Deno.env.set("APP_URL", "https://hirelinedancers.com/");
  assertEquals(liveProfileUrl(approval), "https://hirelinedancers.com/profile/?instructor=cj-wheelock-new-york-ny");
  const link = new URL(liveProfileUrl({ ...approval, profile_slug: "name/with space&other=true" }));
  assertEquals(link.pathname, "/profile/");
  assertEquals(link.searchParams.get("instructor")!, "name/with space&other=true");
  assertEquals(String([...link.searchParams].length), "1");
  assertEquals(liveProfileUrl({ ...approval, profile_slug: null }), "https://hirelinedancers.com/instructors/");
});
Deno.test("approval text and HTML use first-name greetings and the working profile link", () => {
  const link = liveProfileUrl(approval);
  assert(approvalEmailText(approval, link).startsWith("Hi CJ,\n"), "text first name");
  const html = approvalEmailHtml(approval, link);
  assert(html.includes("Hi CJ,") && !html.includes("Hi CJ Wheelock,"), "HTML first name");
  assert(html.includes(`href="${link}"`), "working profile URL");
});
Deno.test("greetings prefer an explicit compound first name over public branding", () => {
  assertEquals(greetingFirstName("Dance Company", "Mary Jane"), "Mary Jane");
  assertEquals(greetingFirstName("  CJ   Wheelock  "), "CJ");
  const html = approvalEmailHtml({ ...approval, recipient_first_name: "<CJ>" }, liveProfileUrl(approval));
  assert(html.includes("Hi &lt;CJ&gt;,") && !html.includes("Hi <CJ>"), "greeting escaped");
  const job = { ...notification("new_thread"), instructor_name: "Dance Company", recipient_first_name: "Mary Jane" };
  assertEquals(threadNotificationContent(job).recipientName!, "Mary Jane");
});

Deno.test("automatic timeout notice never blames the instructor and only mentions other instructors when some were invited", () => {
  const job = notification("response_timeout_organizer");
  job.opportunity = { automatic: true, invited_count: 4 };
  const content = threadNotificationContent(job);
  assertEquals(content.description, "That instructor may not be available. We're contacting other instructors to find you someone for your event.");
  assertEquals(threadNotificationSubject(job), "An update on your event inquiry");
  assert(content.instruction!.includes("choose who to book"), "organizer controls choice");
  const invitedText = threadNotificationText(job, "https://hirelinedancers.com/account/");
  assert(!invitedText.includes("has not responded") && !invitedText.includes("may be busy"), "no blame");
  job.opportunity.invited_count = 0;
  const lonely = threadNotificationContent(job);
  assertEquals(lonely.description, STILL_LOOKING_BODY);
  assertEquals(threadNotificationSubject(job), STILL_LOOKING_SUBJECT);
  assert(!threadNotificationText(job, "https://hirelinedancers.com/account/").includes("contacting other instructors"), "no false claim of invitations");
  const html = threadNotificationHtml(job, "https://hirelinedancers.com/account/");
  assert(html.includes("Open conversation") && !html.includes("Please reply on Hire Line Dancers"), "no reply request to the organizer");
});
Deno.test("unavailable notices use the warm approved wording and never blame the instructor", () => {
  for (const job of [notification("thread_declined"), notification("thread_declined", 1), { ...notification("thread_declined"), opportunity: { automatic: true, invited_count: 2 } }]) {
    const content = threadNotificationContent(job);
    assertEquals(content.description, DECLINE_NOTICE_BODY);
    assertEquals(content.heading, DECLINE_NOTICE_SUBJECT);
    assertEquals(threadNotificationSubject(job), DECLINE_NOTICE_SUBJECT);
    assert(!threadNotificationText(job, "https://hirelinedancers.com/account/").includes("marked that they are unavailable"), "no blame");
  }
  assertEquals(DECLINE_NOTICE_BODY, "Unfortunately, the instructor you reached out to isn't available for your event. We're working hard to find you someone else, and we'll let you know.");
});
Deno.test("still-looking notice is one calm update without a reply request", () => {
  const job = notification("still_looking_organizer");
  assertEquals(threadNotificationContent(job).description, "We're reaching out to our network separately, because finding you someone for this event is really important to us. We'll be in touch soon.");
  const html = threadNotificationHtml(job, "https://hirelinedancers.com/account/");
  assert(html.includes("Open conversation") && !html.includes("Please reply on Hire Line Dancers"), "no reply request");
});
Deno.test("organizer reply emails ask them to sign in; instructor reply emails are unchanged", () => {
  const organizer = { ...notification("new_message"), recipient_role: "organizer" as const, sender_name: "Jordan Smith" };
  assertEquals(threadNotificationContent(organizer).description, "Jordan replied to your inquiry. Sign in to your Hire Line Dancers account to read it.");
  const instructor = { ...notification("new_message"), recipient_role: "instructor" as const, sender_name: "Alex R." };
  assertEquals(threadNotificationContent(instructor).description, "Alex R. sent a message through Hire Line Dancers.");
});
Deno.test("review requests link to the review form and ask for a rating", () => {
  const job = notification("review_request");
  assertEquals(threadActionLabel(job, "html"), "Leave a review");
  const url = new URL(threadActionUrl(job, "https://hirelinedancers.com/account/?tab=inquiries&thread=thread"));
  assertEquals(url.searchParams.get("review")!, "1");
  assertEquals(url.searchParams.get("thread")!, "thread");
  assertEquals(threadActionUrl(notification("new_message"), "https://hirelinedancers.com/x"), "https://hirelinedancers.com/x");
  assert(threadNotificationContent(job).description.includes("1 to 5 stars"), "rating explained");
  assert(!threadNotificationHtml(job, "https://hirelinedancers.com/").includes("Please reply on Hire Line Dancers"), "no reply request");
});
Deno.test("instructor opportunity email renders the escaped event brief", () => {
  const job = notification("new_thread");
  job.opportunity = { automatic: true, brief: { Organizer: "Sarah <Parker>", Venue: "Congress Hall", "Music requests": "Country & pop" } };
  const html = threadNotificationHtml(job, "https://hirelinedancers.com/account/?thread=thread");
  assert(html.includes("Congress Hall"), "brief included");
  assert(html.includes("Sarah &lt;Parker&gt;") && html.includes("Country &amp; pop"), "brief is escaped");
  assert(!html.includes("Reach Out"), "no manual re-inquiry step");
});

Deno.test("closed opportunity email does not direct other instructors to a booking agreement", () => {
  const job = notification("booking_update");
  job.opportunity = { automatic: true, opportunity_closed: true };
  job.message_body = "The organizer has booked an instructor for this event. This opportunity is now closed. Thank you for your interest.";
  const content = threadNotificationContent(job);
  assertEquals(content.heading, "Opportunity closed");
  assert(content.instruction === null, "no agreement or payment next step for an unsuccessful applicant");
  const html = threadNotificationHtml(job, "https://hirelinedancers.com/account/");
  assert(!html.includes("payment status, and next steps"), "booking instructions are omitted");
});
