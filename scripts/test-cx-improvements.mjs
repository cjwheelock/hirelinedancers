import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const constant = (source, name) => {
  const match = source.match(new RegExp(`export const ${name} = "([^"]*)";`));
  assert.ok(match, `${name} is defined`);
  return match[1];
};

test("the Unavailable dialog previews exactly the email the organizer receives", () => {
  const site = read("src/lib/notificationCopy.ts");
  const worker = read("supabase/functions/process-inquiry-notifications/index.ts");
  for (const name of ["DECLINE_NOTICE_SUBJECT", "DECLINE_NOTICE_BODY"]) {
    assert.equal(constant(site, name), constant(worker, name), `${name} matches the worker`);
  }
  assert.equal(constant(site, "DECLINE_NOTICE_BODY"), "Unfortunately, the instructor you reached out to isn't available for your event. We're working hard to find you someone else, and we'll let you know.");
  const inbox = read("src/components/InquiryInbox.tsx");
  const dialog = inbox.slice(inbox.indexOf('title="Mark yourself unavailable?"'), inbox.indexOf('confirmLabel="Unavailable"'));
  assert.match(dialog, /\{DECLINE_NOTICE_SUBJECT\}/);
  assert.match(dialog, /\{DECLINE_NOTICE_BODY\}/);
});

test("the still-looking email uses the approved wording", () => {
  const worker = read("supabase/functions/process-inquiry-notifications/index.ts");
  assert.equal(constant(worker, "STILL_LOOKING_BODY"), "We're still looking for an instructor for your event. Our team is reaching out personally and will be in touch soon.");
});

test("the inquiry form no longer promises to share organizer contact details", () => {
  const form = read("src/components/ContactInstructor.tsx");
  assert.ok(!form.includes("organizer contact information"));
  assert.ok(form.includes("We'll email you when an instructor replies. Sign in with this email to read and respond."));
  assert.match(form, /NEXT_PUBLIC_TURNSTILE_SITE_KEY/);
});

test("admins see the new attention reason and onboarding step", () => {
  assert.match(read("src/components/InquiryAttention.tsx"), /no_response_after_sharing: "No replies after sharing"/);
  const admin = read("src/components/AccountWorkspace.tsx");
  assert.match(admin, /<th>Onboarding step<\/th>/);
  assert.match(admin, /<AdminReviewsCard \/>/);
});

test("reviews appear on public profiles and in paid conversations", () => {
  assert.match(read("src/app/profile/PublicProfile.tsx"), /<PublicReviews/);
  assert.match(read("src/components/InquiryInbox.tsx"), /<BookingReviewForm/);
  const reviews = read("src/components/Reviews.tsx");
  assert.match(reviews, /submit_instructor_review/);
  assert.match(reviews, /get_instructor_reviews/);
});

test("changed files contain no em dashes", () => {
  const files = [
    "src/lib/notificationCopy.ts", "src/components/ContactInstructor.tsx", "src/components/InquiryInbox.tsx",
    "src/components/Reviews.tsx", "src/components/AdminReviews.tsx", "src/components/PayoutsCard.tsx",
    "src/components/ProfileEditor.tsx", "src/components/InquiryAttention.tsx",
    "supabase/functions/process-inquiry-notifications/index.ts", "supabase/functions/_shared/hld-profile-reminder.ts",
    "supabase/functions/_shared/hld-guest-inquiry.ts", "supabase/functions/guest-inquiry/index.ts",
    "supabase/migrations/20261115000100_inquiry_still_looking_round.sql",
    "supabase/migrations/20261115000200_hide_organizer_contact_from_instructors.sql",
    "supabase/migrations/20261115000300_guest_inquiries.sql",
    "supabase/migrations/20261115000400_instructor_onboarding_progress_and_reminders.sql",
    "supabase/migrations/20261115000500_instructor_reviews.sql"
  ];
  for (const file of files) assert.ok(!read(file).includes("\u2014"), `${file} has an em dash`);
});
