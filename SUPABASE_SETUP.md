# Backend setup

Hire Line Dancers uses Supabase Auth, Postgres, Storage, and Edge Functions. The browser can display public instructor profiles, but profile management, inquiries, and membership activation require a signed-in user.

The migrations and Edge Function source are in this repository. Creating or changing Supabase, Google, Stripe, and Resend resources is an external account action and is not completed by the code alone. SMS notifications are paused. The Twilio implementation is retained for possible future use, but Twilio is not required for the current product.

## Architecture

1. The browser connects to Supabase with the project URL and a publishable key.
2. Users sign in with Google or an email magic link. Both flows return through `/auth/callback/`.
3. A database trigger creates one `accounts` row for each Supabase Auth user.
4. Account onboarding assigns the user an `organizer` or `instructor` role.
5. Instructors complete a private workspace, upload media, and submit a profile for review.
6. An administrator approves the profile. Approval enables Stripe Checkout with a payment method required for the fixed $14.99 monthly membership. Checkout accepts valid Stripe promotion codes.
7. A signature-verified Stripe webhook publishes profiles with active or trialing memberships and unpublishes profiles when the membership ends. Profile content is preserved.
8. Signed-in instructors open Stripe Customer Portal to cancel, update payment methods, or review invoices.
9. Organizers can browse without signing in. They must sign in and finish organizer onboarding before the authenticated `submit_inquiry` database function accepts an inquiry.
10. Each inquiry creates a durable email job. The internal notification worker claims jobs safely, sends them, and records provider acceptance or retry state. SMS jobs are not created while SMS is paused.
11. Organizers and instructors communicate by email. New-inquiry email uses the organizer as `Reply-To`. Booking and completion follow-ups use `SUPPORT_EMAIL` as `Reply-To`.

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
- `202608040002_email_only_and_guarantee_refunds.sql`
- `202608050002_instructor_lifetime_access_and_invitations.sql`
- `202608060001_admin_multi_workspace_access.sql`
- `202608060002_allow_approved_instructor_self_service_edits.sql`
- `202608060003_harden_database_security.sql`
- `202608060004_harden_rls_event_trigger.sql`

Do not recreate the old `instructor_applications` or minimal `inquiries` tables by hand. Migration `202608020010` establishes the marketplace schema and upgrades an older inquiry table if one exists. Migration `202608020011` adds approve-then-pay membership state, webhook idempotency, and notification worker functions. Migration `202608040002` pauses SMS delivery, adds founding and guarantee records, adds claim and refund audit records, and provides owner-only claim operations plus service-only Stripe refund recording. Migration `202608050002` adds instructor invitations and permanent lifetime access that is stored separately from Stripe billing state. Migration `202608060002` lets an approved or published instructor edit profile content and media without another review while keeping review state changes restricted to administrators. Migration `202608060003` hardens the public directory boundary, fixes function search paths, closes internal trigger helpers, and grants each browser or worker RPC only to the roles that need it. Migration `202608060004` removes API execution from Supabase's automatic RLS event-trigger helper when that platform helper is present.

Confirm the production migration history before each release. Do not deploy a frontend that depends on a migration until that migration is present in the linked project.

### Public directory security

The public directory is a security-invoker view over a fixed-search-path function in the non-exposed `private` schema. That function returns only approved public profile fields and never exposes account IDs, postal codes, inquiry email addresses, rates, Stripe identifiers, or other private account data.

Internal trigger helpers cannot be called directly by browser or service API roles. Authenticated browser RPCs and service-only worker or billing RPCs have explicit grants. New database functions start without public execution and require an intentional grant in the migration that adds them.

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

Keep Supabase email authentication enabled. The application calls `signInWithOtp` with account creation enabled, which sends a magic link by default. The tracked magic-link template at `supabase/templates/magic_link.html` sends users directly to the application callback with a one-time token hash. The callback verifies that token with `verifyOtp`, so the link can be opened on a different device or browser from the one that requested it. Do not replace the custom link with `{{ .ConfirmationURL }}` while the browser client uses PKCE, because that restores the same-browser code-verifier requirement.

Configure production SMTP before inviting public users. Supabase's default SMTP service is intended only for testing and restricts recipients. Add the production callback URL to the redirect allow list, publish the tracked magic-link template to the hosted Auth configuration, and test a link in a private browser window. Deploy the callback code before publishing this template so live links always reach a compatible callback.

