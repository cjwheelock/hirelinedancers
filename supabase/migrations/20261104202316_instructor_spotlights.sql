alter table public.instructor_profiles add column favorite_dance text
  check (char_length(favorite_dance) <= 120);

create table public.instructor_spotlights (
  profile_id uuid primary key references public.instructor_profiles(id) on delete cascade,
  slug text not null unique,
  content jsonb not null,
  revision uuid not null default gen_random_uuid(),
  status text not null default 'draft' check (status in ('draft','approved','released','declined')),
  released_at timestamptz,
  check ((status = 'released') = (released_at is not null))
);
alter table public.instructor_spotlights enable row level security;
revoke all on public.instructor_spotlights from public, anon, authenticated;
grant select on public.instructor_spotlights to anon, authenticated;

create policy "Released spotlight articles" on public.instructor_spotlights
  for select to anon, authenticated using (status = 'released');
create policy "Spotlight reviewers" on public.instructor_spotlights
  for select to authenticated using (
    (select public.is_marketplace_admin()) or exists (
      select 1 from public.instructor_profiles p
      where p.id = profile_id and p.account_id = (select auth.uid())
    )
  );

-- Serialize profile, media and review changes on the same profile lock.
create function private.refresh_spotlight(p_id uuid, p_create boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare
  p public.instructor_profiles;
  snapshot jsonb;
  media_items jsonb;
  base_slug text;
begin
  select * into p from public.instructor_profiles where id = p_id for update;
  if not found then return; end if;
  if p.status not in ('pending_review','approved','published')
     or nullif(btrim(p.city),'') is null or nullif(btrim(p.display_name),'') is null then
    update public.instructor_spotlights
      set status = 'draft', released_at = null, revision = gen_random_uuid()
      where profile_id = p_id and status <> 'draft';
    return;
  end if;
  if not p_create and not exists (select 1 from public.instructor_spotlights where profile_id = p_id)
    then return; end if;

  select jsonb_object_agg(kind, item) into media_items from (
    select distinct on (kind) kind, jsonb_strip_nulls(jsonb_build_object(
      'path', storage_path, 'url', external_url, 'caption', caption, 'alt', alt_text,
      'provider', embed_provider, 'embedId', embed_id
    )) as item
    from (
      select m.*, case when m.media_type in ('image','headshot') then 'photo' else 'video' end as kind
      from public.profile_media m where instructor_profile_id = p_id and m.status = 'ready'
    ) candidates
    order by kind, (media_type in ('headshot','welcome_video')) desc, sort_order, id
  ) selected;
  snapshot := jsonb_strip_nulls(jsonb_build_object(
    'name', btrim(p.display_name), 'city', btrim(p.city), 'region', nullif(btrim(p.region),''),
    'bio', nullif(btrim(p.bio),''), 'years', p.years_teaching, 'headline', nullif(btrim(p.headline),''),
    'favoriteDance', nullif(btrim(p.favorite_dance),''), 'favoriteSong', nullif(btrim(p.favorite_song_name),''),
    'highlights', p.highlights, 'events', p.event_types, 'photo', media_items->'photo', 'video', media_items->'video'
  ));
  base_slug := trim(both '-' from regexp_replace(lower(left(p.display_name,60) || '-' || left(p.city,60)), '[^a-z0-9]+', '-', 'g'));
  insert into public.instructor_spotlights as s (profile_id,slug,content)
    values (p_id, concat_ws('-', 'spotlight', nullif(base_slug,''), p_id), snapshot)
    on conflict (profile_id) do update
    set content = excluded.content, revision = gen_random_uuid(), status = 'draft', released_at = null
    where s.content is distinct from excluded.content or (s.status = 'released' and p.status <> 'published');
end;
$$;
revoke all on function private.refresh_spotlight(uuid,boolean) from public, anon, authenticated;

create function private.spotlight_profile_changed()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and old.account_id is distinct from new.account_id then
    update public.instructor_spotlights set status = 'draft', released_at = null, revision = gen_random_uuid()
      where profile_id = new.id;
  end if;
  perform private.refresh_spotlight(new.id, tg_op = 'INSERT' or old.status is distinct from new.status);
  return null;
end;
$$;
create trigger spotlight_profile_changed after insert or update of status, account_id, display_name, city, region,
  favorite_dance, favorite_song_name, bio, years_teaching, headline, highlights, event_types
  on public.instructor_profiles for each row execute function private.spotlight_profile_changed();
revoke all on function private.spotlight_profile_changed() from public, anon, authenticated;

create function private.spotlight_media_changed()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' or (tg_op = 'UPDATE' and old.instructor_profile_id <> new.instructor_profile_id) then
    perform private.refresh_spotlight(old.instructor_profile_id,false);
  end if;
  if tg_op <> 'DELETE' then perform private.refresh_spotlight(new.instructor_profile_id,false); end if;
  return null;
end;
$$;
create trigger spotlight_media_changed after insert or update or delete on public.profile_media
  for each row execute function private.spotlight_media_changed();
revoke all on function private.spotlight_media_changed() from public, anon, authenticated;

create function private.review_spotlight(p_id uuid, p_revision uuid, p_action text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  p public.instructor_profiles;
  s public.instructor_spotlights;
  next_state text;
begin
  select * into p from public.instructor_profiles where id = p_id for update;
  if auth.uid() is null or p.id is null or not (p.account_id = auth.uid() or public.is_marketplace_admin()) then
    raise exception 'Spotlight review is unavailable.';
  end if;
  select * into s from public.instructor_spotlights where profile_id = p_id;
  if s.revision is distinct from p_revision or s.profile_id is null then
    raise exception 'The spotlight changed. Review the current version.';
  end if;
  if p_action = 'approve' and p.account_id = auth.uid() and p.status in ('pending_review','approved','published')
     and nullif(btrim(p.city),'') is not null and nullif(btrim(p.display_name),'') is not null
     and s.status in ('draft','declined','approved') then next_state := 'approved';
  elsif p_action = 'decline' and p.account_id = auth.uid() then next_state := 'declined';
  elsif p_action = 'release' and public.is_marketplace_admin() and p.status = 'published'
     and s.status in ('approved','released') then next_state := 'released';
  else raise exception 'This spotlight is not ready for that action.';
  end if;
  if s.status <> next_state then
    update public.instructor_spotlights set status = next_state, revision = gen_random_uuid(),
      released_at = case when next_state = 'released' then now() end
      where profile_id = p_id;
  end if;
end;
$$;
revoke all on function private.review_spotlight(uuid,uuid,text) from public, anon, authenticated;
grant execute on function private.review_spotlight(uuid,uuid,text) to authenticated;
create function public.review_instructor_spotlight(p_id uuid, p_revision uuid, p_action text)
returns void language sql security invoker set search_path = '' as $$
  select private.review_spotlight(p_id,p_revision,p_action);
$$;
revoke all on function public.review_instructor_spotlight(uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.review_instructor_spotlight(uuid,uuid,text) to authenticated;
