# Backend setup

Hire Line Dancers uses Supabase Auth, Postgres, Storage, and Edge Functions. The browser can display public instructor profiles, but profile management, inquiries, and membership activation require a signed-in user.

The migrations and Edge Function source are in this repository. Creating or changing Supabase, Google, Stripe, Resend, and Twilio resources is an external account action and is not completed by the code alone.

## Architecture

1. The browser connects to Supabase with the project URL and a publishable key.
2. Users sign in with Google or an email magic link. Both flows return through `/auth/callback/`.
3. A database trigger creates one `accounts` row for each Supabase Auth user.
4. Account onboarding assigns the user an `organizer` or `instructor` role.
5. Instructors complete a private workspace, upload media, and submit a profile for review.
6. An administrator approves the profile. Approval enables Stripe Checkout with a payment method required, 30 days free, then the fixed $14.99 monthly membership.
7. A signature-verified Stripe webhook publishes profiles with active or trialing memberships and unpublishes profiles when the membership ends. Profile content is preserved.
8. Signed-in instructors open Stripe Customer Portal to cancel, update payment methods, or review invoices.
9. Organizers can browse without signing in. They must sign in and finish organizer onboarding before the authenticated `submit_inquiry` database function accepts an inquiry.
10. Each inquiry creates durable email and optional SMS jobs. The internal notification worker claims jobs safely, sends them, and records provider acceptance or retry state.
11. Organizers and instructors communicate by email. The notification email uses the organizer as `Reply-To`.

Anonymous application inserts, anonymous inquiry inserts, anonymous media uploads, and Stripe Payment Links are not part of this architecture.

## 1. Connect the Supabase project

Install the Supabase CLI, sign in, and link this repository to the intended project:

```bash
supabase login
supabase link --project-ref YOUR_PROJECT_REF
```

Apply all migrations in timestamp order:

```bash
supabase db push
```

The relevant migrations are:

- `202608020001_add_instructor_favorite_song.sql`
- `202608020010_marketplace_accounts_and_inquiries.sql`
- `202608020011_payments_and_notification_workers.sql`
- `202608040001_admin_analytics_and_inquiry_followups.sql`

Do not recreate the old `instructor_applications` or minimal `inquiries` tables by hand. Migration `202608020010` establishes the marketplace schema and upgrades an older inquiry table if one exists. Migration `202608020011` adds approve-then-pay membership state, webhook idempotency, and notification worker functions.

## 2. Configure browser environment variables

Copy `.env.local.example` to `.env.local`:

```bash
cp .env.local.example .env.local
```

Set:

```text
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_...
```

The existing variable name ends in `ANON_KEY` for application compatibility. It can contain the current Supabase publishable key or a legacy anon key. Never put a secret key, service role key, Stripe key, Resend key, or Twilio credential in a `NEXT_PUBLIC_*` variable.

These values are included in the static browser build. Add the same two values as GitHub Actions repository secrets before deploying to GitHub Pages.

## 3. Configure Supabase Auth

### URL configuration

In Supabase Auth URL Configuration, set:

```text
Site URL: https://hirelinedancers.com
Redirect URL: https://hirelinedancers.com/auth/callback/
```

Add the exact origin used for local development, for example:

```text
http://localhost:3000/auth/callback/
http://127.0.0.1:3000/auth/callback/
```

Supabase accepts only configured redirect destinations. Keep the trailing callback path consistent with the application.

### Google sign-in

Google is the primary sign-in option.

1. Create a Google OAuth web client.
2. Add the production and development site origins as authorized JavaScript origins.
3. Add the Supabase callback URL shown on the Supabase Google provider page as an authorized redirect URI in Google.
4. Save the Google Client ID and Client Secret in the Supabase Google provider settings.
5. Enable the Google provider.

Do not put the Google Client Secret in this repository or in the browser environment.

### Email magic links

Keep Supabase email authentication enabled. The application calls `signInWithOtp` with account creation enabled, which sends a magic link by default.

Configure production SMTP before inviting public users. Supabase's default SMTP service is intended only for testing and restricts recipients. Add the production callback URL to the redirect allow list and test a link in a private browser window.

## 4. Understand accounts and access

The database creates an `accounts` row when an Auth user is created. The user then completes onboarding as either an organizer or instructor through `complete_account_onboarding`.

Key access rules:

- Anyone can read a `published` instructor profile.
- Only the profile owner and administrators can edit an instructor profile.
- Only authenticated instructors can upload to their own `instructor-media/<auth-user-id>/...` path.
- Only authenticated organizers can call `submit_inquiry`.
- Inquiry participants can read their own inquiry records.
- Stripe state and notification worker writes are restricted to server-side service access.

