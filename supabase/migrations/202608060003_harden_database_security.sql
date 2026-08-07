-- Harden public API views, function search paths, and function execution grants.
-- Apply after 202608060002_allow_approved_instructor_self_service_edits.sql.

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to anon, authenticated, service_role;

create or replace function private.published_instructor_directory_profiles()
returns table (
  id uuid,
  slug text,
  status text,
  display_name text,
  business_name text,
  headline text,
  bio text,
  city text,
  region text,
  country_code text,
  travel_radius_miles integer,
  years_teaching integer,
  max_group_size integer,
  styles text[],
  event_types text[],
  age_groups text[],
  languages text[],
  favorite_song_name text,
  favorite_song_spotify_url text,
  provides_speakers boolean,
  provides_microphone boolean,
  provides_music_playback boolean,
  liability_insurance_status text,
  preferred_response_hours integer,
  published_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    profile.id,
    profile.slug,
    profile.status,
    profile.display_name,
    profile.business_name,
    profile.headline,
    profile.bio,
    profile.city,
    profile.region,
    profile.country_code,
    profile.travel_radius_miles,
    profile.years_teaching,
    profile.max_group_size,
    profile.styles,
    profile.event_types,
    profile.age_groups,
    profile.languages,
    profile.favorite_song_name,
    profile.favorite_song_spotify_url,
    profile.provides_speakers,
    profile.provides_microphone,
    profile.provides_music_playback,
    profile.liability_insurance_status,
    profile.preferred_response_hours,
    profile.published_at,
    profile.created_at,
    profile.updated_at
  from public.instructor_profiles profile
  where profile.status = 'published';
$$;

revoke all on function private.published_instructor_directory_profiles()
  from public, anon, authenticated, service_role;
grant execute on function private.published_instructor_directory_profiles()
  to anon, authenticated, service_role;

-- PostgreSQL 15 and newer support security-invoker views. Supabase production
-- runs a newer version. The fallback keeps isolated PostgreSQL 14 tests usable.
do $$
begin
  if current_setting('server_version_num')::integer >= 150000 then
    execute $view$
      create or replace view public.instructor_directory_profiles
      with (security_barrier = true, security_invoker = true)
      as
      select * from private.published_instructor_directory_profiles()
    $view$;
  else
    execute $view$
      create or replace view public.instructor_directory_profiles
      with (security_barrier = true)
      as
      select * from private.published_instructor_directory_profiles()
    $view$;
  end if;
end;
$$;

revoke all on public.instructor_directory_profiles from public, anon, authenticated;
grant select on public.instructor_directory_profiles to anon, authenticated;

-- Anonymous users only need published media and active static targets. Admin
-- checks belong in separate authenticated policies, so the elevated admin
-- helper no longer needs anonymous execution.
drop policy if exists "ready profile media is public" on public.profile_media;
create policy "ready profile media is public" on public.profile_media
  for select to anon, authenticated
  using (
    status = 'ready'
    and exists (
      select 1 from public.instructor_directory_profiles
      where id = instructor_profile_id
    )
  );

drop policy if exists "profile owners and admins read profile media" on public.profile_media;
create policy "profile owners and admins read profile media" on public.profile_media
  for select to authenticated
  using (
    exists (
      select 1 from public.instructor_profiles
      where id = instructor_profile_id and account_id = auth.uid()
    )
    or public.is_marketplace_admin()
  );

drop policy if exists "active static instructor targets are public" on public.directory_instructor_targets;
create policy "active static instructor targets are public" on public.directory_instructor_targets
  for select to anon, authenticated
  using (active);

-- Trigger functions execute through their triggers. No browser or API role
-- needs permission to invoke them directly.
revoke execute on function public.assign_founding_guarantee_from_membership()
  from public, anon, authenticated, service_role;
revoke execute on function public.create_inquiry_delivery()
  from public, anon, authenticated, service_role;
revoke execute on function public.enforce_inquiry_submission_limits()
  from public, anon, authenticated, service_role;
revoke execute on function public.enforce_profile_media_limits()
  from public, anon, authenticated, service_role;
revoke execute on function public.force_account_sms_paused()
  from public, anon, authenticated, service_role;
revoke execute on function public.force_instructor_sms_paused()
  from public, anon, authenticated, service_role;
revoke execute on function public.handle_new_marketplace_user()
  from public, anon, authenticated, service_role;
revoke execute on function public.log_inquiry_status_event()
  from public, anon, authenticated, service_role;
revoke execute on function public.manage_instructor_sms_consent()
  from public, anon, authenticated, service_role;
revoke execute on function public.mark_guarantee_fulfilled_by_booking()
  from public, anon, authenticated, service_role;
revoke execute on function public.protect_account_authority()
  from public, anon, authenticated, service_role;
revoke execute on function public.protect_completed_inquiry_outcome()
  from public, anon, authenticated, service_role;
revoke execute on function public.protect_instructor_review_fields()
  from public, anon, authenticated, service_role;
revoke execute on function public.protect_membership_fields()
  from public, anon, authenticated, service_role;
revoke execute on function public.publish_approved_profile_with_active_membership()
  from public, anon, authenticated, service_role;
revoke execute on function public.set_inquiry_booking_followup_due_at()
  from public, anon, authenticated, service_role;
revoke execute on function public.set_updated_at()
  from public, anon, authenticated, service_role;
revoke execute on function public.sync_inquiry_completion_schedule()
  from public, anon, authenticated, service_role;

-- Set fixed paths on functions that were originally created without one.
alter function public.enforce_profile_media_limits() set search_path = public;
alter function public.force_account_sms_paused() set search_path = public;
alter function public.force_instructor_sms_paused() set search_path = public;
alter function public.manage_instructor_sms_consent() set search_path = public;
alter function public.protect_account_authority() set search_path = public;
alter function public.protect_completed_inquiry_outcome() set search_path = public;
alter function public.protect_instructor_review_fields() set search_path = public;
alter function public.protect_membership_fields() set search_path = public;
alter function public.set_inquiry_booking_followup_due_at() set search_path = public;
alter function public.set_updated_at() set search_path = public;
alter function public.sync_inquiry_completion_schedule() set search_path = public;

-- Browser RPCs require an authenticated user. Each function performs its own
-- ownership or administrator check before reading or changing private data.
revoke execute on function public.accept_instructor_invitation(text, text, text)
  from public, anon, service_role;
grant execute on function public.accept_instructor_invitation(text, text, text)
  to authenticated;
revoke execute on function public.admin_grant_instructor_lifetime_access(uuid, text)
  from public, anon, service_role;
grant execute on function public.admin_grant_instructor_lifetime_access(uuid, text)
  to authenticated;
revoke execute on function public.admin_list_instructor_invitations()
  from public, anon, service_role;
grant execute on function public.admin_list_instructor_invitations()
  to authenticated;
revoke execute on function public.admin_list_instructor_lifetime_access()
  from public, anon, service_role;
grant execute on function public.admin_list_instructor_lifetime_access()
  to authenticated;
revoke execute on function public.admin_log_guarantee_claim(uuid, text, text, integer, text, text)
  from public, anon, service_role;
grant execute on function public.admin_log_guarantee_claim(uuid, text, text, integer, text, text)
  to authenticated;
revoke execute on function public.admin_review_guarantee_claim(uuid, text, boolean, boolean, boolean, integer, text, text)
  from public, anon, service_role;
grant execute on function public.admin_review_guarantee_claim(uuid, text, boolean, boolean, boolean, integer, text, text)
  to authenticated;
revoke execute on function public.admin_search_instructors(text, integer, integer)
  from public, anon, service_role;
grant execute on function public.admin_search_instructors(text, integer, integer)
  to authenticated;
revoke execute on function public.admin_update_instructor_guarantee(uuid, text, text, text)
  from public, anon, service_role;
grant execute on function public.admin_update_instructor_guarantee(uuid, text, text, text)
  to authenticated;
revoke execute on function public.complete_account_onboarding(text, text, text, text, boolean)
  from public, anon, service_role;
grant execute on function public.complete_account_onboarding(text, text, text, text, boolean)
  to authenticated;
revoke execute on function public.current_instructor_lifetime_access()
  from public, anon, service_role;
grant execute on function public.current_instructor_lifetime_access()
  to authenticated;
revoke execute on function public.current_marketplace_admin_status()
  from public, anon, service_role;
grant execute on function public.current_marketplace_admin_status()
  to authenticated;
revoke execute on function public.current_marketplace_owner_status()
  from public, anon, service_role;
grant execute on function public.current_marketplace_owner_status()
  to authenticated;
revoke execute on function public.get_marketplace_admin_analytics(timestamptz, timestamptz, text, text)
  from public, anon, service_role;
grant execute on function public.get_marketplace_admin_analytics(timestamptz, timestamptz, text, text)
  to authenticated;
revoke execute on function public.grant_marketplace_admin(text)
  from public, anon, service_role;
grant execute on function public.grant_marketplace_admin(text)
  to authenticated;
revoke execute on function public.is_marketplace_admin()
  from public, anon, service_role;
grant execute on function public.is_marketplace_admin()
  to authenticated;
revoke execute on function public.list_marketplace_admins()
  from public, anon, service_role;
grant execute on function public.list_marketplace_admins()
  to authenticated;
revoke execute on function public.report_booking_outcome(uuid, text, integer, text)
  from public, anon, service_role;
grant execute on function public.report_booking_outcome(uuid, text, integer, text)
  to authenticated;
revoke execute on function public.review_instructor_profile(uuid, text, text, text)
  from public, anon, service_role;
grant execute on function public.review_instructor_profile(uuid, text, text, text)
  to authenticated;
revoke execute on function public.revoke_marketplace_admin(uuid)
  from public, anon, service_role;
grant execute on function public.revoke_marketplace_admin(uuid)
  to authenticated;
revoke execute on function public.set_inquiry_status(uuid, text, text)
  from public, anon, service_role;
grant execute on function public.set_inquiry_status(uuid, text, text)
  to authenticated;
revoke execute on function public.submit_inquiry(uuid, text, date, time, text, text, text, text, text, integer, text, text, boolean, boolean, text, text)
  from public, anon, service_role;
grant execute on function public.submit_inquiry(uuid, text, date, time, text, text, text, text, text, integer, text, text, boolean, boolean, text, text)
  to authenticated;
revoke execute on function public.submit_instructor_inquiry_feedback(uuid, text, text, text, date)
  from public, anon, service_role;
grant execute on function public.submit_instructor_inquiry_feedback(uuid, text, text, text, date)
  to authenticated;

-- Worker and billing mutation RPCs are server-only.
revoke execute on function public.apply_stripe_subscription_event(text, text, timestamptz, text, boolean, uuid, text, text, text, text, timestamptz, timestamptz, boolean, text, text, timestamptz, timestamptz)
  from public, anon, authenticated;
grant execute on function public.apply_stripe_subscription_event(text, text, timestamptz, text, boolean, uuid, text, text, text, text, timestamptz, timestamptz, boolean, text, text, timestamptz, timestamptz)
  to service_role;
revoke execute on function public.apply_stripe_subscription_event_without_lifetime_access(text, text, timestamptz, text, boolean, uuid, text, text, text, text, timestamptz, timestamptz, boolean, text, text, timestamptz, timestamptz)
  from public, anon, authenticated, service_role;
revoke execute on function public.apply_verified_membership_refund(uuid, text, text, text, text, text, integer, text, text, timestamptz, uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.apply_verified_membership_refund(uuid, text, text, text, text, text, integer, text, text, timestamptz, uuid, text, text)
  to service_role;
revoke execute on function public.claim_inquiry_notification_jobs(integer, interval)
  from public, anon, authenticated;
grant execute on function public.claim_inquiry_notification_jobs(integer, interval)
  to service_role;
revoke execute on function public.claim_inquiry_notification_jobs_v2(integer, interval)
  from public, anon, authenticated;
grant execute on function public.claim_inquiry_notification_jobs_v2(integer, interval)
  to service_role;
revoke execute on function public.complete_inquiry_notification_job(bigint, boolean, text, text, boolean)
  from public, anon, authenticated;
grant execute on function public.complete_inquiry_notification_job(bigint, boolean, text, text, boolean)
  to service_role;
revoke execute on function public.create_instructor_invitation(text, text, text, boolean, uuid, timestamptz)
  from public, anon, authenticated;
grant execute on function public.create_instructor_invitation(text, text, text, boolean, uuid, timestamptz)
  to service_role;
revoke execute on function public.defer_inquiry_notification_job(bigint, text, interval)
  from public, anon, authenticated;
grant execute on function public.defer_inquiry_notification_job(bigint, text, interval)
  to service_role;
revoke execute on function public.enqueue_due_inquiry_followups()
  from public, anon, authenticated;
grant execute on function public.enqueue_due_inquiry_followups()
  to service_role;
revoke execute on function public.register_instructor_checkout_attempt(uuid, text, text, text, text, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.register_instructor_checkout_attempt(uuid, text, text, text, text, text, timestamptz)
  to service_role;

-- New functions start closed until a migration grants the required role.
alter default privileges for role postgres in schema public
  revoke execute on functions from public;
alter default privileges for role postgres in schema private
  revoke execute on functions from public;
