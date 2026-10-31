-- Referral program dates, per CJ (October 30, 2026):
--   * Only instructors who join by January 31, 2027 (Eastern) can be credited
--     to a referrer.
--   * The referrer's 30% share runs for exactly one year from the date the
--     referred instructor joined the platform (account creation), not from
--     when the code was saved.

alter table public.instructor_referrals add column referred_joined_at timestamptz;
alter table public.instructor_referrals drop constraint instructor_referrals_window_check;

update public.instructor_referrals referral
set referred_joined_at = account.created_at,
    earning_ends_at = account.created_at + interval '12 months',
    updated_at = now()
from public.accounts account
where account.id = referral.referred_account_id;

alter table public.instructor_referrals alter column referred_joined_at set not null;
alter table public.instructor_referrals add constraint instructor_referrals_window_check
  check (earning_ends_at = referred_joined_at + interval '12 months');
alter table public.instructor_referrals add constraint instructor_referrals_join_cutoff_check
  check (referred_joined_at < timestamptz '2027-02-01T05:00:00Z');

create or replace function public.attach_referral_code(p_code text, p_source text default 'link')
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller public.accounts%rowtype;
  referral public.referral_codes%rowtype;
  clean_source text := case when p_source in ('link', 'typed') then p_source else 'typed' end;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;
  select * into caller from public.accounts where id = auth.uid();
  if caller.id is null or caller.role is distinct from 'instructor' then
    raise exception 'Referral codes apply to instructor accounts';
  end if;
  if exists (select 1 from public.instructor_referrals where referred_account_id = caller.id) then
    raise exception 'A referral is already saved for this account';
  end if;
  if caller.created_at >= timestamptz '2027-02-01T05:00:00Z' then
    raise exception 'Referral credit is available for instructors who joined by January 31, 2027';
  end if;
  if caller.created_at < now() - interval '30 days' then
    raise exception 'Referral codes can be added within 30 days of joining';
  end if;
  if exists (
    select 1 from public.bookings booking
    where booking.instructor_account_id = caller.id
      and booking.paid_at is not null
  ) then
    raise exception 'Referral codes can be added before your first paid booking';
  end if;

  select * into referral
  from public.referral_codes
  where code = private.normalize_referral_code(p_code)
    and disabled_at is null;
  if referral.account_id is null then
    raise exception 'That referral code was not found';
  end if;
  if referral.account_id = caller.id then
    raise exception 'You cannot use your own referral code';
  end if;

  insert into public.instructor_referrals (
    referred_account_id, referrer_account_id, code, source, attached_at, referred_joined_at, earning_ends_at
  ) values (
    caller.id, referral.account_id, referral.code, clean_source, now(), caller.created_at, caller.created_at + interval '12 months'
  );
  return private.referral_display_name(referral.account_id);
end;
$$;

