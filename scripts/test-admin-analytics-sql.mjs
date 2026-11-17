import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import assert from 'node:assert/strict';

const db = new PGlite();
await db.exec(`
create schema private; create schema auth;
create role anon; create role authenticated; create role service_role;
create table public.accounts(id uuid primary key, role text);
create table public.instructor_profiles(id uuid primary key default gen_random_uuid(), created_at timestamptz not null default now(), published_at timestamptz);
create table public.inquiries(id uuid primary key default gen_random_uuid(), created_at timestamptz not null default now());
create table public.matching_requests(id uuid primary key default gen_random_uuid(), created_at timestamptz not null default now());
create table public.outreach_sends(id bigint generated always as identity primary key, kind text, status text, created_at timestamptz default now(), sent_at timestamptz);
create table public.outreach_form_submissions(id bigint generated always as identity primary key, status text, created_at timestamptz default now());
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
create function public.is_marketplace_admin() returns boolean language sql stable as $$
  select exists (select 1 from public.accounts where id = auth.uid() and role = 'admin') $$;
insert into public.accounts values ('00000000-0000-0000-0000-000000000001', 'admin'), ('00000000-0000-0000-0000-000000000002', 'instructor');
`);
for (const file of ['20261116210000_site_visits.sql', '20261116210500_outreach_manual_activity.sql', '20261116211000_admin_analytics.sql']) {
  await db.exec(fs.readFileSync(`supabase/migrations/${file}`, 'utf8'));
}
const one = async (sql, params) => (await db.query(sql, params)).rows[0];
const all = async (sql, params) => (await db.query(sql, params)).rows;
const asUser = (id) => db.exec(`select set_config('test.uid', '${id}', false)`);
const visitor = '11111111-2222-4333-8444-555555555555';

// Tracking: validation, normalisation, exclusions.
await db.query('select track_site_visit($1,$2,$3,$4,$5,$6)', ['/cities/nashville/?utm_source=x#top', 'https://www.Instagram.com/p/abc', ' IG ', 'social', 'launch', visitor]);
await db.query("select track_site_visit('/admin/')");
await db.query("select track_site_visit('/admin')");
await db.query("select track_site_visit('no-slash')");
await db.query("select track_site_visit('/bad path<script>')");
await db.query('select track_site_visit($1)', ['/' + 'a'.repeat(400)]);
await db.query("select track_site_visit('/', 'https://hirelinedancers.com/about/', null, null, null, 'not-a-uuid')");
let rows = await all('select path, referrer_host, utm_source, utm_medium, utm_campaign, visitor_id from site_visits order by id');
assert.equal(rows.length, 2, 'only valid public paths are stored');
assert.deepEqual(rows[0], { path: '/cities/nashville/', referrer_host: 'instagram.com', utm_source: 'ig', utm_medium: 'social', utm_campaign: 'launch', visitor_id: visitor });
assert.deepEqual(rows[1], { path: '/', referrer_host: null, utm_source: null, utm_medium: null, utm_campaign: null, visitor_id: null });

// Per-browser cap.
for (let i = 0; i < 70; i += 1) await db.query('select track_site_visit($1,null,null,null,null,$2)', ['/find-an-instructor/', visitor]);
assert.equal((await one('select count(*)::int n from site_visits where visitor_id = $1', [visitor])).n, 60, 'per-browser hourly cap');
// Site-wide cap.
await db.exec("insert into site_visits(path) select '/' from generate_series(1, 300)");
await db.query("select track_site_visit('/about/')");
assert.equal((await one("select count(*)::int n from site_visits where path = '/about/'")).n, 0, 'site-wide minute cap');
await db.exec('truncate site_visits');

// Admin gating.
await asUser('00000000-0000-0000-0000-000000000002');
for (const sql of ['select * from admin_analytics_daily()', 'select * from admin_analytics_visit_summary()', 'select * from admin_analytics_top_referrers()', 'select * from admin_analytics_top_pages()', "select admin_log_manual_outreach(current_date - 1, 'instagram_dm', 1)"]) {
  await assert.rejects(db.query(sql), /Administrator access required/, sql);
}
await asUser('00000000-0000-0000-0000-000000000001');

