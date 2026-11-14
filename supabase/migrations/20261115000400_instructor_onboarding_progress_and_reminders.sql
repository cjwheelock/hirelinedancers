-- 1. Onboarding step tracking: the furthest profile-setup step each instructor
--    reaches, and when, so admins can see where drafts stall. No personal data.
-- 2. Instructor reminders: the existing 24-hour profile reminder gains a
--    72-hour follow-up, and published instructors without a ready payout
--    account get one payouts reminder. All three share one ledger and the
--    existing enable switch, suppressions, and delivery receipts.

create table if not exists public.instructor_onboarding_progress (
  instructor_profile_id uuid primary key references public.instructor_profiles(id) on delete cascade,
  furthest_step smallint not null check (furthest_step between 1 and 6),
  furthest_step_key text not null check (furthest_step_key in ('basics','media','services','links','review','payouts')),
  first_seen_at timestamptz not null default now(),
  furthest_step_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);
alter table public.instructor_onboarding_progress enable row level security;
revoke all on public.instructor_onboarding_progress from public, anon, authenticated;
grant select on public.instructor_onboarding_progress to authenticated;
grant all on public.instructor_onboarding_progress to service_role;
create policy "admins and owners read onboarding progress" on public.instructor_onboarding_progress
  for select to authenticated using (
    public.is_marketplace_admin() or exists(select 1 from public.instructor_profiles p
      where p.id = instructor_profile_id and p.account_id = (select auth.uid())));

create or replace function public.record_instructor_onboarding_step(p_step text)
returns void language plpgsql security definer set search_path='' as $$
declare profile_id uuid; step_number smallint;
begin
  step_number := case p_step when 'basics' then 1 when 'media' then 2 when 'services' then 3
    when 'links' then 4 when 'review' then 5 when 'payouts' then 6 end;
  if step_number is null then raise exception 'Unknown onboarding step'; end if;
  select id into profile_id from public.instructor_profiles where account_id = (select auth.uid());
  if profile_id is null then return; end if;
  insert into public.instructor_onboarding_progress(instructor_profile_id, furthest_step, furthest_step_key)
  values (profile_id, step_number, p_step)
  on conflict (instructor_profile_id) do update set
    last_seen_at = now(),
    furthest_step = greatest(public.instructor_onboarding_progress.furthest_step, excluded.furthest_step),
    furthest_step_key = case when excluded.furthest_step > public.instructor_onboarding_progress.furthest_step
      then excluded.furthest_step_key else public.instructor_onboarding_progress.furthest_step_key end,
    furthest_step_at = case when excluded.furthest_step > public.instructor_onboarding_progress.furthest_step
      then now() else public.instructor_onboarding_progress.furthest_step_at end;
end $$;
revoke all on function public.record_instructor_onboarding_step(text) from public, anon;
grant execute on function public.record_instructor_onboarding_step(text) to authenticated;

-- Reminder ledger: one row per profile per reminder kind.
alter table public.profile_completion_reminder_jobs add column if not exists kind text not null default 'profile_24h';
alter table public.profile_completion_reminder_jobs add constraint profile_completion_reminder_jobs_kind_check
  check (kind in ('profile_24h','profile_72h','payouts'));
alter table public.profile_completion_reminder_jobs drop constraint profile_completion_reminder_jobs_account_id_key;
alter table public.profile_completion_reminder_jobs drop constraint profile_completion_reminder_jobs_profile_id_key;
alter table public.profile_completion_reminder_jobs drop constraint profile_completion_reminder_jobs_recipient_email_key;
alter table public.profile_completion_reminder_jobs add constraint profile_completion_reminder_jobs_profile_kind_key unique (profile_id, kind);
alter table public.profile_completion_reminder_jobs add constraint profile_completion_reminder_jobs_account_kind_key unique (account_id, kind);
alter table public.profile_completion_reminder_jobs add constraint profile_completion_reminder_jobs_email_kind_key unique (recipient_email, kind);