create or replace function public.get_my_referral_program()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  caller public.accounts%rowtype;
  my_code public.referral_codes%rowtype;
  my_profile_id uuid;
  my_referral public.instructor_referrals%rowtype;
  rows jsonb;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;
  select * into caller from public.accounts where id = auth.uid();
  if caller.id is null or caller.role is distinct from 'instructor' then
    raise exception 'Referrals are available to instructor accounts';
  end if;

  select * into my_code from public.referral_codes where account_id = caller.id;
  select id into my_profile_id from public.instructor_profiles where account_id = caller.id;
  select * into my_referral from public.instructor_referrals where referred_account_id = caller.id;

  select coalesce(jsonb_agg(item order by (item ->> 'joined_at') desc), '[]'::jsonb)
  into rows
  from (
    select jsonb_build_object(
      'name', coalesce(
        nullif(trim(profile.display_name), ''),
        nullif(trim(concat_ws(' ', account.first_name, account.last_name)), ''),
        'New instructor'
      ),
      'joined_at', referral.referred_joined_at,
      'earning_ends_at', referral.earning_ends_at,
      'profile_status', coalesce(profile.status, 'draft'),
      'bookings', (
        select count(*)
        from public.bookings booking
        where booking.instructor_account_id = referral.referred_account_id
          and booking.paid_at is not null
          and booking.paid_at between referral.referred_joined_at and referral.earning_ends_at
          and booking.status in ('confirmed', 'completed', 'paid_out')
      ),
      'earned_cents', coalesce((
        select sum(earning.amount_cents)
        from public.referral_earnings earning
        where earning.referred_account_id = referral.referred_account_id
          and earning.status = 'paid'
      ), 0),
      'pending_cents', coalesce((
        select sum(earning.amount_cents)
        from public.referral_earnings earning
        where earning.referred_account_id = referral.referred_account_id
          and earning.status = 'due'
      ), 0) + coalesce((
        select sum(floor((booking.client_fee_cents + booking.platform_fee_cents) * referral.share_bps / 10000.0)::integer)
        from public.bookings booking
        where booking.instructor_account_id = referral.referred_account_id
          and booking.paid_at is not null
          and booking.paid_at between referral.referred_joined_at and referral.earning_ends_at
          and booking.status in ('confirmed', 'completed')
          and booking.stripe_transfer_id is null
      ), 0)
    ) as item
    from public.instructor_referrals referral
    join public.accounts account on account.id = referral.referred_account_id
    left join public.instructor_profiles profile on profile.account_id = referral.referred_account_id
    where referral.referrer_account_id = caller.id
  ) referred;

  return jsonb_build_object(
    'code', my_code.code,
    'link_visits', coalesce(my_code.link_visits, 0),
    'payouts_ready', case when my_profile_id is null then false else private.instructor_payouts_ready(my_profile_id) end,
    'share_bps', 3000,
    'referrals', rows,
    'referred_by', case when my_referral.referred_account_id is null then null else jsonb_build_object(
      'name', private.referral_display_name(my_referral.referrer_account_id),
      'code', my_referral.code
    ) end,
    'can_add_referral', my_referral.referred_account_id is null
      and caller.created_at < timestamptz '2027-02-01T05:00:00Z'
      and caller.created_at >= now() - interval '30 days'
      and not exists (
        select 1 from public.bookings booking
        where booking.instructor_account_id = caller.id and booking.paid_at is not null
      )
  );
end;
$$;

create or replace function public.admin_list_referral_program()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  referrers jsonb;
  signups jsonb;
begin
  if not public.is_marketplace_admin() then
    raise exception 'Administrator access required';
  end if;

  select coalesce(jsonb_agg(item order by (item ->> 'joined')::integer desc, item ->> 'name'), '[]'::jsonb)
  into referrers
  from (
    select jsonb_build_object(
      'account_id', code.account_id,
      'name', coalesce(nullif(trim(profile.display_name), ''), nullif(trim(account.full_name), ''), account.email),
      'email', account.email,
      'code', code.code,
      'disabled', code.disabled_at is not null,
      'link_visits', code.link_visits,
      'joined', (select count(*) from public.instructor_referrals referral where referral.referrer_account_id = code.account_id),
      'live', (
        select count(*)
        from public.instructor_referrals referral
        join public.instructor_profiles referred on referred.account_id = referral.referred_account_id
        where referral.referrer_account_id = code.account_id and referred.status = 'published'
      ),
      'bookings', (select count(*) from public.referral_earnings earning where earning.referrer_account_id = code.account_id and earning.status <> 'void'),
      'platform_revenue_cents', coalesce((select sum(earning.platform_revenue_cents) from public.referral_earnings earning where earning.referrer_account_id = code.account_id and earning.status <> 'void'), 0),
      'paid_cents', coalesce((select sum(earning.amount_cents) from public.referral_earnings earning where earning.referrer_account_id = code.account_id and earning.status = 'paid'), 0),
      'due_cents', coalesce((select sum(earning.amount_cents) from public.referral_earnings earning where earning.referrer_account_id = code.account_id and earning.status = 'due'), 0),
      'payouts_ready', case when profile.id is null then false else private.instructor_payouts_ready(profile.id) end
    ) as item
    from public.referral_codes code
    join public.accounts account on account.id = code.account_id
    left join public.instructor_profiles profile on profile.account_id = code.account_id
  ) listed;

  select coalesce(jsonb_agg(item order by item ->> 'attached_at' desc), '[]'::jsonb)
  into signups
  from (
    select jsonb_build_object(
      'referred_account_id', referral.referred_account_id,
      'name', coalesce(nullif(trim(profile.display_name), ''), nullif(trim(account.full_name), ''), account.email),
      'email', account.email,
      'referrer_name', coalesce(nullif(trim(referrer_profile.display_name), ''), nullif(trim(referrer.full_name), ''), referrer.email),
      'code', referral.code,
      'source', referral.source,
      'attached_at', referral.attached_at,
      'joined_at', referral.referred_joined_at,
      'earning_ends_at', referral.earning_ends_at,
      'profile_status', coalesce(profile.status, 'draft')
    ) as item
    from public.instructor_referrals referral
    join public.accounts account on account.id = referral.referred_account_id
    join public.accounts referrer on referrer.id = referral.referrer_account_id
    left join public.instructor_profiles profile on profile.account_id = referral.referred_account_id
    left join public.instructor_profiles referrer_profile on referrer_profile.account_id = referral.referrer_account_id
  ) listed;

  return jsonb_build_object(
    'referrers', referrers,
    'signups', signups,
    'totals', jsonb_build_object(
      'active_codes', (select count(*) from public.referral_codes where disabled_at is null),
      'referred', (select count(*) from public.instructor_referrals),
      'platform_revenue_cents', coalesce((select sum(platform_revenue_cents) from public.referral_earnings where status <> 'void'), 0),
      'paid_cents', coalesce((select sum(amount_cents) from public.referral_earnings where status = 'paid'), 0),
      'due_cents', coalesce((select sum(amount_cents) from public.referral_earnings where status = 'due'), 0)
    )
  );
