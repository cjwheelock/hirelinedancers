-- API acceptance and verified delivery are distinct. Receipts survive early webhooks.
create table private.profile_reminder_delivery_receipts (
 provider_message_id text primary key,
 status text not null check(status in ('delivered','failed','bounced','complained','suppressed')),
 occurred_at timestamptz not null
);
alter table private.profile_reminder_delivery_receipts enable row level security;
revoke all on private.profile_reminder_delivery_receipts from public,anon,authenticated;
grant all on private.profile_reminder_delivery_receipts to service_role;
alter table public.profile_completion_reminder_jobs add column delivery_status text,
 add column delivery_updated_at timestamptz;
create function private.apply_profile_reminder_receipt()
returns trigger language plpgsql security definer set search_path='' as $$
declare r private.profile_reminder_delivery_receipts;
begin
 if new.provider_message_id is null then return new; end if;
 select * into r from private.profile_reminder_delivery_receipts where provider_message_id=new.provider_message_id;
 if r.provider_message_id is not null then
  new.delivery_status=r.status; new.delivery_updated_at=r.occurred_at;
  if r.status in ('bounced','complained','suppressed') then
   insert into private.profile_reminder_suppressions(email,reason) values(new.recipient_email,'Provider '||r.status)
   on conflict(email) do nothing;
  end if;
 end if;
 return new;
end $$;
create trigger profile_reminder_receipt before insert or update of provider_message_id on public.profile_completion_reminder_jobs
 for each row execute function private.apply_profile_reminder_receipt();
create function public.record_profile_reminder_delivery(p_provider_message_id text,p_status text,p_occurred_at timestamptz)
returns void language plpgsql security definer set search_path='' as $$
begin
 if nullif(trim(p_provider_message_id),'') is null or p_occurred_at is null
 or p_status not in ('delivered','failed','bounced','complained','suppressed') then return; end if;
 insert into private.profile_reminder_delivery_receipts values(p_provider_message_id,p_status,p_occurred_at)
 on conflict(provider_message_id) do update set status=excluded.status,occurred_at=excluded.occurred_at
 where private.profile_reminder_delivery_receipts.occurred_at<=excluded.occurred_at;
 -- Trigger also reconciles early receipts when provider acceptance is saved later.
 update public.profile_completion_reminder_jobs set provider_message_id=p_provider_message_id
 where provider_message_id=p_provider_message_id;
end $$;
revoke all on function private.apply_profile_reminder_receipt() from public,anon,authenticated;
revoke all on function public.record_profile_reminder_delivery(text,text,timestamptz) from public,anon,authenticated;
grant execute on function public.record_profile_reminder_delivery(text,text,timestamptz) to service_role;
create index profile_completion_reminder_provider_idx on public.profile_completion_reminder_jobs(provider_message_id)
 where provider_message_id is not null;
