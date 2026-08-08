# Backend setup

Hire Line Dancers uses Supabase Auth, Postgres, Storage, and Edge Functions. The browser can display public instructor profiles, but profile management, inquiries, and membership activation require a signed-in user.

The migrations and Edge Function source are in this repository. Creating or changing Supabase, Google, Stripe, and Resend resources is an external account action and is not completed by the code alone. SMS notifications are paused. The Twilio implementation is retained for possible future use, but Twilio is not required for the current product.

## Architecture

1. The browser connects to Supabase with the project URL and a publishable key.
2. Users sign in with Google or an email magic link. Both flows return through `/auth/callback/`.
3. A database trigger creates one `accounts` row for each Supabase Auth user.
4. Account onboarding assigns the user an `organizer` or `instructor` role.
5. A private instructor offer can be deliberately claimed for 14 days after issue. After claiming it, the recipient has 7 days to create an account and complete payment setup for a finished profile. Administrative approval may occur later without invalidating an offer earned on time.
6. Instructors complete a private workspace and upload a headshot. Selecting **Continue** saves the profile as a draft and opens Stripe Checkout in setup mode.
7. Stripe saves a card for future off-session billing. It does not start a subscription or charge the card. A verified setup completion submits the profile for review and atomically reserves the founding offer for each of the first 100 completed setups. A private invitation can provide the same two-month benefit after the first 100 spots are filled, but offers never stack.
8. An administrator reviews the profile. Approval automatically creates the fixed $14.99 monthly membership with the saved card. An eligible membership receives its first two monthly billing cycles free. A profile that is not approved has no subscription and no charge.
9. Every membership first activated on or after August 7, 2026 receives a request-based 90-day booking guarantee beginning with the first invoice that collects a positive membership payment. For a membership with two free months, that invoice occurs after the free period. A request can be submitted after day 90 and within the following 30 days.
10. A signature-verified Stripe webhook confirms payment setup, synchronizes memberships, publishes profiles with active or trialing memberships, and unpublishes profiles when a membership ends. Profile content is preserved.
11. Signed-in instructors open Stripe Customer Portal to cancel, update payment methods, or review invoices.
12. Organizers can browse without signing in. They must sign in and finish organizer onboarding before the authenticated `submit_inquiry` database function accepts an inquiry.
13. Each inquiry creates a durable email job. The internal notification worker claims jobs safely, sends them, and records provider acceptance or retry state. SMS jobs are not created while SMS is paused.
14. Organizers and instructors communicate by email. New-inquiry email uses the organizer as `Reply-To`. Booking and completion follow-ups use `SUPPORT_EMAIL` as `Reply-To`.

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
- `202608070001_instructor_invitation_claim_lifecycle.sql`
- `202608070002_offer_billing_and_90_day_guarantee.sql`
- `202608080001_pre_review_payment_setup.sql`

Do not recreate the old `instructor_applications` or minimal `inquiries` tables by hand. Migration `202608020010` establishes the marketplace schema and upgrades an older inquiry table if one exists. Migration `202608020011` adds the original approve-then-pay membership state, webhook idempotency, and notification worker functions. Migration `202608040002` pauses SMS delivery, adds the legacy founding-guarantee records, adds claim and refund audit records, and provides owner-only claim operations plus service-only Stripe refund recording. Existing grants created under that legacy 12-month policy remain valid. Migration `202608050002` adds instructor invitations and permanent lifetime access that is stored separately from Stripe billing state. Migration `202608060002` lets an approved or published instructor edit profile content and media without another review while keeping review state changes restricted to administrators. Migration `202608060003` hardens the public directory boundary, fixes function search paths, closes internal trigger helpers, and grants each browser or worker RPC only to the roles that need it. Migration `202608060004` removes API execution from Supabase's automatic RLS event-trigger helper when that platform helper is present. Migration `202608070001` adds the explicit invitation claim and timed profile-submission lifecycle. Migration `202608070002` applies the earned offer at billing, starts the current guarantee from the first positive paid invoice, and preserves actual legacy guarantees. Migration `202608080001` adds auditable pre-review payment setup, the locked first-100 entitlement allocation, automatic approval-time subscription activation, and compatibility with private and lifetime invitations.

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

- `draft`: the instructor can edit the profile and media. A regular instructor stays in draft while the Stripe setup Session is open.
- `pending_review`: Stripe verified the saved card and submitted the complete profile for administrator review. No subscription has started and no charge has been made.
- `approved`: the profile passed its one content review. Approval starts the membership automatically with the saved card unless the instructor has lifetime access. The instructor can continue editing profile fields and media without another review.
- `published`: Stripe reports an active or trialing membership, so the directory can show the profile. Later instructor edits remain published immediately.
- `suspended`: an administrator has disabled the profile. Stripe events do not republish it automatically.

