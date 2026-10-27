-- Instructors choose the email that receives inquiry alerts. Whenever that
-- address is set or changed, a confirmation email goes to it so the
-- instructor knows alerts will arrive.

-- 1. Stop forcing the inquiry email to the sign-in email.
create or replace function public.protect_membership_fields()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if auth.role() = 'authenticated' then
    if tg_op = 'INSERT' then
      new.stripe_customer_id := null;
      new.stripe_subscription_id := null;
      new.subscription_status := 'inactive';
      new.stripe_payment_method_id := null;
      new.stripe_payment_setup_intent_id := null;
      new.stripe_payment_setup_checkout_session_id := null;
      new.payment_setup_completed_at := null;
    else
      new.stripe_customer_id := old.stripe_customer_id;
      new.stripe_subscription_id := old.stripe_subscription_id;
      new.subscription_status := old.subscription_status;
      new.stripe_payment_method_id := old.stripe_payment_method_id;
      new.stripe_payment_setup_intent_id :=
        old.stripe_payment_setup_intent_id;
      new.stripe_payment_setup_checkout_session_id :=
        old.stripe_payment_setup_checkout_session_id;
      new.payment_setup_completed_at := old.payment_setup_completed_at;
    end if;
  end if;
  new.inquiry_email := lower(btrim(new.inquiry_email));
  return new;
end;
$$;

-- 2. A sign-in email change only carries over to inquiry alerts when the
-- instructor was still using their sign-in email for them.
create or replace function private.sync_inquiry_email_on_login_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.email is null or new.email is not distinct from old.email then
    return new;
  end if;
  update public.instructor_private_settings settings
  set inquiry_email = lower(new.email),
      updated_at = now()
  from public.instructor_profiles profile
  where profile.id = settings.instructor_profile_id
    and profile.account_id = new.id
    and lower(settings.inquiry_email) = lower(old.email);
  return new;
end;
$$;

-- handle_new_marketplace_user previously overwrote every inquiry email when
-- the sign-in email changed. Keep its account upsert, drop that overwrite.
create or replace function public.handle_new_marketplace_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.accounts (id, email, full_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name')
  )
  on conflict (id) do update set
    email = excluded.email,
    full_name = coalesce(public.accounts.full_name, excluded.full_name),
    updated_at = now();
  return new;
end;
$$;

do $$
begin
  if to_regclass('auth.users') is not null then
    execute 'drop trigger if exists sync_inquiry_email_on_login_change on auth.users';
    execute 'create trigger sync_inquiry_email_on_login_change
      after update of email on auth.users
      for each row execute function private.sync_inquiry_email_on_login_change()';
  end if;
end;
$$;

-- 3. Confirmation email whenever the inquiry email is set or changed.
alter table public.instructor_service_notification_jobs
  drop constraint if exists instructor_service_notification_type_check;
alter table public.instructor_service_notification_jobs
  add constraint instructor_service_notification_type_check check (
    notification_type in (
      'profile_approved',
      'activation_payment_failed',
      'billing_grace_started',
      'billing_access_paused',
      'inquiry_email_confirmation'
    )
  );

alter table public.instructor_service_notification_jobs
  drop constraint if exists instructor_service_notification_recovery_check;
alter table public.instructor_service_notification_jobs
  add constraint instructor_service_notification_recovery_check check (
    (
      notification_type in ('profile_approved', 'activation_payment_failed', 'inquiry_email_confirmation')
      and billing_recovery_id is null
    )
    or (
      notification_type in ('billing_grace_started', 'billing_access_paused')
      and billing_recovery_id is not null
    )
  );

create or replace function private.queue_inquiry_email_confirmation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  login text;
begin
  if tg_op = 'UPDATE' and lower(new.inquiry_email) is not distinct from lower(old.inquiry_email) then
    return new;
  end if;

  select account.email into login
  from public.instructor_profiles profile
  join public.accounts account on account.id = profile.account_id
  where profile.id = new.instructor_profile_id;

  insert into public.instructor_service_notification_jobs (
    instructor_profile_id,
    notification_type,
    dedupe_key,
    delivered_to_email,
    login_email
  ) values (
    new.instructor_profile_id,
    'inquiry_email_confirmation',
    new.instructor_profile_id::text || ':' || lower(new.inquiry_email) || ':' ||
      to_char(clock_timestamp(), 'YYYYMMDDHH24MISSUS'),
    new.inquiry_email,
    coalesce(login, new.inquiry_email)
  );
  return new;
end;
$$;

revoke all on function private.queue_inquiry_email_confirmation() from public, anon, authenticated;

drop trigger if exists queue_inquiry_email_confirmation on public.instructor_private_settings;
create trigger queue_inquiry_email_confirmation
  after insert or update of inquiry_email on public.instructor_private_settings
  for each row execute function private.queue_inquiry_email_confirmation();
