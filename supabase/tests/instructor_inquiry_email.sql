\set ON_ERROR_STOP on
begin;
set local hire_line_dancers.commission_access = 'off';

insert into auth.users (id, email, raw_user_meta_data) values
  ('70000000-0000-0000-0000-000000000020', 'login@example.test', '{"full_name":"Email Teacher"}');
update public.accounts set role = 'instructor', onboarding_completed_at = now()
where id = '70000000-0000-0000-0000-000000000020';
insert into public.instructor_profiles (id, account_id, slug, status, display_name, city, region, event_types)
values ('80000000-0000-0000-0000-000000000020', '70000000-0000-0000-0000-000000000020',
  'email-teacher', 'draft', 'Email Teacher', 'Austin', 'TX', array['weddings']);

select set_config('request.jwt.claim.sub', '70000000-0000-0000-0000-000000000020', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claims', '{"sub":"70000000-0000-0000-0000-000000000020","email":"login@example.test","role":"authenticated"}', true);
set local role authenticated;

insert into public.instructor_private_settings (instructor_profile_id, inquiry_email)
values ('80000000-0000-0000-0000-000000000020', ' Alerts@Example.test ');
update public.instructor_private_settings set minimum_hours = 2
where instructor_profile_id = '80000000-0000-0000-0000-000000000020';
update public.instructor_private_settings set inquiry_email = 'new-alerts@example.test'
where instructor_profile_id = '80000000-0000-0000-0000-000000000020';
reset role;

do $$
begin
  if (select inquiry_email from public.instructor_private_settings
      where instructor_profile_id = '80000000-0000-0000-0000-000000000020') <> 'new-alerts@example.test' then
    raise exception 'instructor-chosen inquiry email must be kept';
  end if;
  if (select array_agg(delivered_to_email order by id) from public.instructor_service_notification_jobs
      where instructor_profile_id = '80000000-0000-0000-0000-000000000020'
        and notification_type = 'inquiry_email_confirmation')
     is distinct from array['alerts@example.test', 'new-alerts@example.test'] then
    raise exception 'one confirmation per new inquiry email expected';
  end if;
end;
$$;

-- A sign-in email change leaves a custom inquiry email alone.
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claim.role', '', true);
select set_config('request.jwt.claims', '', true);
update auth.users set email = 'login2@example.test' where id = '70000000-0000-0000-0000-000000000020';
do $$
begin
  if (select inquiry_email from public.instructor_private_settings
      where instructor_profile_id = '80000000-0000-0000-0000-000000000020') <> 'new-alerts@example.test' then
    raise exception 'login change must not overwrite a custom inquiry email';
  end if;
end;
$$;

rollback;
\echo 'instructor_inquiry_email.sql passed'
