\set ON_ERROR_STOP on

begin;

create or replace function pg_temp.check(p_condition boolean, p_message text)
returns void language plpgsql as $$
begin
  if coalesce(p_condition, false) is not true then
    raise exception 'Profile upgrade assertion failed: %', p_message;
  end if;
end;
$$;

create or replace function pg_temp.expect_error(p_statement text, p_fragment text, p_label text)
returns void language plpgsql as $$
begin
  begin
    execute p_statement;
  exception when others then
    if position(p_fragment in sqlerrm) = 0 then
      raise exception 'Expected error for %, got: %', p_label, sqlerrm;
    end if;
    return;
  end;
  raise exception 'Expected an error for %, but the statement succeeded', p_label;
end;
$$;

create or replace function pg_temp.as_user(p_account_id uuid, p_email text)
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', p_account_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', p_account_id, 'email', p_email, 'role', 'authenticated')::text, true);
end;
$$;

set local hire_line_dancers.commission_access = 'off';

insert into auth.users (id, email, raw_user_meta_data) values
  ('50000000-0000-0000-0000-000000000020', 'profile-instructor@example.test', '{"full_name":"Pat Teacher"}'),
  ('50000000-0000-0000-0000-000000000030', 'profile-outsider@example.test', '{"full_name":"Out Sider"}');

update public.accounts set role = 'instructor', onboarding_completed_at = now()
where id = '50000000-0000-0000-0000-000000000020';

insert into public.instructor_profiles (id, account_id, slug, status, display_name, city, region, event_types, published_at)
values ('60000000-0000-0000-0000-000000000020', '50000000-0000-0000-0000-000000000020',
  'pat-teacher-austin-tx', 'published', 'Pat Teacher', 'Austin', 'TX', array['weddings'], now());

insert into public.instructor_private_settings (instructor_profile_id, inquiry_email)
values ('60000000-0000-0000-0000-000000000020', 'profile-instructor@example.test');

-- Link parsing
select pg_temp.check((select provider = 'youtube' and video_id = 'dQw4w9WgXcQ'
  from private.parse_video_link('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10')), 'youtube watch link');
select pg_temp.check((select video_id = 'dQw4w9WgXcQ' from private.parse_video_link('https://youtu.be/dQw4w9WgXcQ')), 'youtu.be link');
select pg_temp.check((select video_id = 'abcdefghijk' from private.parse_video_link('https://youtube.com/shorts/abcdefghijk')), 'shorts link');
select pg_temp.check((select provider = 'instagram' and video_id = 'C1a2B3c4D5e'
  from private.parse_video_link('https://www.instagram.com/reel/C1a2B3c4D5e/?igsh=xyz')), 'instagram reel');
select pg_temp.check((select provider = 'tiktok' and video_id = '7301234567890123456'
  from private.parse_video_link('https://www.tiktok.com/@line.dance.pat/video/7301234567890123456?lang=en')), 'tiktok video');
select pg_temp.check(not exists (select 1 from private.parse_video_link('https://evil.example/watch?v=dQw4w9WgXcQ')), 'other host rejected');
select pg_temp.check(not exists (select 1 from private.parse_video_link('http://youtu.be/dQw4w9WgXcQ')), 'http rejected');

set local role authenticated;
select pg_temp.as_user('50000000-0000-0000-0000-000000000020', 'profile-instructor@example.test');

insert into public.profile_media (instructor_profile_id, media_type, external_url, status, caption, sort_order)
values ('60000000-0000-0000-0000-000000000020', 'video',
  'https://www.tiktok.com/@line.dance.pat/video/7301234567890123456', 'ready', 'Wedding in Austin', 0);

select pg_temp.check((select embed_provider = 'tiktok' and embed_id = '7301234567890123456'
  from public.profile_media where instructor_profile_id = '60000000-0000-0000-0000-000000000020'), 'embed stored');