To create the first administrator, sign in once and then update that account from the Supabase SQL editor:

```sql
update public.accounts
set role = 'admin'
where email = 'YOUR_ADMIN_EMAIL';
```

Then register that account as the permanent marketplace owner:

```sql
insert into public.marketplace_admins (account_id, is_owner, granted_by)
select id, true, id
from public.accounts
where email = 'YOUR_ADMIN_EMAIL'
on conflict (account_id) do update set is_owner = true;
```

After that, the owner can review instructor profiles, open marketplace reports, and grant or revoke additional admin access from `/admin/`. Additional administrators keep their organizer or instructor account type. They must sign in once before the owner can grant access by email.

## 5. Instructor lifecycle

Profile state follows this sequence:

```text
draft -> pending_review -> approved -> published
```

- `draft`: the instructor can edit the profile and media.
- `pending_review`: the profile is waiting for administrator review.
- `approved`: the profile passed review and can start Stripe Checkout.
- `published`: Stripe reports an active or trialing membership, so the directory can show the profile.
- `suspended`: an administrator has disabled the profile. Stripe events do not republish it automatically.

When a membership becomes inactive, unpaid, paused, or canceled, a published profile returns to `approved`. The profile row and uploaded media are not deleted. A `past_due` event leaves visibility unchanged until a billing grace policy is chosen. Reapproving a profile publishes it immediately when its canonical membership remains active or trialing.

A Stripe refund does not automatically cancel a subscription. When honoring the booking guarantee, refund the appropriate charge and cancel the membership subscription. The cancellation webhook controls directory visibility.

## 6. Storage

Migration `202608020010` creates the `instructor-media` bucket with:

- JPEG, PNG, WebP, MP4, and WebM file types
- A 50 MB per-file limit
- Authenticated owner-folder upload, update, and delete policies
- Database limits of one headshot, one welcome video, up to three gallery images, and up to three gallery videos

The bucket is public so approved profile media can render on the public directory. Do not use it for contracts, insurance documents, payment records, or any other private file.

## 7. Stripe membership setup

The server flow uses Stripe Checkout Sessions, not a Payment Link.

The dedicated Stripe sandbox account is named `Hire a Line Dancer`. As of August 4, 2026, it contains:

- Account: `acct_1T446hLOrJYSNwve`
- Product: `prod_V0muMszWESoxub`
- Monthly Price: `price_1U0lL5LOrJYSNwvel9UaZQef`
- Customer Portal configuration: `bpc_1U0lR6LOrJYSNwvei82AsCOD`
- Manual 100 percent, once-only coupon: `W4HOTg2J`
- Webhook destination: `we_1U0lYkLOrJYSNwveYV3TCOMm`

Cards, Link, Apple Pay, and Google Pay are enabled. The Portal allows payment-method updates, invoice history, and cancellation at the end of the billing period. It does not allow plan or quantity changes.

The Supabase project currently uses the sandbox Stripe key, Price, Portal configuration, and webhook secret. Sandbox checkout cannot charge a real card. Before accepting payments, the owner must complete Stripe business verification and payout setup, then create matching live-mode resources and replace all four Stripe secrets in Supabase.

For live mode:

1. Create one recurring USD Price for exactly $14.99 per month. Checkout supplies the universal 30-day trial, so the Price itself should not have a trial setting.
2. Save its `price_...` identifier as the `STRIPE_PRICE_ID` Edge Function secret.
3. Configure a webhook endpoint at:

```text
https://YOUR_PROJECT_REF.supabase.co/functions/v1/stripe-webhook
```

4. Subscribe it to:

   - `checkout.session.completed`
   - `invoice.paid`
   - `invoice.payment_failed`
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `customer.subscription.paused`
   - `customer.subscription.resumed`

5. Save the endpoint signing secret as `STRIPE_WEBHOOK_SIGNING_SECRET`.

The exact browser-invoked Checkout function is `create-instructor-checkout`. It requires a valid user JWT, an owned profile with status `approved`, and the verified fixed monthly Price. It requires a payment method, gives a first-time instructor one 30-day trial, and prevents a second trial after that instructor has had a Stripe subscription.

Enable Stripe Customer Portal for payment-method updates, invoice history, and subscription cancellation. The authenticated `create-billing-portal` function verifies ownership and the exact Hire Line Dancers Price before creating a Portal Session. A dedicated Portal configuration is recommended when Hire Line Dancers shares a Stripe account with another product line.

