# Hire Line Dancers server functions

These functions implement the approved-instructor payment flow and inquiry notifications. They keep Stripe, Resend, Twilio, and Supabase secret keys on the server.

## Functions

### `create-instructor-checkout`

Authenticated instructor endpoint. The account UI should invoke this exact function name after an administrator changes the instructor profile status to `approved`.

The function:

1. Requires a valid Supabase user JWT.
2. Requires the caller to own an instructor profile whose status is exactly `approved`.
3. Reads the fixed Stripe Price ID from a server secret.
4. Verifies that the Price is active, recurring monthly, USD, and exactly $14.99.
5. Requires a payment method and gives first-time instructors a single 30-day free trial.
6. Reuses an unexpired Checkout Session when possible.
7. Creates Stripe Checkout in subscription mode with the instructor UUID in Checkout and Subscription metadata.

The browser should send a stable random value in the `Idempotency-Key` header when retrying the same action. The value must contain 8 to 64 ASCII letters, numbers, underscores, or hyphens.

Example with `supabase-js`:

```ts
const { data, error } = await supabase.functions.invoke(
  "create-instructor-checkout",
  {
    method: "POST",
    headers: { "Idempotency-Key": crypto.randomUUID() },
  },
);

if (!error && data?.url) window.location.assign(data.url);
```

### `create-billing-portal`

Authenticated instructor endpoint for Stripe Customer Portal. It verifies that the caller owns the instructor profile and that the stored membership uses the exact Hire Line Dancers Price before creating a short-lived Portal Session.

The account UI should show a **Manage membership** button for a published instructor or a membership whose status is `trialing`, `active`, `past_due`, `unpaid`, or `paused`. The button should invoke this exact function name and redirect to the returned URL:

```ts
const { data, error } = await supabase.functions.invoke(
  "create-billing-portal",
  { method: "POST" },
);

if (!error && data?.url) window.location.assign(data.url);
```

This keeps cancellation, payment-method changes, and invoice history in Stripe instead of rebuilding billing screens in the application.

### `stripe-webhook`

Public only at the Supabase gateway. It authenticates Stripe by verifying the `Stripe-Signature` against the untouched raw request body. It never trusts the Checkout success redirect.

Subscribe the Stripe webhook endpoint to:

- `checkout.session.completed`
- `invoice.paid`
- `invoice.payment_failed`
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `customer.subscription.paused`
- `customer.subscription.resumed`

Only subscriptions containing `STRIPE_PRICE_ID` are processed. This isolates Hire Line Dancers when the Stripe account also contains other product lines.

Each Stripe event ID is inserted transactionally. Duplicate deliveries return `duplicate` without applying the event twice. The handler retrieves the current Subscription from Stripe before syncing, which reduces event ordering problems.

An active or trialing membership changes an `approved` profile to `published`. An inactive, unpaid, paused, or canceled membership changes a `published` profile back to `approved`. The profile and media remain stored. An administrator-set `suspended` profile is never republished automatically. Reapproving a suspended or draft profile publishes it immediately when its canonical membership is still active or trialing. `past_due` leaves the current profile visibility unchanged so a separate billing grace policy can be applied later.

Stripe refund events are not treated as subscription cancellation. When honoring the booking guarantee, the operator must refund the appropriate charge and cancel the membership subscription. The cancellation webhook controls directory visibility.

### `process-inquiry-notifications`

Internal worker protected by the named Supabase secret key `automations` in the `apikey` header. It atomically claims up to 25 jobs with `FOR UPDATE SKIP LOCKED`, recovers locks older than 10 minutes, and retries temporary failures with exponential backoff. Six provider attempts are allowed. Missing provider secrets defer work without consuming an attempt.

New-inquiry email is sent through Resend with the organizer address in `Reply-To`. The worker also queues two email follow-ups through the same durable job system:

- Seven days after an unanswered inquiry, the instructor is asked whether it was booked: Yes, No, or In progress.
- Two days after the confirmed date of a booked event, the instructor is asked whether the event happened: Yes or No.

Follow-up links open the authenticated instructor inquiry page. Private comments are available only to the instructor and marketplace administrators. The email request uses a provider idempotency key. Optional SMS is sent through Twilio and tells the instructor to check email. Each provider request has a 15-second timeout. Provider acceptance is recorded as `sent`. The existing `delivered` state is reserved for future Resend and Twilio delivery webhooks.

Database submission limits reduce notification abuse: five inquiries per organizer per hour, 20 per organizer per day, a 10-minute duplicate cooldown for the same event and instructor, and 30 inquiries per instructor target per hour. Configure Resend and Twilio spend alerts and account-level caps as an additional control.

## Required secrets

Set these with `supabase secrets set`:

```text
APP_URL=https://hirelinedancers.com
STRIPE_SECRET_KEY=sk_live_...
STRIPE_PRICE_ID=price_...
STRIPE_WEBHOOK_SIGNING_SECRET=whsec_...
RESEND_API_KEY=re_...
RESEND_FROM_EMAIL=Hire Line Dancers <inquiries@mail.hirelinedancers.com>
```

Optional SMS secrets:

```text
TWILIO_ACCOUNT_SID=AC...
TWILIO_AUTH_TOKEN=...
TWILIO_MESSAGING_SERVICE_SID=MG...
```

Use `TWILIO_FROM_NUMBER=+1...` instead of `TWILIO_MESSAGING_SERVICE_SID` only when sending from a specific Twilio number.

Optional dedicated Stripe Customer Portal configuration:

```text
STRIPE_BILLING_PORTAL_CONFIGURATION_ID=bpc_...
```

When this value is omitted, Stripe uses the account's default Customer Portal configuration.

Supabase provides `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEYS`, `SUPABASE_SECRET_KEYS`, and `SUPABASE_JWKS` to hosted Edge Functions. For local development with `@supabase/server`, singular `SUPABASE_PUBLISHABLE_KEY` and `SUPABASE_SECRET_KEY` values are also supported.

Do not put any secret listed here into `NEXT_PUBLIC_*` variables or browser code.

## JWT and gateway settings

- `create-instructor-checkout`: keep JWT verification enabled. The function also uses `auth: "user"`.
- `create-billing-portal`: keep JWT verification enabled. The function also uses `auth: "user"`.
- `stripe-webhook`: deploy with JWT verification disabled. The function uses `auth: "none"` and verifies Stripe itself.
- `process-inquiry-notifications`: deploy with JWT verification disabled. The function uses `auth: "secret:automations"` and requires the named `automations` Supabase secret key in `apikey`.

These settings are pinned in `supabase/config.toml`. `process-inquiry-notifications` is the only notification worker. Do not create or deploy a separate dispatch worker.

## Apply and deploy

```bash
supabase db push
supabase functions deploy create-instructor-checkout
supabase functions deploy create-billing-portal
supabase functions deploy stripe-webhook
supabase functions deploy process-inquiry-notifications
```

Set secrets before testing production traffic:

```bash
supabase secrets set --env-file supabase/functions/.env.production
```

Keep that environment file outside Git.

No Stripe Product, Price, webhook endpoint, Resend domain, Twilio sender, or Supabase Cron job is created by these files. Those account changes require an authorized operator.

The Stripe account structure is pending owner review. The code supports using the existing OMG Goals, LLC Stripe account with a dedicated Hire Line Dancers Product and Price because it filters every event by the exact `STRIPE_PRICE_ID` and attaches `product_line=hire_line_dancers` metadata. A separate Stripe account remains an external accounting and business decision.

## Cron invocation

Run the notification worker once per minute. Create a Supabase secret key named exactly `automations`, then store that key and the project URL in Vault.

```sql
select vault.create_secret(
  'https://PROJECT_REF.supabase.co',
  'hld_project_url'
);

select vault.create_secret(
  'sb_secret_REPLACE_ME',
  'hld_notification_worker_key'
);

select cron.schedule(
  'process-hld-inquiry-notifications',
  '* * * * *',
  $$
  select net.http_post(
    url := (
      select decrypted_secret
      from vault.decrypted_secrets
      where name = 'hld_project_url'
    ) || '/functions/v1/process-inquiry-notifications',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', (
        select decrypted_secret
        from vault.decrypted_secrets
        where name = 'hld_notification_worker_key'
      )
    ),
    body := '{"limit":10}'::jsonb,
    timeout_milliseconds := 30000
  );
  $$
);
```

Monitor Cron invocations in Edge Function logs and inspect recent `pg_net` responses:

```sql
select id, status_code, timed_out, error_msg, created
from net._http_response
order by created desc
limit 50;
```

## Operational caveats

- Stripe must contain an active recurring Price for exactly $14.99 USD per month, and `STRIPE_PRICE_ID` must reference it. The Checkout function applies the 30-day trial and requires a payment method.
- Configure Stripe Customer Portal for payment-method updates, invoice history, and subscription cancellation before showing the production Manage membership button.
- Configure Stripe to send the listed events to `/functions/v1/stripe-webhook` and copy that endpoint's signing secret into Supabase.
- Verify the Resend sending domain before using the production From address.
- Twilio SMS requires instructor consent, an approved sender, and applicable US A2P registration. SMS remains disabled unless an instructor has opted in and all Twilio secrets are configured.
- Use the named `automations` Supabase secret key for Cron. The default or a differently named secret key will not satisfy this worker's authentication mode.
- Resend idempotency protects retries within its documented window. Twilio Message creation does not provide the same guarantee, so an ambiguous network timeout can rarely produce a duplicate SMS.
- `sent` means the provider accepted the request. Add signed Resend and Twilio status webhook functions before reporting true `delivered`, `bounced`, or `undelivered` states.