### Session persistence

The browser client uses persistent local storage, automatic access-token refresh, and multiple concurrent sessions. In the hosted Auth session settings, keep the time-box and inactivity timeout disabled, and keep single-session-per-user disabled. With those settings, a session continues until the user explicitly signs out of that browser, performs a security-sensitive account action, or browser storage is manually cleared. The application always uses local-scope sign-out, so signing out or switching accounts in one browser does not revoke sessions on other devices. Requesting or opening a magic link in another browser must not revoke an existing session.

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
- `approved`: the profile passed its one content review and can start Stripe Checkout. The instructor can continue editing profile fields and media without another review.
- `published`: Stripe reports an active or trialing membership, so the directory can show the profile. Later instructor edits remain published immediately.
- `suspended`: an administrator has disabled the profile. Stripe events do not republish it automatically.

When a membership becomes inactive, unpaid, paused, or canceled, a published profile returns to `approved`. The profile row and uploaded media are not deleted. A `past_due` event leaves visibility unchanged until a billing grace policy is chosen. Reapproving a profile publishes it immediately when its canonical membership remains active or trialing. Profiles with lifetime access publish after approval without a Stripe membership. Later Stripe events are recorded and ignored for those profiles, so cancellation or refund events cannot remove lifetime access or unpublish the profile.

Administrators can send instructor invitations from the admin dashboard and optionally include lifetime access. The `send-instructor-invitation` function sends a private, expiring signup link through Resend. Invitation acceptance requires an authenticated account whose normalized email matches the invited email. Lifetime grants live in `instructor_lifetime_access`, which instructors cannot insert or edit through RLS or profile settings.

A Stripe refund does not automatically cancel a subscription. Refunding and canceling are separate operator decisions. If a membership should end after a guarantee refund, cancel it separately in Stripe. The cancellation webhook, not the refund record, controls directory visibility.

## 6. Storage

Migration `202608020010` creates the `instructor-media` bucket with:

- JPEG, PNG, WebP, MP4, and WebM file types
- A 50 MB per-file limit
- Authenticated owner-folder upload, update, and delete policies
- Database limits of one headshot, one welcome video, up to three gallery images, and up to three gallery videos

The bucket is public so approved profile media can render on the public directory. Do not use it for contracts, insurance documents, payment records, or any other private file.

## 7. Stripe membership setup

The server flow uses Stripe Checkout Sessions, not a Payment Link.

The legacy Stripe sandbox on account `acct_1T446hLOrJYSNwve` contains the following test resources as of August 4, 2026. These identifiers are retained only for local and sandbox reference. Production Supabase does not use these Stripe secrets or resources.

- Account: `acct_1T446hLOrJYSNwve`
- Product: `prod_V0muMszWESoxub`
- Monthly Price: `price_1U0lL5LOrJYSNwvel9UaZQef`
- Customer Portal configuration: `bpc_1U0lR6LOrJYSNwvei82AsCOD`
- Manual 100 percent, once-only coupon: `W4HOTg2J`
- Customer-facing sandbox promotion code: `FREEMONTH`
- Webhook destination: `we_1U0lYkLOrJYSNwveYV3TCOMm`

In that sandbox, Cards, Link, Apple Pay, and Google Pay are enabled. The sandbox Portal allows payment-method updates, invoice history, and cancellation at the end of the billing period. It does not allow plan or quantity changes.

On August 5, 2026, a separate `Hire Line Dancers` Stripe account was created and activated inside the `OMG Goals Inc.` Stripe Organization. This is the production account for the product line. It uses the existing corporation's exact legal and tax information and a connected payout bank account. No new corporation was formed through Stripe Atlas.

The live Stripe resources are:

- Account: `acct_1U17IgPoYzwtbFuT`
- Product: `prod_V1EDFGlsi5zmnJ`
- Monthly Price: `price_1U1Bl5PoYzwtbFuTQ7Jw7WeN`
- Customer Portal configuration: `bpc_1U1CG4PoYzwtbFuToKoH8q3u`
- 100 percent, once-only coupon: `Z00npt3G`
- First-time-customer promotion code: `FREEMONTH`
- Promotion code object: `promo_1U1C0zPoYzwtbFuTOKJe5ni6`
- Webhook destination: `we_1U1CVOPoYzwtbFuTNyyP9Cy0`