When a membership becomes inactive, unpaid, paused, or canceled, a published profile returns to `approved`. The profile row and uploaded media are not deleted. A `past_due` event leaves visibility unchanged until a billing grace policy is chosen. Reapproving a profile publishes it immediately when its canonical membership remains active or trialing. Profiles with lifetime access publish after approval without a Stripe membership. Later Stripe events are recorded and ignored for those profiles, so cancellation or refund events cannot remove lifetime access or unpublish the profile.

Administrators can send instructor invitations from the admin dashboard and optionally include lifetime access. The `send-instructor-invitation` function sends a private, expiring signup link through Resend. A campaign offer is personal to its recipient and remains claimable for 14 days after issue. Claiming must be a deliberate action. The recipient then has 7 days to create the invited account and complete the required submission step. For a regular membership, that step is verified Stripe payment setup. Later administrative approval does not invalidate an offer earned on time. Invitation acceptance requires an authenticated account whose normalized email matches the invited email. Lifetime grants live in `instructor_lifetime_access`, which instructors cannot insert or edit through RLS or profile settings, and a lifetime instructor can submit without visiting Stripe.

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
- Legacy manual 100 percent, once-only coupon: `W4HOTg2J`
- Legacy customer-facing sandbox promotion code: `FREEMONTH`
- Webhook destination: `we_1U0lYkLOrJYSNwveYV3TCOMm`

In that sandbox, Cards, Link, Apple Pay, and Google Pay are enabled. The sandbox Portal allows payment-method updates, invoice history, and cancellation at the end of the billing period. It does not allow plan or quantity changes.

On August 5, 2026, a separate `Hire Line Dancers` Stripe account was created and activated inside the `OMG Goals Inc.` Stripe Organization. This is the production account for the product line. It uses the existing corporation's exact legal and tax information and a connected payout bank account. No new corporation was formed through Stripe Atlas.

The live Stripe resources are:

- Account: `acct_1U17IgPoYzwtbFuT`
- Product: `prod_V1EDFGlsi5zmnJ`
- Monthly Price: `price_1U1Bl5PoYzwtbFuTQ7Jw7WeN`
- Customer Portal configuration: `bpc_1U1CG4PoYzwtbFuToKoH8q3u`
- Legacy 100 percent, once-only coupon: `Z00npt3G`
- Legacy first-time-customer promotion code: `FREEMONTH`
- Legacy promotion code object: `promo_1U1C0zPoYzwtbFuTOKJe5ni6`
- Webhook destination: `we_1U1CVOPoYzwtbFuTNyyP9Cy0`

Account `acct_1U17IgPoYzwtbFuT` has charges and payouts enabled. Stripe reports no currently due, past-due, or pending-verification requirements. Stripe Public details include the Hire Line Dancers Terms of Use, Privacy Policy, and support links. The live Customer Portal allows payment-method updates, invoice history, and cancellation at the end of the billing period, with plan and quantity changes disabled.

The generic Stripe Checkout refund display is disabled. Every membership first activated on or after August 7, 2026 instead receives the request-based 90-day booking guarantee described and linked from the account activation flow, Terms of Use, and Refund Policy. The guarantee begins with the first invoice that collects a positive membership payment. Requests can be made after day 90 and within the following 30 days. Existing 12-month founding guarantees remain governed by the terms already granted.

The public Customer Portal login page is disabled and is not required. Signed-in instructors use the app's **Manage membership** action, which creates a short-lived authenticated Portal Session through `create-billing-portal` and returns the instructor to the account page.

The production webhook is active. Its unsigned rejection smoke test and signed synthetic event smoke test passed. The live Stripe secret key, Product, Price, dedicated Portal configuration, expected mode, terms-consent setting, and webhook signing secret are installed in Supabase.

`FREEMONTH` is a legacy one-month promotion and is not the private offer that makes the first two monthly billing cycles free. Do not distribute it as part of the current campaign. Archive or retire it before launch unless it remains necessary for a separately documented legacy obligation. Its underlying coupon is account-scoped, not Product-scoped, so it must not remain available when another active Product is added to this Stripe account.

Do not use the restricted Atlas-created `OMG Goals, Inc.` account for production. Do not copy the old `OMG Career, LLC` legal entity into Hire Line Dancers unless a later legal review confirms that it is the correct entity. The production account was activated through Stripe's registered-business flow using `OMG Goals Inc.` rather than through Atlas.

Production Supabase now uses the live Hire Line Dancers Stripe resources. Keep the legacy sandbox identifiers isolated from production. If sandbox development is moved to the new account later, recreate the test Product, Price, Portal configuration, promotion, and webhook there before changing sandbox-only secrets.

For live mode:

1. Create one recurring USD Price for exactly $14.99 per month. The Price itself should not have a trial setting.
2. Create a server-controlled instructor-offer coupon that is restricted to the configured Hire Line Dancers Product, is exactly 100 percent off, and repeats for exactly 2 months. It must have no `redeem_by` date and no `max_redemptions` limit because first-100 allocation, invitation timing, and one-time eligibility are enforced by the application. Do not create or distribute a customer-facing promotion code for this coupon. Do not allow another promotion to stack with it.
3. Save the Product's `prod_...` identifier as `STRIPE_PRODUCT_ID`, the Price's `price_...` identifier as `STRIPE_PRICE_ID`, and the instructor-offer coupon's identifier as `STRIPE_INSTRUCTOR_OFFER_COUPON_ID`. Set `STRIPE_EXPECTED_MODE=live` for production. The approval function retrieves the coupon and fails closed unless its mode, Product restriction, percentage, duration, and redemption settings match the exact requirements above.
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

Before enabling payment setup, set the Terms of Use, Privacy Policy, and support URLs in Stripe Public details. Then add `consent_collection.terms_of_service = required` to the setup-mode Checkout Session after confirming the live account accepts it. These links and required consent are configured for the live account. The account page places the recurring price, founding offer, no-charge-before-approval rule, Terms of Use, Privacy Policy, and Refund Policy beside the **Continue** button.

Enable Stripe's **Limit customers to one subscription** Checkout setting. The public Customer Portal login page may remain disabled because the app creates authenticated Portal Sessions for signed-in instructors. The approval function also queries Stripe for an existing membership on the configured Price before it creates a subscription.

The primary browser-invoked setup function is `create-instructor-payment-setup`. It requires a valid user JWT, an owned complete draft profile, required private contact settings, a ready headshot, and no lifetime access or existing membership. It verifies the fixed monthly Product and Price in the expected Stripe mode, creates or reuses the instructor's Stripe Customer, and opens Checkout in `setup` mode for card collection. The Session and its SetupIntent contain the instructor profile, account, product-line, and versioned setup-terms metadata. The setup Session does not contain a subscription or charge.

Setup Checkout returns to `/account/?payment_setup=success&session_id={CHECKOUT_SESSION_ID}`. The authenticated `reconcile-instructor-payment-setup` function retrieves the Session, SetupIntent, and attached card directly from Stripe. It verifies ownership, Customer, metadata, setup terms, mode, and off-session consent before submitting the profile to `pending_review`. The signed webhook performs the same server verification, so the flow remains recoverable if either the redirect or webhook is delayed.

The first 100 verified payment setups receive a unique founding position and the two-month entitlement inside one locked database transaction. A timely private invitation can receive the same billing benefit after the founding spots are full. One profile can own only one entitlement, so offers cannot stack. No entitlement can be claimed from browser input or a shared promotion code.

The admin UI invokes `review-instructor-profile` for approval. The function verifies administrator access and a completed payment setup, then durably records the approval and exact activation facts before creating the subscription with the saved card. It applies the server-controlled two-month coupon when an unredeemed entitlement exists. A regular membership attempts its first $14.99 payment only after approval is durable. The function uses stable Stripe idempotency and checks for existing memberships before creating one. After Stripe returns the canonical subscription, it synchronizes membership state and redeems the entitlement. A deterministic card failure safely returns the profile to draft for replacement payment setup, while an ambiguous Stripe failure leaves the durable activation available for an idempotent retry. Lifetime-access approvals skip Stripe.

The original `create-instructor-checkout` and `reconcile-instructor-checkout` functions remain deployed for recovery of legacy approved profiles that entered the earlier approve-then-pay flow. New profile submissions use the payment-setup functions.

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

Reset or migrate sandbox billing fields only after deciding how to preserve offer, legacy founding, and guarantee history. Expire each returned open Session with the sandbox Stripe key, mark the matching attempt `expired`, and confirm that the second query returns no rows.

The account UI includes a **Manage membership** button for published instructors and memberships with status `trialing`, `active`, `past_due`, `unpaid`, or `paused`. It invokes `create-billing-portal` and redirects the browser to the returned `url`.

### Current guarantee, legacy guarantees, and refund operations

Every membership first activated on or after August 7, 2026 receives a versioned, request-based 90-day booking guarantee. Coverage begins with the first invoice that collects a positive membership payment. For a membership with the two-month founding or private offer, that invoice occurs after the free period. For a regular membership, it is the first invoice that collects a positive membership payment after activation. A claim may be submitted only after the 90-day period ends and within the following 30 days.

Migration `202608040002_email_only_and_guarantee_refunds.sql` assigned the first 100 qualifying instructors a permanent founding number and a 12-month guarantee under the earlier policy. Those existing grants remain valid under their original terms. Do not rewrite their start, end, claim deadline, founding number, or eligibility when applying the current versioned offer.