create or replace function private.instructor_reminder_eligible(p_profile_id uuid, p_email text, p_kind text)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(
 select 1 from public.instructor_profiles p
 join public.accounts a on a.id=p.account_id
 join auth.users u on u.id=a.id
 where p.id=p_profile_id
 and case p_kind
   when 'profile_24h' then p.status='draft' and p.created_at<=now()-interval '24 hours'
   when 'profile_72h' then p.status='draft' and p.created_at<=now()-interval '72 hours'
     and exists(select 1 from public.profile_completion_reminder_jobs first
       where first.profile_id=p.id and first.kind='profile_24h' and first.status='sent'
         and first.completed_at<=now()-interval '40 hours')
   when 'payouts' then p.status='published' and coalesce(p.published_at,p.approved_at,p.created_at)<=now()-interval '24 hours'
     and not private.instructor_payouts_ready(p.id)
   else false end
 and a.role is distinct from 'admin' and u.email_confirmed_at is not null
 and u.deleted_at is null and (u.banned_until is null or u.banned_until<=now())
 and lower(trim(a.email))=p_email and lower(trim(u.email))=p_email
 and p_email ~ '^[^[:space:]<>@,;]+@[^[:space:]<>@,;]+[.][^[:space:]<>@,;]+$'
 and p_email not in ('cjwheelock1@gmail.com','cj.wheelock1@gmail.com','cj@hirelinedancers.com','cj@cjwheelock.com','cj@tinysidequest.com')
 and p_email !~ '^(cj\.?wheelock1)\+[^@]*@gmail\.com$'
 and coalesce(u.raw_app_meta_data->>'is_test','false')<>'true'
 and coalesce(u.raw_user_meta_data->>'is_test','false')<>'true'
 and not exists(select 1 from private.profile_reminder_suppressions s where s.email=p_email)
 and not exists(select 1 from public.inquiry_thread_notification_jobs j where j.channel='email' and lower(trim(j.recipient_email))=p_email and j.delivery_status in ('bounced','complained'))
 );
$$;

-- Kept for callers of the original single-reminder check.
create or replace function private.profile_reminder_eligible(p_profile_id uuid,p_email text)
returns boolean language sql stable security definer set search_path='' as $$
 select private.instructor_reminder_eligible(p_profile_id, p_email, 'profile_24h');
$$;

create or replace function public.claim_profile_completion_reminders(p_limit integer default 10)
returns setof public.profile_completion_reminder_jobs language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from private.profile_reminder_config where singleton and enabled) then return; end if;
 -- A timed-out worker might have delivered. Never automatically retry it.
 update public.profile_completion_reminder_jobs set status='uncertain',completed_at=now(),last_error='Worker lease expired; reconcile provider before any retry'
 where status='processing' and locked_at<now()-interval '10 minutes';
 insert into public.profile_completion_reminder_jobs(profile_id,account_id,recipient_email,display_name,city,kind)
 select p.id,p.account_id,lower(trim(a.email)),p.display_name,p.city,k.kind
 from public.instructor_profiles p join public.accounts a on a.id=p.account_id
 cross join (values ('profile_24h'),('profile_72h'),('payouts')) k(kind)
 where private.instructor_reminder_eligible(p.id,lower(trim(a.email)),k.kind)
 order by p.created_at,p.id on conflict do nothing;
 update public.profile_completion_reminder_jobs j set status='cancelled',completed_at=now(),last_error='No longer eligible'
 where j.status='pending' and not private.instructor_reminder_eligible(j.profile_id,j.recipient_email,j.kind);
 return query with candidates as (
 select j.id from public.profile_completion_reminder_jobs j where j.status='pending'
 order by j.created_at,j.id for update skip locked limit greatest(1,least(coalesce(p_limit,10),25))
 ) update public.profile_completion_reminder_jobs j set status='processing',locked_at=now()
 from candidates c where j.id=c.id returning j.*;
end $$;

create or replace function public.profile_completion_reminder_is_sendable(p_job_id bigint)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.profile_completion_reminder_jobs j
 where j.id=p_job_id and j.status='processing' and j.locked_at>now()-interval '10 minutes'
 and exists(select 1 from private.profile_reminder_config where singleton and enabled)
 and private.instructor_reminder_eligible(j.profile_id,j.recipient_email,j.kind));
$$;

revoke all on function private.instructor_reminder_eligible(uuid,text,text) from public, anon, authenticated;
revoke all on function public.claim_profile_completion_reminders(integer), public.profile_completion_reminder_is_sendable(bigint) from public, anon, authenticated;
grant execute on function public.claim_profile_completion_reminders(integer), public.profile_completion_reminder_is_sendable(bigint) to service_role;