Account `acct_1U17IgPoYzwtbFuT` has charges and payouts enabled. Stripe reports no currently due, past-due, or pending-verification requirements. Stripe Public details include the Hire Line Dancers Terms of Use, Privacy Policy, and support links. The live Customer Portal allows payment-method updates, invoice history, and cancellation at the end of the billing period, with plan and quantity changes disabled.

The generic Stripe Checkout refund display is disabled. Hire Line Dancers instead offers the conditional 12-month founding-instructor guarantee described and linked from the account activation flow, Terms of Use, and Refund Policy. It is not a generic 14-day refund promise.

The public Customer Portal login page is disabled and is not required. Signed-in instructors use the app's **Manage membership** action, which creates a short-lived authenticated Portal Session through `create-billing-portal` and returns the instructor to the account page.

The production webhook is active. Its unsigned rejection smoke test and signed synthetic event smoke test passed. The live Stripe secret key, Product, Price, dedicated Portal configuration, expected mode, terms-consent setting, and webhook signing secret are installed in Supabase.

`FREEMONTH` is restricted to first-time customers. Its underlying coupon is currently account-scoped, not Product-scoped. This is safe only while Hire Line Dancers is the sole active Product in this Stripe account. Before adding another active Product, replace the coupon and promotion code with a Product-restricted version, or otherwise restrict and retire the current account-scoped promotion.

Do not use the restricted Atlas-created `OMG Goals, Inc.` account for production. Do not copy the old `OMG Career, LLC` legal entity into Hire Line Dancers unless a later legal review confirms that it is the correct entity. The production account was activated through Stripe's registered-business flow using `OMG Goals Inc.` rather than through Atlas.

Production Supabase now uses the live Hire Line Dancers Stripe resources. Keep the legacy sandbox identifiers isolated from production. If sandbox development is moved to the new account later, recreate the test Product, Price, Portal configuration, promotion, and webhook there before changing sandbox-only secrets.

For live mode:

1. Create one recurring USD Price for exactly $14.99 per month. The Price itself should not have a trial setting.
2. Create a 100 percent off coupon with duration `once` and the customer-facing promotion code `FREEMONTH`. Restrict the code to first-time customers and, whenever the account has more than one active Product, restrict its coupon to the Hire Line Dancers Product. The current live coupon is account-scoped and must be replaced or restricted before another Product becomes active. Because Checkout accepts promotion codes, audit and archive any other active codes that should not apply to this Product.
3. Save the Product's `prod_...` identifier as `STRIPE_PRODUCT_ID` and the Price's `price_...` identifier as `STRIPE_PRICE_ID`. Set `STRIPE_EXPECTED_MODE=live` for production.
4. Configure a webhook endpoint at:

```text
https://YOUR_PROJECT_REF.supabase.co/functions/v1/stripe-webhook
```

5. Subscribe it to:

   - `checkout.session.completed`
   - `invoice.paid`
   - `invoice.payment_failed`
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `customer.subscription.paused`
   - `customer.subscription.resumed`

6. Save the endpoint signing secret as `STRIPE_WEBHOOK_SIGNING_SECRET`.

Before enabling paid Checkout, set the Terms of Use, Privacy Policy, and support URLs in Stripe Public details. Then add `consent_collection.terms_of_service = required` to Checkout after confirming the live account accepts it. These links and required consent are configured for the live account. The account page places the recurring price, Terms of Use, Privacy Policy, and Refund Policy beside the activation button.

Enable Stripe's **Limit customers to one subscription** Checkout setting. The public Customer Portal login page may remain disabled because the app creates authenticated Portal Sessions for signed-in instructors. The Checkout function also queries Stripe for an existing membership on the configured Price before it creates a new Session.

The exact browser-invoked Checkout function is `create-instructor-checkout`. It requires a valid user JWT, an owned profile with status `approved`, and the verified fixed monthly Product and Price in the expected Stripe mode. It requires a payment method, enables Stripe's promotion-code field, and requires Stripe terms consent in production. No trial is added automatically.