The account UI includes a **Manage membership** button for published instructors and memberships with status `trialing`, `active`, `past_due`, `unpaid`, or `paused`. It invokes `create-billing-portal` and redirects the browser to the returned `url`.

## 8. Edge Function secrets

Set these in Supabase Edge Function secrets:

```text
APP_URL=https://hirelinedancers.com
STRIPE_SECRET_KEY=sk_live_...
STRIPE_PRICE_ID=price_...
STRIPE_WEBHOOK_SIGNING_SECRET=whsec_...
RESEND_API_KEY=re_...
RESEND_FROM_EMAIL=Hire Line Dancers <inquiries@mail.hirelinedancers.com>
```

Optional dedicated Customer Portal configuration:

```text
STRIPE_BILLING_PORTAL_CONFIGURATION_ID=bpc_...
```

Optional Twilio SMS:

```text
TWILIO_ACCOUNT_SID=AC...
TWILIO_AUTH_TOKEN=...
TWILIO_MESSAGING_SERVICE_SID=MG...
```

Use `TWILIO_FROM_NUMBER=+1...` instead of a Messaging Service SID only when sending from a specific Twilio number.

For production, load secrets through the dashboard or:

```bash
supabase secrets set --env-file supabase/functions/.env.production
```

Keep that environment file outside Git. Hosted Edge Functions receive Supabase URL, key, and JWKS secrets automatically.

## 9. Deploy Edge Functions

`supabase/config.toml` pins gateway verification:

- `create-instructor-checkout`: `verify_jwt = true`
- `create-billing-portal`: `verify_jwt = true`
- `stripe-webhook`: `verify_jwt = false`, because Stripe authenticates with its signature
- `process-inquiry-notifications`: `verify_jwt = false`, because the function requires the named `automations` Supabase secret key in `apikey`

Deploy:

```bash
supabase functions deploy create-instructor-checkout
supabase functions deploy create-billing-portal
supabase functions deploy stripe-webhook
supabase functions deploy process-inquiry-notifications
```

`process-inquiry-notifications` is the only notification worker. Do not deploy the removed `dispatch-inquiry-notifications` prototype.

## 10. Configure inquiry delivery

Verify the Resend sending domain before using the production From address. New instructor inquiry emails use the organizer email as `Reply-To`. Booking and event-completion follow-ups link to a private, authenticated response form instead.

SMS is optional. Enable it only when:

- the instructor provides an E.164 phone number
- the instructor opts into SMS notifications
- a compliant Twilio sender is configured
- applicable US A2P registration and consent requirements are satisfied

The worker records `sent` when Resend or Twilio accepts a request. It does not claim that the recipient received it. Signed delivery webhook functions can be added later for `delivered`, `bounced`, and `undelivered` states. Provider requests time out after 15 seconds. Missing provider secrets leave jobs queued for a later attempt instead of failing them permanently.

The database limits each organizer to five inquiries per hour and 20 per day, blocks a matching instructor and event resubmission for 10 minutes, and limits each instructor target to 30 inquiries per hour. Also configure Resend and Twilio spend alerts and account-level caps.

Create a Supabase secret key named exactly `automations`. Schedule `process-inquiry-notifications` once per minute with Supabase Cron, `pg_net`, and Vault. The complete example, including a 30-second HTTP timeout and response monitoring query, is in `supabase/functions/README.md`.

## 11. Production verification

Before launch, verify:

1. Google sign-in returns to `/auth/callback/` and opens the requested account page.
2. A magic link works for an address outside the Supabase organization.
3. Organizer and instructor onboarding create the correct account role.
4. An instructor can upload allowed media only within their own folder.
5. An administrator can approve a submitted profile.
6. Only an approved instructor can create Checkout.
7. An instructor with a membership can open Customer Portal, change a test payment method, and cancel.
8. Stripe test events update membership state once, including duplicate webhook delivery.
9. An active test subscription publishes the profile.
10. A canceled test subscription returns the profile to `approved` without deleting its content.
11. An authenticated organizer can submit an inquiry to a published or static launch profile.
12. The worker sends email with the correct `Reply-To`.
13. Optional SMS sends only for an opted-in instructor.
14. Temporary provider failures reschedule a job and terminal failures stop after six attempts.
15. Only listed administrators can open `/admin/` or query marketplace analytics.
16. Daily, weekly, monthly, annual, and custom admin reporting totals match raw inquiry records.
17. A booking follow-up is sent seven days after an unanswered inquiry, exactly once.
18. A completion follow-up is sent two days after the confirmed date of a booked event, exactly once.
19. Instructor feedback comments are visible to the instructor and administrators, but not to the organizer.

Run a production build after setting browser environment values:

```bash
npm run build
```
