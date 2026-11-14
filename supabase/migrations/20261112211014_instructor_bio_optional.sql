-- About you is optional. Preserve every other readiness requirement and existing function permissions.
create or replace function public.instructor_profile_is_payment_ready(
  p_instructor_profile_id uuid
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
    where profile.id = p_instructor_profile_id
      and nullif(trim(profile.display_name), '') is not null
      and nullif(trim(profile.city), '') is not null
      and nullif(trim(profile.region), '') is not null
      and coalesce(cardinality(profile.event_types), 0) > 0
      and settings.inquiry_email ~
        '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
      and exists (
        select 1
        from public.profile_media media
        where media.instructor_profile_id = profile.id
          and media.media_type = 'headshot'
          and media.status = 'ready'
      )
  );
$$;

create or replace function public.enforce_invitation_offer_submission_completeness()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status <> 'pending_review' or old.status = 'pending_review' then
    return new;
  end if;

  if not exists (
    select 1
    from public.instructor_invitations invitation
    where invitation.accepted_profile_id = new.id
      and invitation.status = 'accepted'
      and invitation.offer_code = 'outreach_two_months_90_day_v1'
  ) then
    return new;
  end if;

  if nullif(trim(new.display_name), '') is null
    or nullif(trim(new.city), '') is null
    or nullif(trim(new.region), '') is null
    or coalesce(cardinality(new.event_types), 0) = 0 then
    raise exception 'Complete your public name, location, and at least one event type before submitting for review';
  end if;

  if not exists (
    select 1
    from public.instructor_private_settings settings
    where settings.instructor_profile_id = new.id
      and settings.inquiry_email ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
  ) then
    raise exception 'A valid inquiry email is required before submitting for review';
  end if;

  if not exists (
    select 1
    from public.profile_media media
    where media.instructor_profile_id = new.id
      and media.media_type = 'headshot'
      and media.status = 'ready'
  ) then
    raise exception 'Upload a ready main headshot before submitting for review';
  end if;

  return new;
end;
$$;
