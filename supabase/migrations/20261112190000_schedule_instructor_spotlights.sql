-- CJ authorized website-only spotlights the day after approval, starting 9am ET.
-- The receipt survives profile/content edits so a first publication is never repeated.
create table if not exists private.instructor_spotlight_publications (
  profile_id uuid primary key references public.instructor_profiles(id) on delete cascade,
  scheduled_at timestamptz not null,
  released_at timestamptz,
  revision uuid
);
alter table private.instructor_spotlight_publications enable row level security;
revoke all on private.instructor_spotlight_publications from public, anon, authenticated;

create or replace function private.publish_due_instructor_spotlights()
returns integer language plpgsql security definer set search_path = '' as $$
declare
  item record;
  changed integer := 0;
  new_revision uuid;
begin
  -- Serializes cron/manual retries, including the receipt and status transaction.
  perform pg_advisory_xact_lock(742519016);
  -- Allocate private time slots by joined time. This does not publish content.
  -- Publication below independently requires an existing non-declined article.
  insert into private.instructor_spotlight_publications(profile_id, scheduled_at)
  select id,
    (((approved_at at time zone 'America/New_York')::date + 1 + time '09:00')
      + (row_number() over (partition by (approved_at at time zone 'America/New_York')::date
         order by created_at, id) - 1) * interval '1 hour') at time zone 'America/New_York'
  from public.instructor_profiles
  where approved_at >= timestamptz '2026-11-11 00:00:00-05'
  on conflict (profile_id) do update set scheduled_at = excluded.scheduled_at
    where instructor_spotlight_publications.released_at is null;

  -- Adopt existing/manual releases without changing or republishing their content.
  update private.instructor_spotlight_publications q
  set released_at = s.released_at, revision = s.revision
  from public.instructor_spotlights s
  where q.profile_id = s.profile_id and q.released_at is null
    and s.status = 'released' and s.released_at is not null;

  for item in
    select q.profile_id from private.instructor_spotlight_publications q
    join public.instructor_profiles p on p.id = q.profile_id
    join public.instructor_spotlights consent on consent.profile_id = p.id
    where consent.status in ('draft','approved') and q.released_at is null and q.scheduled_at <= now() and p.status = 'published'
      and not exists (select 1 from private.instructor_spotlight_publications recent
        where recent.released_at > now() - interval '1 hour')
    order by q.scheduled_at, p.created_at, p.id
    for update of p, q, consent
  loop
    -- Never refresh or overwrite a privacy choice. The existing profile trigger
    -- maintains the public-content snapshot. Declined or missing articles are skipped.
    update public.instructor_spotlights s
      set status = 'released', released_at = now(), revision = gen_random_uuid()
      where s.profile_id = item.profile_id and s.status in ('draft','approved')
        and nullif(btrim(s.content->>'name'),'') is not null
        and nullif(btrim(s.content->>'city'),'') is not null
        and nullif(btrim(s.content->>'bio'),'') is not null
      returning revision into new_revision;
    if found then
      update private.instructor_spotlight_publications set released_at = now(), revision = new_revision
        where profile_id = item.profile_id;
      changed := changed + 1;
      exit; -- An outage/backlog must not publish several instructors at once.
    end if;
  end loop;
  return changed;
end;
$$;
revoke all on function private.publish_due_instructor_spotlights() from public, anon, authenticated;
select cron.schedule('publish-due-instructor-spotlights', '* * * * *',
  'select private.publish_due_instructor_spotlights()');
