-- Instructor profile upgrade:
--   * Instagram, TikTok, and YouTube video links shown as embeds
--   * captions and ordering for photos and videos, higher gallery limits
--   * past-event highlights and service packages on the public profile
--   * private social links, revealed to the client only after a paid booking

-- 1. Embedded video links -------------------------------------------------

alter table public.profile_media
  add column if not exists embed_provider text,
  add column if not exists embed_id text;

alter table public.profile_media
  drop constraint if exists profile_media_embed_provider_check;
alter table public.profile_media
  add constraint profile_media_embed_provider_check
  check (embed_provider is null or embed_provider in ('youtube', 'instagram', 'tiktok'));

alter table public.profile_media
  drop constraint if exists profile_media_caption_length_check;
alter table public.profile_media
  add constraint profile_media_caption_length_check
  check (caption is null or char_length(caption) <= 140);

-- Parses a pasted video link into a provider and an id. Returns null for
-- anything that is not a supported public video link.
create or replace function private.parse_video_link(p_url text)
returns table (provider text, video_id text)
language plpgsql
immutable
set search_path = ''
as $$
declare
  url text := btrim(coalesce(p_url, ''));
  match text[];
begin
  if url !~* '^https://' or char_length(url) > 500 then
    return;
  end if;

  match := regexp_match(url, '^https://(?:www\.|m\.)?youtube\.com/(?:watch\?(?:.*&)?v=|shorts/|embed/|live/)([A-Za-z0-9_-]{11})', 'i');
  if match is null then
    match := regexp_match(url, '^https://youtu\.be/([A-Za-z0-9_-]{11})', 'i');
  end if;
  if match is not null then
    provider := 'youtube'; video_id := match[1]; return next; return;
  end if;

  match := regexp_match(url, '^https://(?:www\.)?instagram\.com/(?:[A-Za-z0-9_.]+/)?(?:p|reel|reels|tv)/([A-Za-z0-9_-]{5,40})', 'i');
  if match is not null then
    provider := 'instagram'; video_id := match[1]; return next; return;
  end if;

  match := regexp_match(url, '^https://(?:www\.|m\.)?tiktok\.com/@[A-Za-z0-9_.-]+/video/([0-9]{8,25})', 'i');
  if match is null then
    match := regexp_match(url, '^https://(?:www\.)?tiktok\.com/embed/(?:v2/)?([0-9]{8,25})', 'i');
  end if;
  if match is not null then
    provider := 'tiktok'; video_id := match[1]; return next; return;
  end if;
end;
$$;

revoke all on function private.parse_video_link(text) from public, anon, authenticated;
grant execute on function private.parse_video_link(text) to anon, authenticated, service_role;

create or replace function public.normalize_profile_media_link()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  parsed record;
begin
  if new.external_url is null then
    new.embed_provider := null;
    new.embed_id := null;
    return new;
  end if;

  -- Hosted photo links (used by seeded and legacy profiles) stay as plain URLs.
  if new.media_type in ('headshot', 'image') then
    if new.external_url !~* '^https://' then
      raise exception 'Photo links must use https.';
    end if;
    new.embed_provider := null;
    new.embed_id := null;
    return new;
  end if;

  select * into parsed from private.parse_video_link(new.external_url);
  if parsed.provider is null then
    if new.external_url ~* '^https://(vm|vt)\.tiktok\.com/' then
      raise exception 'Open the TikTok video in a browser and copy the full link that includes /video/.';
    end if;
    raise exception 'Paste a link to a public YouTube, Instagram, or TikTok video.';
  end if;

  new.external_url := btrim(new.external_url);
  new.embed_provider := parsed.provider;
  new.embed_id := parsed.video_id;
  new.mime_type := null;
  return new;
end;
$$;

drop trigger if exists normalize_profile_media_link on public.profile_media;
create trigger normalize_profile_media_link
  before insert or update of external_url, media_type on public.profile_media
  for each row execute function public.normalize_profile_media_link();

-- Higher gallery limits: one headshot, one welcome video, eight photos, and
-- six more videos (uploads and links together).
create or replace function public.enforce_profile_media_limits()
returns trigger
language plpgsql
as $$
declare
  existing_count integer;
begin
  if new.status = 'rejected' then
    return new;
  end if;

  select count(*) into existing_count
  from public.profile_media
  where instructor_profile_id = new.instructor_profile_id
    and media_type = new.media_type
    and status <> 'rejected'
    and id <> new.id;

  if new.media_type = 'image' and existing_count >= 8 then
    raise exception 'A profile can have at most eight gallery photos';
  end if;
  if new.media_type = 'video' and existing_count >= 6 then
    raise exception 'A profile can have at most six gallery videos';
  end if;
  if new.media_type = 'welcome_video' and existing_count >= 1 then
    raise exception 'A profile can have one welcome video. Remove the current one first.';
  end if;
  if new.media_type = 'headshot' and existing_count >= 1 then
    raise exception 'A profile can have one headshot. Remove the current one first.';
  end if;
  return new;
end;
$$;

-- 2. Highlights and packages ------------------------------------------------

alter table public.instructor_profiles
  add column if not exists highlights jsonb not null default '[]'::jsonb,
  add column if not exists packages jsonb not null default '[]'::jsonb;

