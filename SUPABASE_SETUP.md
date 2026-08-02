# Backend setup (Supabase + Stripe)

The site is a static export, but the instructor application form, photo uploads, and
buyer inquiry form all work client-side against **Supabase**. Follow these steps once,
then every submission lands in your Supabase tables and Storage bucket.

## 1. Add your Supabase keys

Copy `.env.local.example` to `.env.local` and fill in your project values
(Supabase dashboard → Project Settings → API):

```
NEXT_PUBLIC_SUPABASE_URL=https://your-project-ref.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-public-key
```

The anon key is safe to ship publicly — access is locked down by Row Level Security below.
These are read at **build time**, so rebuild (`npm run build`) after editing them. Until
they're set, the forms show a friendly "email us" fallback instead of erroring.

## 2. Create the tables (SQL editor → run this)

```sql
-- Instructor applications
create table if not exists public.instructor_applications (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  name          text not null,
  business      text,
  email         text not null,
  phone         text,
  city          text not null,
  years         int,
  travel_radius text,
  links         text,
  events        text,
  bio           text,
  favorite_song text constraint instructor_applications_favorite_song_length
    check (favorite_song is null or char_length(favorite_song) <= 200),
  spotify_track_url text constraint instructor_applications_spotify_track_url
    check (
      spotify_track_url is null
      or spotify_track_url ~ '^https://open[.]spotify[.]com/track/[A-Za-z0-9]{22}$'
    ),
  headshot_url  text not null,
  photo_urls    text[] default '{}',
  status        text not null default 'pending'  -- pending | approved | rejected | paid | active
);

-- Add the optional favorite-song fields if the table already existed.
alter table public.instructor_applications
  add column if not exists favorite_song text,
  add column if not exists spotify_track_url text;

-- Run the idempotent migration in
-- supabase/migrations/202608020001_add_instructor_favorite_song.sql
-- on an existing table so these checks are added safely.

-- Buyer inquiries (from instructor profile pages)
create table if not exists public.inquiries (
  id              uuid primary key default gen_random_uuid(),
  created_at      timestamptz not null default now(),
  instructor_slug text,
  instructor_name text,
  name            text not null,
  email           text not null,
  event_date      date,
  location        text,
  guest_count     int,
  message         text,
  status          text not null default 'new'
);

-- Row Level Security: allow the public site to INSERT, but never read others' data.
alter table public.instructor_applications enable row level security;
alter table public.inquiries enable row level security;

create policy "anon can submit applications"
  on public.instructor_applications for insert to anon with check (true);

create policy "anon can submit inquiries"
  on public.inquiries for insert to anon with check (true);
```

You'll read submissions from the Supabase Table Editor (or build an internal admin later).
No public SELECT policy is created, so visitors can submit but cannot read any rows.

## 3. Create the Storage bucket

1. Supabase dashboard → **Storage → New bucket**.
2. Name it exactly **`instructor-media`** and mark it **Public** (so profile photos can display).
3. Add an upload policy so the site can write files:

```sql
create policy "anon can upload instructor media"
  on storage.objects for insert to anon
  with check (bucket_id = 'instructor-media');
```

Headshots and teaching photos upload to `instructor-media/applications/<id>/...`
and the form stores their public URLs on the application row.

## 4. Rebuild and deploy

```bash
npm run build      # static export to ./out, with your env vars baked in
```

Then deploy `out/` to GitHub Pages (see README).

---

## Stripe — payment flow (designed, not yet live)

The instructor flow is intentionally **approve-then-pay** so you only collect money from
people you've accepted. The UI for this is already built on `/instructors/join/`
(Apply → Reviewed → Activate). To turn on real payments:

1. In Stripe, create a **Product** "Instructor membership" with two **Prices**:
   - Founding: $99 for year one (then $299/yr) — a subscription with a first-year coupon, or
     a one-time $99 + scheduled $299 renewal.
   - Standard: $299/yr subscription.
2. Create a **Payment Link** for each price (Stripe → Payment Links). No backend needed.
3. When you approve an application (status → `approved` in Supabase), email the instructor
   their Payment Link. On successful payment, set their status to `active` and publish the
   profile.
4. Optional automation later: a Stripe webhook (via a Supabase Edge Function) can flip the
   status to `active` automatically and move uploaded media into the live `instructors` data.

Because the public site is static, Payment Links are the simplest path — no server, no secret
keys in the frontend. If you later want self-serve in-page checkout, move hosting to Vercel
and add a serverless route with your Stripe secret key.