select pg_temp.expect_error($sql$
  insert into public.profile_media (instructor_profile_id, media_type, external_url, status)
  values ('60000000-0000-0000-0000-000000000020', 'video', 'https://vm.tiktok.com/ZMabc123/', 'ready')
$sql$, 'copy the full link', 'tiktok short link');

select pg_temp.expect_error($sql$
  insert into public.profile_media (instructor_profile_id, media_type, external_url, status)
  values ('60000000-0000-0000-0000-000000000020', 'image', 'http://example.com/a.jpg', 'ready')
$sql$, 'must use https', 'insecure photo link');

select pg_temp.expect_error($sql$
  insert into public.profile_media (instructor_profile_id, media_type, external_url, status)
  values ('60000000-0000-0000-0000-000000000020', 'video', 'https://example.com/video.mp4', 'ready')
$sql$, 'public YouTube, Instagram, or TikTok', 'unsupported link');

insert into public.profile_media (instructor_profile_id, media_type, external_url, status)
values ('60000000-0000-0000-0000-000000000020', 'welcome_video', 'https://youtu.be/dQw4w9WgXcQ', 'ready');
select pg_temp.expect_error($sql$
  insert into public.profile_media (instructor_profile_id, media_type, external_url, status)
  values ('60000000-0000-0000-0000-000000000020', 'welcome_video', 'https://youtu.be/abcdefghijk', 'ready')
$sql$, 'one welcome video', 'second welcome video');

-- Highlights and packages
update public.instructor_profiles
set headline = 'High-energy line dancing for weddings and company parties',
    years_teaching = 6,
    max_group_size = 200,
    age_groups = array['adults', 'seniors'],
    languages = array['English', 'Spanish'],
    highlights = '[{"title":"Wedding reception, Austin","detail":"150 guests, three dances"}]',
    packages = '[{"name":"Party starter","description":"One hour, three easy dances","durationHours":1,"priceCents":30000},{"name":"Custom","durationHours":2,"priceCents":null}]'
where id = '60000000-0000-0000-0000-000000000020';

select pg_temp.expect_error($sql$
  update public.instructor_profiles set packages = '[{"name":"Cheap","priceCents":5}]'
  where id = '60000000-0000-0000-0000-000000000020'
$sql$, 'instructor_profiles_packages_check', 'package price too low');

select pg_temp.expect_error($sql$
  update public.instructor_profiles set highlights = '[{"title":"x","extra":"no"}]'
  where id = '60000000-0000-0000-0000-000000000020'
$sql$, 'instructor_profiles_highlights_check', 'unknown highlight key');

-- Social links
update public.instructor_private_settings
set instagram_url = 'https://www.instagram.com/line.dance.pat/',
    tiktok_url = 'https://www.tiktok.com/@line.dance.pat',
    website_url = 'https://patdances.com'
where instructor_profile_id = '60000000-0000-0000-0000-000000000020';

select pg_temp.expect_error($sql$
  update public.instructor_private_settings set instagram_url = 'https://evil.example/pat'
  where instructor_profile_id = '60000000-0000-0000-0000-000000000020'
$sql$, 'social_links_check', 'bad instagram link');

-- Anyone can read published extras
reset role;
set local role anon;
select pg_temp.check((select jsonb_array_length(packages) = 2 from public.instructor_directory_profile_extras
  where id = '60000000-0000-0000-0000-000000000020'), 'packages are public');
select pg_temp.check((select count(*) = 2 from public.profile_media
  where instructor_profile_id = '60000000-0000-0000-0000-000000000020'), 'embeds are public');

-- Links stay private without a paid booking in a shared conversation
reset role;
set local role authenticated;
select pg_temp.as_user('50000000-0000-0000-0000-000000000030', 'profile-outsider@example.test');
select pg_temp.check(public.get_thread_instructor_links(gen_random_uuid()) is null, 'links hidden from outsiders');

rollback;
\echo 'instructor_profile_upgrade.sql passed'