Guarantee claims are request-only and handled manually so the owner can verify the policy version, dates, payments, booking evidence, and instructor eligibility. The admin workflow is:

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
STRIPE_INSTRUCTOR_OFFER_COUPON_ID=...
STRIPE_BILLING_PORTAL_CONFIGURATION_ID=bpc_1U1CG4PoYzwtbFuToKoH8q3u
STRIPE_REQUIRE_TERMS_CONSENT=true
STRIPE_WEBHOOK_SIGNING_SECRET=whsec_...
RESEND_API_KEY=re_...
RESEND_FROM_EMAIL=Hire Line Dancers <inquiries@mail.hirelinedancers.com>
SUPPORT_EMAIL=hello@hirelinedancers.com
```

The dedicated Customer Portal configuration is required in production and optional for local or sandbox use. Valid Terms, Privacy, and support URLs are configured in Stripe Public details, and production uses `STRIPE_REQUIRE_TERMS_CONSENT=true`. Production Checkout fails closed when this setting is missing, invalid, or false. The live Stripe secrets are installed in Supabase. On August 8, 2026, the configured instructor-offer coupon and matching `STRIPE_INSTRUCTOR_OFFER_COUPON_ID` secret were verified in the live Hire Line Dancers account as valid, restricted to the $14.99 monthly instructor membership Product, 100 percent off for exactly 2 months, without an expiration or redemption cap, and without a promotion code.

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
- `create-instructor-payment-setup`: `verify_jwt = true`
- `create-billing-portal`: `verify_jwt = true`
- `reconcile-instructor-checkout`: `verify_jwt = true`
- `reconcile-instructor-payment-setup`: `verify_jwt = true`
- `review-instructor-profile`: `verify_jwt = true`
- `verify-instructor-refund`: `verify_jwt = true`
- `send-instructor-invitation`: `verify_jwt = true`
- `stripe-webhook`: `verify_jwt = false`, because Stripe authenticates with its signature
- `process-inquiry-notifications`: `verify_jwt = false`, because the function requires the named `automations` Supabase secret key in `apikey`

After applying migrations and setting all production secrets, deploy the payment-setup reconciliation and review endpoints before the frontend that invokes them:

```bash
supabase functions deploy reconcile-instructor-payment-setup
supabase functions deploy create-instructor-payment-setup
supabase functions deploy review-instructor-profile
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
5. A complete draft profile can open setup-mode Checkout, while an incomplete profile cannot.
6. Completing setup saves an attached card, makes no charge, creates no subscription, and changes the profile to `pending_review` exactly once even when reconciliation and the webhook race.
7. The first 100 distinct completed setups receive unique founding positions from 1 through 100. The 101st setup receives no founding entitlement unless it has an eligible private invitation, and no profile receives stacked offers.
8. An administrator approval creates at most one subscription with the saved card. An eligible profile receives two free billing cycles, while a regular profile attempts the first $14.99 payment on approval.
9. A profile that is returned for changes or not approved has no subscription and no charge.
10. A lifetime-access instructor can submit and be approved without Stripe.
11. An instructor with a membership can open Customer Portal, change a test payment method, and cancel.
12. Stripe test events update setup and membership state once, including duplicate webhook delivery.
13. An active test subscription publishes the profile.
14. A canceled test subscription returns the profile to `approved` without deleting its content.
15. An authenticated organizer can submit an inquiry to a published or static launch profile.
16. New-inquiry email uses the organizer as `Reply-To`, while booking and completion follow-ups use `SUPPORT_EMAIL`.
17. A submitted inquiry creates one email job and no SMS job. Any preexisting queued SMS job is canceled or rejected without a Twilio request.
18. Temporary provider failures reschedule a job and terminal failures stop after six attempts.
19. Only listed administrators can open `/admin/` or query marketplace analytics.
20. Daily, weekly, monthly, annual, and custom admin reporting totals match raw inquiry records.
21. A booking follow-up is sent seven days after an unanswered inquiry, exactly once.
22. A completion follow-up is sent two days after the confirmed date of a booked event, exactly once.
23. Instructor feedback comments are visible to the instructor and administrators, but not to the organizer.
24. A private offer cannot be claimed more than 14 days after issue, and claiming requires an explicit recipient action.
25. A timely claim gives the recipient 7 days to create the invited account and complete payment setup. Later administrative approval preserves the timely offer.
26. The first invoice that collects a positive membership payment starts the versioned 90-day guarantee. A claim is rejected before day 90 and after the following 30-day request window.
27. Only the marketplace owner can log and review a guarantee claim or invoke refund verification from the admin workflow. Approval does not issue money.
28. A manually issued Stripe test refund for the exact membership Price can be verified and recorded once. Verification does not issue money or change subscription status.
29. Any instructor who already received a 12-month founding guarantee keeps the original founding number, coverage dates, claim deadline, and eligibility terms.

Run a production build after setting browser environment values:

```bash
npm run build
```
