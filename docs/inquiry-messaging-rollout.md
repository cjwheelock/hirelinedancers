# Inquiry messaging rollout

The inquiry update is reconciled with the October 26 booking and October 27 profile changes. The website baseline before this release is `0a4329ec43321c01453e8fc90ad1beb05cf9d980`.

## Behavior

- New threads use policy version 2: submission starts a 48-hour elapsed-time clock, with reminders at 24 and 47 hours. Version 1 threads retain their original 72-hour deadlines and notification wording.
- A platform reply or Unavailable action stops response reminders. Delivery and read events never count as replies.
- At timeout or unavailability, eligible organizers receive up to two recommendations. The email links open a review of the saved event details and editable opening message. Only Send inquiry contacts another instructor. Repeated submissions return the existing conversation.
- Instructors receive separate private conversations. The original instructor can reply after a version 2 timeout while the event is open. A booking selects its actual conversation and closes competing conversations.
- Matching requires a published profile, configured service market, matching event type, accepting-inquiries status, capacity, and no prior contact for that event. No match, urgent-event, static-listing, and delivery-failure items appear in Admin Messages.
- SMS requires a newly verified phone number and explicit consent. Previous SMS consent is never reactivated. Email remains available when SMS is off.

## Release sequence

1. Review the cumulative content comparison against the deployed baseline and the complete candidate diff. The task explicitly authorizes process copy and notification wording. Preserve unrelated work already in the checkout.
2. Confirm the intended release environment and permission to release. A push to `main` deploys the website through GitHub Pages.
3. Check remote migration history again. Dry-run `20261027051333_inquiry_48h_booking_compatibility.sql` and `20261027054400_bay_area_service_market_matching.sql` against the intended database before applying them. The migration combines the previously unshipped inquiry and SMS changes with the live booking privacy and payment rules.
4. Apply the migrations, deploy `process-inquiry-notifications`, `instructor-sms`, and `inquiry-notification-webhook`, then deploy the matching website build. The worker requires `claim_inquiry_thread_notification_jobs_v2`; the new UI requires the new recommendation and booking RPCs. Keep this sequence together. The migration preserves existing inquiry and message data.
5. Preserve the existing one-minute scheduler and its authentication. Do not create a second dispatch worker.
6. Verify new and legacy deadlines, queue processing, RLS, provider delivery, private conversations, and booking attribution on the released system. Run database security and performance advisors. Check migration history for remaining drift.

## External configuration still needed

No Twilio credentials were present when configuration names were checked on September 16. Live SMS needs an approved sender and messaging service, a Verify service, an approved messaging budget, and these server-only secrets:

- `HLD_SMS_ENABLED=true`
- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_MESSAGING_SERVICE_SID`
- `TWILIO_VERIFY_SERVICE_SID`

Enable Advanced Opt-Out and configure the incoming message webhook to:

`https://wzmyroeowbsxxibkeejf.supabase.co/functions/v1/inquiry-notification-webhook?provider=twilio`

The worker supplies a signed-verifiable callback URL with the specific job ID for outbound delivery events. The webhook validates Twilio's signature and account ID. STOP disables application preferences and queued texts; START does not silently recreate application consent. Non-keyword SMS replies direct the instructor to the website inbox and do not satisfy the response clock.

For email delivery receipts, configure `RESEND_WEBHOOK_SECRET` and subscribe the Resend webhook to `email.delivered`, `email.bounced`, `email.complained`, and `email.failed` at:

`https://wzmyroeowbsxxibkeejf.supabase.co/functions/v1/inquiry-notification-webhook`

Resend signatures are verified before accepting callbacks. Delivery callbacks that arrive before the worker saves its send receipt are retained and reconciled. A Twilio request with uncertain acceptance is flagged for review instead of blindly resent.

Two published instructors list the San Francisco Bay Area. The Bay Area market alias and matching profile mappings are added by the follow-up migration. Each may be considered as the other's alternative when the event details and capacity match. Do not manufacture coverage or availability.

## Validation

- Production Next.js build and TypeScript checking.
- New PostgreSQL tests in `supabase/tests/inquiry_response_48h.sql` and `supabase/tests/inquiry_sms_and_delivery.sql`.
- Existing `threaded_inquiry_messaging.sql` suite, retaining its version 1 policy within its rollback transaction.
- Notification copy, HTML escaping, deep links, and webhook signature tests through Deno.
- Browser checks at 1280, 390, and 320 pixels, including explicit send, saved event details, no matches, and sign-in return paths. Browser responses are isolated test fixtures; they do not contact real instructors.
- Recommendation email rendering at 700, 390, and 320 pixels, including photos, bios, and two Reach Out links.

Provider registration, real SMS delivery, and real email delivery callbacks require the external setup above. Local verification does not establish that those external services are active.
