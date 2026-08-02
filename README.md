# Hire Line Dancers

Static-exportable Next.js site for hirelinedancers.com, a directory intended to help event
and party planners find line dance instructors near them.

## What is included

- Buyer-focused homepage: hero, benefits, how-it-works, instructor matching, featured profiles
- Seeded instructor directory with 11 launch-market pages and 11 event-type pages
- Instructor profile pages with an inquiry form scaffold for Supabase
- Instructor application scaffold with headshot and teaching photo uploads for Supabase Storage
- For-instructors page (`/instructors/join/`) with membership pricing
- Approve-then-pay Stripe flow (designed; see `SUPABASE_SETUP.md` to go live)
- Legal pages, buyer cost guide, blog, RSS feed, `sitemap.xml`, `robots.txt`, `llms.txt`, schema markup, and `CNAME`
- Auto-deploy to GitHub Pages via GitHub Actions

## Strategy documents

- `CONTENT_SEO_GEO_STRATEGY.md`: editorial calendar, SEO, AI discovery, backlinks, and evidence standards
- `OUTREACH_AND_GROWTH_PLAYBOOK.md`: demand audiences, DJ partnerships, outreach tools, messaging, instructor-led content, and measurement

## Backend (forms, uploads, payments)

See `SUPABASE_SETUP.md` for the one-time Supabase table/bucket setup and the Stripe plan.
Copy `.env.local.example` to `.env.local` and add your Supabase URL + anon key before building.

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