Checkout returns to `/account/?checkout=success&session_id={CHECKOUT_SESSION_ID}`. The authenticated `reconcile-instructor-checkout` function retrieves that Session and its Subscription from Stripe, verifies the instructor, Customer, metadata, Product, Price, and mode, then applies the current membership state through the same database function used by the webhook. The account page retries this path and preserves the Session reference until membership is confirmed, so a delayed or missed webhook does not force a paid instructor to start another checkout.

Enable Stripe Customer Portal for payment-method updates, invoice history, and subscription cancellation at the end of the billing period. Disable plan and quantity changes. The authenticated `create-billing-portal` function verifies ownership, the exact Hire Line Dancers Product and Price, live mode, and the dedicated Portal configuration before creating a Portal Session. Production requires `STRIPE_BILLING_PORTAL_CONFIGURATION_ID=bpc_1U1CG4PoYzwtbFuToKoH8q3u`. Public Portal login is optional and currently disabled.

The completed production cutover included an audit of every sandbox billing reference. Reuse this audit before any future Stripe account or mode cutover. Active sandbox statuses can correctly block Checkout even though their Customer and Subscription IDs do not exist in live mode. Also expire every open sandbox Checkout Session before deploying a replacement Checkout flow. Use:

```sql
select instructor_profile_id, subscription_status, stripe_customer_id, stripe_subscription_id
from public.instructor_private_settings
where subscription_status in ('trialing', 'active', 'past_due', 'unpaid', 'paused');

select stripe_checkout_session_id, expires_at
from public.stripe_checkout_attempts
where status = 'open';
```

Reset or migrate sandbox billing fields only after deciding how to preserve founding and guarantee history. Expire each returned open Session with the sandbox Stripe key, mark the matching attempt `expired`, and confirm that the second query returns no rows.

The account UI includes a **Manage membership** button for published instructors and memberships with status `trialing`, `active`, `past_due`, `unpaid`, or `paused`. It invokes `create-billing-portal` and redirects the browser to the returned `url`.

### Founding guarantee and refund operations

Migration `202608040002_email_only_and_guarantee_refunds.sql` assigns the first 100 qualifying instructors a permanent founding number when their first membership becomes `trialing` or `active`. It stores the original guarantee start, end, and claim deadline separately from current subscription state, so restarting a subscription does not restart the guarantee period.

Guarantee claims are handled manually so the owner can speak with the instructor and collect feedback. The admin workflow is:

1. Find the instructor by name, email, or city.
2. Log the request and review profile, contact, response, booking, and eligibility information.
3. Approve or deny the claim. Approval does not move money.
4. If approved, issue the refund manually in the Stripe Dashboard.
5. Copy the resulting Stripe Refund ID, beginning with `re_`, into the admin workflow.
6. Invoke `verify-instructor-refund`. The function retrieves the refund directly from Stripe, verifies the customer and the exact Hire Line Dancers Price, then records the verified result in Postgres.

The application never issues a refund automatically. It also never treats a refund as a cancellation. If the subscription should end, cancel it separately in Stripe and let the existing subscription webhook update membership and profile visibility.

## 8. Edge Function secrets

Set these in Supabase Edge Function secrets:

```text
APP_URL=https://hirelinedancers.com
STRIPE_SECRET_KEY=sk_live_...
STRIPE_EXPECTED_MODE=live
STRIPE_PRODUCT_ID=prod_...
STRIPE_PRICE_ID=price_...
STRIPE_BILLING_PORTAL_CONFIGURATION_ID=bpc_1U1CG4PoYzwtbFuToKoH8q3u
STRIPE_REQUIRE_TERMS_CONSENT=true
STRIPE_WEBHOOK_SIGNING_SECRET=whsec_...
RESEND_API_KEY=re_...
RESEND_FROM_EMAIL=Hire Line Dancers <inquiries@mail.hirelinedancers.com>
SUPPORT_EMAIL=hello@hirelinedancers.com
```

The dedicated Customer Portal configuration is required in production and optional for local or sandbox use. Valid Terms, Privacy, and support URLs are configured in Stripe Public details, and production uses `STRIPE_REQUIRE_TERMS_CONSENT=true`. Production Checkout fails closed when this setting is missing, invalid, or false. The live Stripe secrets listed above are installed in Supabase.