// Manual outreach upsert.
const today = (await one("select (now() at time zone 'America/New_York')::date::text d")).d;
const log = (day, channel, count, mode = 'set', note = null) => one('select * from admin_log_manual_outreach($1::date,$2,$3,$4,$5)', [day, channel, count, mode, note]);
assert.equal((await log(today, 'instagram_dm', 1, 'add')).count, 1);
assert.equal((await log(today, 'instagram_dm', 5, 'add')).count, 6);
assert.equal((await log(today, 'instagram_dm', -10, 'add')).count, 0, 'never below zero');
let row = await log(today, 'instagram_dm', 12, 'set', 'Nashville planners');
assert.equal(row.count, 12); assert.equal(row.note, 'Nashville planners');
assert.equal((await log(today, 'instagram_dm', 1, 'add')).note, 'Nashville planners', 'add keeps the note');
assert.equal((await log(today, 'instagram_dm', 13, 'set', '')).note, null, 'empty note clears');
await assert.rejects(log(today, 'sms', 1), /Unknown channel/);
await assert.rejects(log(today, 'other', -1), /Count is out of range/);
await assert.rejects(one("select admin_log_manual_outreach(((now() at time zone 'America/New_York')::date + 1), 'other', 1)"), /Day is out of range/);
await log(today, 'email_manual', 4); await log(today, 'other', 2);

// Daily aggregation in Eastern Time, with zero days.
await db.exec(`
insert into site_visits(path, visitor_id, referrer_host, created_at, visit_day) values
  ('/', '${visitor}', 'google.com', now(), '${today}'), ('/', '${visitor}', 'google.com', now(), '${today}'),
  ('/about/', gen_random_uuid(), null, now(), '${today}'), ('/', null, null, now(), '${today}'::date - 2);
-- 03:30 UTC is 22:30 or 23:30 the previous day in New York.
insert into outreach_sends(kind, status, sent_at) values
  ('first_touch', 'sent', ('${today}'::date::timestamp + interval '3 hours 30 minutes') at time zone 'UTC'),
  ('first_touch', 'sent', ('${today}'::date::timestamp + interval '12 hours') at time zone 'America/New_York'),
  ('test', 'sent', now()), ('first_touch', 'failed', now()), ('follow_up', 'processing', null);
insert into outreach_form_submissions(status, created_at) values ('submitted', now()), ('skipped', now());
insert into instructor_profiles(created_at, published_at) values (now() - interval '3 days', now()), (now(), null);
insert into inquiries(created_at) values (now()), (now() - interval '3 days');
insert into matching_requests(created_at) values (now());
`);
rows = await all("select * from admin_analytics_daily($1::date - 6, $1::date)", [today]);
assert.equal(rows.length, 7, 'every day in range is present');
const iso = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d));
const last = rows.at(-1), prev = rows.at(-2);
assert.equal(iso((await one("select $1::date::text d", [today])).d), today);
assert.deepEqual(
  { visits: last.visits, unique_visitors: last.unique_visitors, emails_sent: last.emails_sent, form_submissions: last.form_submissions, dms_sent: last.dms_sent, manual_emails: last.manual_emails, other_outreach: last.other_outreach, instructors_joined: last.instructors_joined, instructors_published: last.instructors_published, inquiries: last.inquiries, matching_requests: last.matching_requests },
  { visits: 3, unique_visitors: 2, emails_sent: 1, form_submissions: 1, dms_sent: 13, manual_emails: 4, other_outreach: 2, instructors_joined: 1, instructors_published: 1, inquiries: 1, matching_requests: 1 }
);
assert.equal(prev.emails_sent, 1, 'late-evening Eastern send lands on the previous Eastern day');
assert.equal(rows[2].visits + rows[2].emails_sent + rows[2].inquiries, 0, 'zero day present');
assert.equal(rows.at(-4).inquiries, 1);
assert.equal(rows.at(-3).visits, 1);
const allRows = await all('select * from admin_analytics_daily()');
assert.equal(allRows.length, 4, 'open start begins at first activity day');
assert.equal((await all("select * from admin_analytics_daily(null, $1::date + 30)", [today])).length, 4, 'end is clamped to today');

const summary = await one('select * from admin_analytics_visit_summary($1::date, $1::date)', [today]);
assert.equal(Number(summary.visits), 3); assert.equal(Number(summary.unique_visitors), 2);
const refs = await all('select * from admin_analytics_top_referrers()');
assert.deepEqual(refs.map((r) => [r.referrer_host, Number(r.visits)]), [['', 2], ['google.com', 2]]);
const pages = await all('select * from admin_analytics_top_pages(null, null, 1)');
assert.deepEqual(pages.map((r) => [r.path, Number(r.visits)]), [['/', 3]]);

await db.close();
console.log('Admin analytics SQL checks passed: visit validation and caps, admin gating, manual outreach upsert, Eastern Time daily buckets with zero days, visit summary, top referrers and pages.');
