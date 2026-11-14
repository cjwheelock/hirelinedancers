-- One account-completion reminder, never a sequence. Disabled until verified rollout.
create table private.profile_reminder_config (
  singleton boolean primary key default true check(singleton),
  enabled boolean not null default false
);
insert into private.profile_reminder_config values(true,false);
create table private.profile_reminder_suppressions (
  email text primary key check(email=lower(trim(email))),
  reason text not null,
  created_at timestamptz not null default now()
);
create table public.profile_completion_reminder_jobs (
  id bigint generated always as identity primary key,
  profile_id uuid not null unique,
  account_id uuid not null unique,
  recipient_email text not null unique check(recipient_email=lower(trim(recipient_email))),
  display_name text not null,
  city text,
  status text not null default 'pending' check(status in ('pending','processing','sent','cancelled','failed','uncertain')),
  created_at timestamptz not null default now(),
  locked_at timestamptz,
  provider_message_id text,
  completed_at timestamptz,
  last_error text
);
-- Preserve the ledger even if an account/profile is deleted and recreated.
alter table public.profile_completion_reminder_jobs enable row level security;
alter table private.profile_reminder_config enable row level security;
alter table private.profile_reminder_suppressions enable row level security;
revoke all on public.profile_completion_reminder_jobs,private.profile_reminder_config,private.profile_reminder_suppressions from public,anon,authenticated;
grant all on public.profile_completion_reminder_jobs,private.profile_reminder_config,private.profile_reminder_suppressions to service_role;
grant usage,select on sequence public.profile_completion_reminder_jobs_id_seq to service_role;
grant select on public.profile_completion_reminder_jobs to authenticated;
create policy "admins read profile reminders" on public.profile_completion_reminder_jobs for select to authenticated using(public.is_marketplace_admin());

create function private.profile_reminder_eligible(p_profile_id uuid,p_email text)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(
 select 1 from public.instructor_profiles p
 join public.accounts a on a.id=p.account_id
 join auth.users u on u.id=a.id
 where p.id=p_profile_id and p.status='draft' and p.created_at<=now()-interval '24 hours'
 and a.role is distinct from 'admin' and u.email_confirmed_at is not null
 and u.deleted_at is null and (u.banned_until is null or u.banned_until<=now())
 and lower(trim(a.email))=p_email and lower(trim(u.email))=p_email
 and p_email ~ '^[^[:space:]<>@,;]+@[^[:space:]<>@,;]+[.][^[:space:]<>@,;]+$'
 and p_email not in ('cjwheelock1@gmail.com','cj.wheelock1@gmail.com','cj@hirelinedancers.com','cj@cjwheelock.com','cj@tinysidequest.com')
 and coalesce(u.raw_app_meta_data->>'is_test','false')<>'true'
 and coalesce(u.raw_user_meta_data->>'is_test','false')<>'true'
 and not exists(select 1 from private.profile_reminder_suppressions s where s.email=p_email)
 and not exists(select 1 from public.inquiry_thread_notification_jobs j where j.channel='email' and lower(trim(j.recipient_email))=p_email and j.delivery_status in ('bounced','complained'))
 );
$$;

create function public.claim_profile_completion_reminders(p_limit integer default 10)
returns setof public.profile_completion_reminder_jobs language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from private.profile_reminder_config where singleton and enabled) then return; end if;
 -- A timed-out worker might have delivered. Never automatically retry it.
 update public.profile_completion_reminder_jobs set status='uncertain',completed_at=now(),last_error='Worker lease expired; reconcile provider before any retry'
 where status='processing' and locked_at<now()-interval '10 minutes';
 insert into public.profile_completion_reminder_jobs(profile_id,account_id,recipient_email,display_name,city)
 select p.id,p.account_id,lower(trim(a.email)),p.display_name,p.city
 from public.instructor_profiles p join public.accounts a on a.id=p.account_id
 where private.profile_reminder_eligible(p.id,lower(trim(a.email)))
 order by p.created_at,p.id on conflict do nothing;
 update public.profile_completion_reminder_jobs j set status='cancelled',completed_at=now(),last_error='No longer eligible'
 where j.status='pending' and not private.profile_reminder_eligible(j.profile_id,j.recipient_email);
 return query with candidates as (
 select j.id from public.profile_completion_reminder_jobs j where j.status='pending'
 order by j.created_at,j.id for update skip locked limit greatest(1,least(coalesce(p_limit,10),25))
 ) update public.profile_completion_reminder_jobs j set status='processing',locked_at=now()
 from candidates c where j.id=c.id returning j.*;
end $$;

create function public.profile_completion_reminder_is_sendable(p_job_id bigint)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.profile_completion_reminder_jobs j
 where j.id=p_job_id and j.status='processing' and j.locked_at>now()-interval '10 minutes'
 and exists(select 1 from private.profile_reminder_config where singleton and enabled)
 and private.profile_reminder_eligible(j.profile_id,j.recipient_email));
$$;

create function public.complete_profile_completion_reminder(p_job_id bigint,p_status text,p_provider_message_id text default null,p_error text default null)
returns text language plpgsql security definer set search_path='' as $$
declare j public.profile_completion_reminder_jobs;
begin
 select * into j from public.profile_completion_reminder_jobs where id=p_job_id for update;
 if j.id is null then raise exception 'Reminder not found'; end if;
 if j.status='sent' then return 'sent'; end if;
 if j.status<>'processing' then raise exception 'Reminder is not processing'; end if;
 if p_status not in ('sent','cancelled','failed','uncertain') then raise exception 'Invalid completion status'; end if;
 if p_status='sent' and nullif(trim(p_provider_message_id),'') is null then raise exception 'Provider acceptance id required'; end if;
 update public.profile_completion_reminder_jobs set status=p_status,provider_message_id=p_provider_message_id,
 completed_at=now(),last_error=left(p_error,1000) where id=j.id;
 return p_status;
end $$;
revoke all on function private.profile_reminder_eligible(uuid,text) from public,anon,authenticated;
revoke all on function public.claim_profile_completion_reminders(integer),public.profile_completion_reminder_is_sendable(bigint),public.complete_profile_completion_reminder(bigint,text,text,text) from public,anon,authenticated;
grant execute on function public.claim_profile_completion_reminders(integer),public.profile_completion_reminder_is_sendable(bigint),public.complete_profile_completion_reminder(bigint,text,text,text) to service_role;

-- Fixed-destination smoke test. A reserved test is never retried automatically.
alter table private.profile_reminder_config add column test_status text, add column test_provider_message_id text;
create function public.reserve_profile_reminder_test() returns boolean language plpgsql security definer set search_path='' as $$
begin
 update private.profile_reminder_config set test_status='processing' where singleton and not enabled and test_status is null;
 return found;
end $$;
create function public.complete_profile_reminder_test(p_status text,p_provider_message_id text default null) returns void language plpgsql security definer set search_path='' as $$
begin
 if p_status not in ('sent','failed','uncertain','cancelled') then raise exception 'Invalid test status'; end if;
 if p_status='sent' and nullif(trim(p_provider_message_id),'') is null then raise exception 'Provider id required'; end if;
 update private.profile_reminder_config set test_status=p_status,test_provider_message_id=p_provider_message_id where singleton and test_status='processing';
end $$;
revoke all on function public.reserve_profile_reminder_test(),public.complete_profile_reminder_test(text,text) from public,anon,authenticated;
grant execute on function public.reserve_profile_reminder_test(),public.complete_profile_reminder_test(text,text) to service_role;