create or replace function private.valid_profile_highlights(p_value jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select jsonb_typeof(p_value) = 'array'
    and jsonb_array_length(p_value) <= 6
    and not exists (
      select 1 from jsonb_array_elements(p_value) item
      where jsonb_typeof(item) <> 'object'
        or (select count(*) from jsonb_object_keys(item) key where key not in ('title', 'detail')) > 0
        or jsonb_typeof(item -> 'title') is distinct from 'string'
        or char_length(btrim(item ->> 'title')) not between 1 and 80
        or (item ? 'detail' and (jsonb_typeof(item -> 'detail') <> 'string' or char_length(item ->> 'detail') > 160))
    )
$$;

create or replace function private.valid_profile_packages(p_value jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select jsonb_typeof(p_value) = 'array'
    and jsonb_array_length(p_value) <= 4
    and not exists (
      select 1 from jsonb_array_elements(p_value) item
      where jsonb_typeof(item) <> 'object'
        or (select count(*) from jsonb_object_keys(item) key
            where key not in ('name', 'description', 'durationHours', 'priceCents')) > 0
        or jsonb_typeof(item -> 'name') is distinct from 'string'
        or char_length(btrim(item ->> 'name')) not between 1 and 60
        or (item ? 'description' and (jsonb_typeof(item -> 'description') <> 'string' or char_length(item ->> 'description') > 300))
        or (item ? 'durationHours' and (jsonb_typeof(item -> 'durationHours') <> 'number'
            or (item ->> 'durationHours')::numeric not between 0.5 and 24))
        or (item ? 'priceCents' and jsonb_typeof(item -> 'priceCents') <> 'null' and (
            jsonb_typeof(item -> 'priceCents') <> 'number'
            or (item ->> 'priceCents')::numeric <> trunc((item ->> 'priceCents')::numeric)
            or (item ->> 'priceCents')::numeric not between 1000 and 1000000))
    )
$$;

alter table public.instructor_profiles
  drop constraint if exists instructor_profiles_highlights_check;
alter table public.instructor_profiles
  add constraint instructor_profiles_highlights_check
  check (private.valid_profile_highlights(highlights));

alter table public.instructor_profiles
  drop constraint if exists instructor_profiles_packages_check;
alter table public.instructor_profiles
  add constraint instructor_profiles_packages_check
  check (private.valid_profile_packages(packages));

alter table public.instructor_profiles
  drop constraint if exists instructor_profiles_headline_length_check;
alter table public.instructor_profiles
  add constraint instructor_profiles_headline_length_check
  check (headline is null or char_length(headline) <= 120) not valid;

-- Published highlights and packages, read alongside instructor_directory_profiles.
create or replace function private.published_instructor_profile_extras()
returns table (id uuid, highlights jsonb, packages jsonb)
language sql
stable
security definer
set search_path = ''
as $$
  select profile.id, profile.highlights, profile.packages
  from public.instructor_profiles profile
  where profile.status = 'published';
$$;

revoke all on function private.published_instructor_profile_extras() from public, anon, authenticated, service_role;
grant execute on function private.published_instructor_profile_extras() to anon, authenticated, service_role;

do $$
begin
  if current_setting('server_version_num')::integer >= 150000 then
    execute $view$
      create or replace view public.instructor_directory_profile_extras
      with (security_barrier = true, security_invoker = true)
      as select * from private.published_instructor_profile_extras()
    $view$;
  else
    execute $view$
      create or replace view public.instructor_directory_profile_extras
      with (security_barrier = true)
      as select * from private.published_instructor_profile_extras()
    $view$;
  end if;
end;
$$;

revoke all on public.instructor_directory_profile_extras from public, anon, authenticated;
grant select on public.instructor_directory_profile_extras to anon, authenticated;

-- 3. Private social links ---------------------------------------------------

alter table public.instructor_private_settings
  add column if not exists instagram_url text,
  add column if not exists tiktok_url text,
  add column if not exists youtube_url text,
  add column if not exists website_url text;

alter table public.instructor_private_settings
  drop constraint if exists instructor_private_settings_social_links_check;
alter table public.instructor_private_settings
  add constraint instructor_private_settings_social_links_check
  check (
    (instagram_url is null or instagram_url ~* '^https://(www\.)?instagram\.com/[A-Za-z0-9_.]+/?$')
    and (tiktok_url is null or tiktok_url ~* '^https://(www\.)?tiktok\.com/@[A-Za-z0-9_.-]+/?$')
    and (youtube_url is null or youtube_url ~* '^https://(www\.|m\.)?youtube\.com/(@[A-Za-z0-9_.-]+|channel/[A-Za-z0-9_-]+|c/[A-Za-z0-9_.-]+)/?$')
    and (website_url is null or (website_url ~* '^https://[^\s/]+\.[^\s]+$' and char_length(website_url) <= 300))
  );

-- Social links are shared only with people in a conversation that has a paid
-- booking, the same moment contact details stop being hidden.
create or replace function public.get_thread_instructor_links(p_thread_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  settings public.instructor_private_settings;
begin
  if not private.is_inquiry_thread_participant(p_thread_id)
    or not private.thread_has_paid_booking(p_thread_id) then
    return null;
  end if;

  select s.* into settings
  from public.inquiry_threads thread
  join public.instructor_private_settings s on s.instructor_profile_id = thread.instructor_profile_id
  where thread.id = p_thread_id;

  if settings.instructor_profile_id is null then
    return null;
  end if;

  return jsonb_strip_nulls(jsonb_build_object(
    'instagram', settings.instagram_url,
    'tiktok', settings.tiktok_url,
    'youtube', settings.youtube_url,
    'website', settings.website_url
  ));
end;
$$;

revoke all on function public.get_thread_instructor_links(uuid) from public, anon;
grant execute on function public.get_thread_instructor_links(uuid) to authenticated;