end;
$$;

create or replace function public.admin_set_instructor_referral(
  p_referred_account_id uuid,
  p_code text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  referral public.referral_codes%rowtype;
  existing public.instructor_referrals%rowtype;
  referred public.accounts%rowtype;
begin
  if not public.is_marketplace_admin() then
    raise exception 'Administrator access required';
  end if;
  select * into referred from public.accounts where id = p_referred_account_id;
  if referred.id is null or referred.role is distinct from 'instructor' then
    raise exception 'Instructor account not found';
  end if;
  select * into existing from public.instructor_referrals where referred_account_id = p_referred_account_id;
  if referred.created_at >= timestamptz '2027-02-01T05:00:00Z' and private.normalize_referral_code(p_code) is not null then
    raise exception 'Referral credit is available for instructors who joined by January 31, 2027';
  end if;

  if private.normalize_referral_code(p_code) is null then
    if existing.referred_account_id is null then
      return;
    end if;
    if exists (select 1 from public.referral_earnings where referred_account_id = p_referred_account_id) then
      raise exception 'This referral already has earnings and cannot be removed';
    end if;
    delete from public.instructor_referrals where referred_account_id = p_referred_account_id;
    return;
  end if;

  select * into referral from public.referral_codes where code = private.normalize_referral_code(p_code);
  if referral.account_id is null then
    raise exception 'That referral code was not found';
  end if;
  if referral.account_id = p_referred_account_id then
    raise exception 'An instructor cannot refer themselves';
  end if;

  if existing.referred_account_id is null then
    insert into public.instructor_referrals (
      referred_account_id, referrer_account_id, code, source, attached_at, referred_joined_at, earning_ends_at, attached_by_account_id
    ) values (
      p_referred_account_id, referral.account_id, referral.code, 'admin', now(), referred.created_at, referred.created_at + interval '12 months', auth.uid()
    );
  else
    if existing.referrer_account_id <> referral.account_id
      and exists (select 1 from public.referral_earnings where referred_account_id = p_referred_account_id) then
      raise exception 'This referral already has earnings and cannot be moved';
    end if;
    update public.instructor_referrals
    set referrer_account_id = referral.account_id,
        code = referral.code,
        source = 'admin',
        attached_by_account_id = auth.uid(),
        updated_at = now()
    where referred_account_id = p_referred_account_id;
  end if;
end;
$$;

create or replace function private.record_referral_earning()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  referral public.instructor_referrals%rowtype;
  revenue integer;
begin
  if new.stripe_transfer_id is null or old.stripe_transfer_id is not null then
    return new;
  end if;
  select * into referral from public.instructor_referrals where referred_account_id = new.instructor_account_id;
  if referral.referred_account_id is null
    or new.paid_at is null
    or new.paid_at < referral.referred_joined_at
    or new.paid_at > referral.earning_ends_at then
    return new;
  end if;
  revenue := private.booking_platform_revenue_cents(new);
  if floor(revenue * referral.share_bps / 10000.0)::integer < 1 then
    return new;
  end if;
  insert into public.referral_earnings (
    booking_id, referred_account_id, referrer_account_id, platform_revenue_cents, share_bps, amount_cents
  ) values (
    new.id, referral.referred_account_id, referral.referrer_account_id, revenue, referral.share_bps,
    floor(revenue * referral.share_bps / 10000.0)::integer
  )
  on conflict (booking_id) do nothing;
  return new;
end;
$$;
