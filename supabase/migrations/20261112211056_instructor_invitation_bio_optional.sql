-- Keep invitation completion consistent with optional About you.
create or replace function public.instructor_invitation_profile_is_complete(
  p_profile_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.instructor_profiles profile
    join public.instructor_private_settings settings
      on settings.instructor_profile_id = profile.id
    where profile.id = p_profile_id
      and nullif(trim(profile.display_name), '') is not null
      and nullif(trim(profile.city), '') is not null
      and nullif(trim(profile.region), '') is not null
      and coalesce(cardinality(profile.event_types), 0) > 0
      and settings.inquiry_email ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
      and exists (
        select 1
        from public.profile_media media
        where media.instructor_profile_id = profile.id
          and media.media_type = 'headshot'
          and media.status = 'ready'
      )
  );
$$;