SMS is currently paused, so no Twilio secrets are required. The following names are reserved for a future reviewed SMS launch:

```text
TWILIO_ACCOUNT_SID=AC...
TWILIO_AUTH_TOKEN=...
TWILIO_MESSAGING_SERVICE_SID=MG...
```

Use `TWILIO_FROM_NUMBER=+1...` instead of a Messaging Service SID only if SMS is restored and a specific Twilio number is used.

For production, load secrets through the dashboard or:

```bash
supabase secrets set --env-file supabase/functions/.env.production
```

Keep that environment file outside Git. Hosted Edge Functions receive Supabase URL, key, and JWKS secrets automatically.

## 9. Deploy Edge Functions

`supabase/config.toml` pins gateway verification:

- `create-instructor-checkout`: `verify_jwt = true`
- `create-billing-portal`: `verify_jwt = true`
- `reconcile-instructor-checkout`: `verify_jwt = true`
- `verify-instructor-refund`: `verify_jwt = true`
- `send-instructor-invitation`: `verify_jwt = true`
- `stripe-webhook`: `verify_jwt = false`, because Stripe authenticates with its signature
- `process-inquiry-notifications`: `verify_jwt = false`, because the function requires the named `automations` Supabase secret key in `apikey`

After applying migrations and setting all production secrets, deploy the reconciliation endpoint before the Checkout endpoint:

```bash
supabase functions deploy reconcile-instructor-checkout
supabase functions deploy create-billing-portal
supabase functions deploy create-instructor-checkout
supabase functions deploy verify-instructor-refund
supabase functions deploy send-instructor-invitation
supabase functions deploy stripe-webhook
supabase functions deploy process-inquiry-notifications
```

`process-inquiry-notifications` is the only notification worker. Do not deploy the removed `dispatch-inquiry-notifications` prototype.

## 10. Configure inquiry delivery

Verify the Resend sending domain before using the production From address. New instructor inquiry emails use the organizer email as `Reply-To`. Booking and event-completion follow-ups link to a private, authenticated response form and use `SUPPORT_EMAIL` as `Reply-To`. If `SUPPORT_EMAIL` is not set, the worker uses `hello@hirelinedancers.com`.

Resend sends outbound email only. Receiving mail at `hello@hirelinedancers.com` also requires an inbound mailbox or forwarding rule with the domain host. Configure and test that routing separately.

SMS is temporarily paused. The current migration disables SMS preferences, cancels queued SMS work, stores no phone destination on new inquiry recipients, and creates only email jobs. The worker also rejects any SMS job that reaches it while the pause is active. Twilio code and historical consent records remain available for a future reviewed launch.

The worker records `sent` when Resend accepts a request. It does not claim that the recipient received it. A signed Resend delivery webhook can be added later for `delivered` and `bounced` states. Provider requests time out after 15 seconds. Missing email provider secrets leave jobs queued for a later attempt instead of failing them permanently.

The database limits each organizer to five inquiries per hour and 20 per day, blocks a matching instructor and event resubmission for 10 minutes, and limits each instructor target to 30 inquiries per hour. Also configure Resend spend alerts and account-level caps.

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
12. New-inquiry email uses the organizer as `Reply-To`, while booking and completion follow-ups use `SUPPORT_EMAIL`.
13. A submitted inquiry creates one email job and no SMS job. Any preexisting queued SMS job is canceled or rejected without a Twilio request.
14. Temporary provider failures reschedule a job and terminal failures stop after six attempts.
15. Only listed administrators can open `/admin/` or query marketplace analytics.
16. Daily, weekly, monthly, annual, and custom admin reporting totals match raw inquiry records.
17. A booking follow-up is sent seven days after an unanswered inquiry, exactly once.
18. A completion follow-up is sent two days after the confirmed date of a booked event, exactly once.
19. Instructor feedback comments are visible to the instructor and administrators, but not to the organizer.
20. The first 100 qualifying memberships receive unique, permanent founding numbers and a restarted subscription does not reset the original guarantee dates.
21. Only the marketplace owner can log and review a guarantee claim or invoke refund verification from the admin workflow.
22. A Stripe test refund for the exact membership Price can be verified and recorded once. Verification does not issue money or change subscription status.

Run a production build after setting browser environment values:

```bash
npm run build
```
