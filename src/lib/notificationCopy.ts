// Organizer email wording that the site previews before an action sends it.
// Must match supabase/functions/process-inquiry-notifications/index.ts
// (scripts/test-cx-improvements.mjs checks this).

export const DECLINE_NOTICE_SUBJECT = "An update on your event inquiry";
export const DECLINE_NOTICE_BODY = "Unfortunately, the instructor you reached out to isn't available for your event. We're working hard to find you someone else, and we'll let you know.";
