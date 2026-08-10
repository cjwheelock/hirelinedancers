# Hire Line Dancers

Static-exportable Next.js site for hirelinedancers.com, a directory intended to help event
and party planners find line dance instructors near them.

## What is included

- Navy and gold buyer-focused homepage with benefits, process, and instructor discovery
- Public database-backed instructor directory with 11 launch-market pages and 11 event-type pages
- Google sign-in and email magic-link code through Supabase Auth
- Organizer, instructor, and admin account workspaces
- Instructor onboarding, private rates, travel preferences, equipment, insurance, event preferences, favorite Spotify song, and response commitment
- One headshot, up to three additional images, one welcome video, and up to three teaching or dancing videos
- Authenticated inquiry forms, inquiry status tracking, and self-reported booking outcomes
- Durable Resend email notification jobs for inquiries, profile review, approvals, billing recovery, booking follow-ups, and event follow-ups
- Pre-review Stripe card setup with no charge before approval, followed by automatic membership activation at $14.99 per month when an instructor is approved
- Stripe Customer Portal, signature-verified membership webhooks, and 14-day failed-renewal recovery for established paying instructors
- A founding offer that gives the first 100 instructors who complete payment setup two free months after approval, plus compatible private instructor invitations without offer stacking
- Admin tracking for the request-based 90-day booking guarantee on new paid memberships, preserved legacy guarantees, claims, and manually issued Stripe-verified refunds
- Legal pages, buyer cost guide, blog, RSS feed, `sitemap.xml`, `robots.txt`, `llms.txt`, schema markup, and `CNAME`
- Auto-deploy to GitHub Pages via GitHub Actions

The browser UI, database migrations, and Edge Function source are in the repository. Real accounts, payments, and email require the external services and secrets described in `SUPABASE_SETUP.md`. SMS notifications are currently paused. The Twilio implementation remains in the notification worker for a possible future launch, but the current product does not create or send SMS jobs.

## Strategy documents

- `CONTENT_SEO_GEO_STRATEGY.md`: authority-first SEO, AI discovery, evidence standards, and the decision not to bulk publish city posts
- `OUTREACH_AND_GROWTH_PLAYBOOK.md`: deferred demand audiences, DJ partnerships, outreach tools, messaging, instructor-led content, and measurement

## Backend

See `SUPABASE_SETUP.md` for Supabase Auth, migrations, Storage, Stripe, Resend, Cron, guarantee and refund operations, secrets, and production verification. Copy `.env.local.example` to `.env.local` and add the Supabase URL and publishable key before building.

## Local development

```bash
npm install
npm run dev
```

## Production build

```bash
npm run build
```

The static export is written to `out/`.

## Deploy (GitHub Actions to GitHub Pages)

Deployment is automated by `.github/workflows/deploy.yml`. Every push to `main` builds the
static export and publishes it to GitHub Pages.

One-time setup in the GitHub repo:

1. **Settings, Secrets and variables, Actions**: add two repository secrets so the build
   bakes in your Supabase keys:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
2. **Settings, Pages, Build and deployment**: set **Source** to **GitHub Actions**.
3. Confirm the custom domain is `hirelinedancers.com` and enable **Enforce HTTPS**.

After that, just `git push` to `main` and the live site updates automatically. The `public/CNAME`
file keeps the custom domain bound on every deploy.

## Squarespace DNS for `hirelinedancers.com`

In Squarespace, open the domains dashboard, select `hirelinedancers.com`, then open DNS settings and add custom records.

Use these records for the apex/root domain:

| Type | Host | Value |
| --- | --- | --- |
| A | @ | 185.199.108.153 |
| A | @ | 185.199.109.153 |
| A | @ | 185.199.110.153 |
| A | @ | 185.199.111.153 |

Add `www`:

| Type | Host | Value |
| --- | --- | --- |
| CNAME | www | cjwheelock.github.io |

Do not add wildcard DNS records. Remove conflicting default website records if Squarespace reports a conflict.
