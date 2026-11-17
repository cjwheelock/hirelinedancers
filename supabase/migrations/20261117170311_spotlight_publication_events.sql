-- Immutable metadata about changes to articles that are already public.
-- No draft content, profile contact data, credentials, or future schedules are exposed.
create table public.spotlight_publication_events (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null,
  revision uuid not null,
  action text not null check (action in ('release','withdraw')),
  due_at timestamptz,
  occurred_at timestamptz not null default now(),
  reason text not null default 'article-change' check (reason in ('article-change','delivery-test')),
  check (action <> 'release' or due_at is not null)
);
alter table public.spotlight_publication_events enable row level security;
revoke all on public.spotlight_publication_events from public, anon, authenticated;
grant select on public.spotlight_publication_events to anon, authenticated;
create policy "Public article publication events" on public.spotlight_publication_events
  for select to anon, authenticated using (true);

create function private.emit_spotlight_publication_event()
returns trigger language plpgsql security definer set search_path = '' as $$
declare due timestamptz;
begin
  if tg_op <> 'DELETE' and new.status = 'released' and new.released_at is not null then
    if tg_op = 'UPDATE' and old.status = 'released' and old.revision = new.revision then
      return null;
    end if;
    -- The scheduled release writes the article before its private receipt, in one transaction.
    select q.scheduled_at into due from private.instructor_spotlight_publications q
      where q.profile_id = new.profile_id and q.released_at is null
        and q.scheduled_at <= new.released_at;
    insert into public.spotlight_publication_events(profile_id,revision,action,due_at)
      values(new.profile_id,new.revision,'release',coalesce(due,new.released_at));
  elsif tg_op <> 'INSERT' and old.status = 'released' then
    insert into public.spotlight_publication_events(profile_id,revision,action)
      values(old.profile_id,old.revision,'withdraw');
  end if;
  return null;
end;
$$;
revoke all on function private.emit_spotlight_publication_event() from public, anon, authenticated;
create trigger spotlight_publication_event
after insert or update or delete on public.instructor_spotlights
for each row execute function private.emit_spotlight_publication_event();

-- Preserve all existing Realtime tables and publication schedules.
alter publication supabase_realtime add table public.spotlight_publication_events;
