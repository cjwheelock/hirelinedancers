-- Instructor referral program.
--
-- Signed-in instructors get one referral code (first name plus two random
-- digits). An instructor who joins through a code is attributed to the
-- referrer for 12 months. When a referred instructor's booking payout is sent,
-- the referrer earns 30% of what Hire Line Dancers kept from that booking
-- (client service fee plus instructor platform fee, net of refunds), paid by
-- Stripe transfer to the referrer's connected payout account.
--
-- Rates are mirrored in config/commercial-terms.json under `referrals` and
-- re-checked by table constraints here.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.referral_codes (
  account_id uuid primary key references public.accounts(id) on delete cascade,
  code text not null unique,
  link_visits integer not null default 0,
  created_at timestamptz not null default now(),
  disabled_at timestamptz,
  constraint referral_codes_code_check check (code ~ '^[A-Z]{1,12}[0-9]{2,3}$'),
  constraint referral_codes_visits_check check (link_visits >= 0)
);

create table public.instructor_referrals (
  referred_account_id uuid primary key references public.accounts(id) on delete cascade,
  referrer_account_id uuid not null references public.accounts(id) on delete restrict,
  code text not null,
  source text not null,
  share_bps integer not null default 3000,
  attached_at timestamptz not null default now(),
  earning_ends_at timestamptz not null,
  attached_by_account_id uuid references public.accounts(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint instructor_referrals_self_check check (referred_account_id <> referrer_account_id),
  constraint instructor_referrals_source_check check (source in ('link', 'typed', 'admin')),
  constraint instructor_referrals_share_check check (share_bps = 3000),
  constraint instructor_referrals_window_check check (earning_ends_at = attached_at + interval '12 months')
);
create index instructor_referrals_referrer_idx on public.instructor_referrals (referrer_account_id, attached_at desc);

create table public.referral_earnings (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null unique references public.bookings(id) on delete restrict,
  referred_account_id uuid not null references public.accounts(id) on delete restrict,
  referrer_account_id uuid not null references public.accounts(id) on delete restrict,
  platform_revenue_cents integer not null,
  share_bps integer not null,
  amount_cents integer not null,
  status text not null default 'due',
  stripe_transfer_id text unique,
  paid_at timestamptz,
  payout_attempts smallint not null default 0,
  payout_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint referral_earnings_status_check check (status in ('due', 'paid', 'void')),
  constraint referral_earnings_amount_check check (
    platform_revenue_cents > 0
    and share_bps = 3000
    and amount_cents = floor(platform_revenue_cents * share_bps / 10000.0)::integer
    and amount_cents between 1 and platform_revenue_cents
  ),
  constraint referral_earnings_paid_check check (
    (status <> 'paid' or (stripe_transfer_id is not null and paid_at is not null))
    and (stripe_transfer_id is null or stripe_transfer_id ~ '^tr_[A-Za-z0-9]+$')
  )
);
create index referral_earnings_referrer_idx on public.referral_earnings (referrer_account_id, status);
create index referral_earnings_due_idx on public.referral_earnings (created_at) where status = 'due';

alter table public.referral_codes enable row level security;
alter table public.instructor_referrals enable row level security;
alter table public.referral_earnings enable row level security;

create policy "owners and admins read referral codes" on public.referral_codes
  for select to authenticated
  using (account_id = (select auth.uid()) or (select public.is_marketplace_admin()));

create policy "participants and admins read referrals" on public.instructor_referrals
  for select to authenticated
  using (
    referrer_account_id = (select auth.uid())
    or referred_account_id = (select auth.uid())
    or (select public.is_marketplace_admin())
  );

create policy "referrers and admins read referral earnings" on public.referral_earnings
  for select to authenticated
  using (referrer_account_id = (select auth.uid()) or (select public.is_marketplace_admin()));

-- All writes go through the functions below.
revoke insert, update, delete on public.referral_codes from anon, authenticated;
revoke insert, update, delete on public.instructor_referrals from anon, authenticated;
revoke insert, update, delete on public.referral_earnings from anon, authenticated;
revoke all on public.referral_codes from anon;
revoke all on public.instructor_referrals from anon;
revoke all on public.referral_earnings from anon;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create or replace function private.normalize_referral_code(p_code text)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g')), '')
$$;

create or replace function private.referral_display_name(p_account_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (
      select nullif(trim(profile.display_name), '')
      from public.instructor_profiles profile
      where profile.account_id = p_account_id
        and profile.status = 'published'
    ),
    (select nullif(trim(account.first_name), '') from public.accounts account where account.id = p_account_id),
    'A fellow instructor'
  )
$$;

-- Platform revenue Hire Line Dancers kept from a booking: everything the
-- organizer paid, less refunds and the instructor payout.
create or replace function private.booking_platform_revenue_cents(p_booking public.bookings)
returns integer
language sql
stable
set search_path = ''
as $$
  select greatest(
    0,
    p_booking.total_cents
      - case when coalesce(p_booking.refund_status, 'not_required') = 'succeeded' then coalesce(p_booking.refund_cents, 0) else 0 end
      - coalesce(p_booking.payout_cents, p_booking.instructor_payout_cents)
  )
$$;

-- ---------------------------------------------------------------------------
-- Instructor functions
-- ---------------------------------------------------------------------------

create or replace function public.create_my_referral_code()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller public.accounts%rowtype;
  existing text;
  base text;
  candidate text;
  attempt integer := 0;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;
  select * into caller from public.accounts where id = auth.uid();
  if caller.id is null or caller.role is distinct from 'instructor' then
    raise exception 'Referral codes are available to instructor accounts';
  end if;

  select code into existing from public.referral_codes where account_id = caller.id;
  if existing is not null then
    return existing;
  end if;

  base := left(upper(regexp_replace(coalesce(nullif(trim(caller.first_name), ''), split_part(trim(coalesce(caller.full_name, '')), ' ', 1)), '[^A-Za-z]', '', 'g')), 12);
  if base = '' then
    base := 'DANCE';
  end if;

  loop
    attempt := attempt + 1;
    if attempt <= 40 then
      candidate := base || lpad((10 + floor(random() * 90))::integer::text, 2, '0');
    elsif attempt <= 200 then
      candidate := base || (100 + floor(random() * 900))::integer::text;
    else
      raise exception 'Unable to create a referral code. Please try again.';
    end if;
    begin
      insert into public.referral_codes (account_id, code) values (caller.id, candidate);
      return candidate;
    exception when unique_violation then
      select code into existing from public.referral_codes where account_id = caller.id;
      if existing is not null then
        return existing;
      end if;
    end;
  end loop;
end;
$$;

-- Public: confirms a code exists and returns the name to show the invitee.
create or replace function public.lookup_referral_code(p_code text)
returns table (code text, referrer_name text)
language sql
stable
security definer
set search_path = ''
as $$
  select referral.code, private.referral_display_name(referral.account_id)
  from public.referral_codes referral
  where referral.code = private.normalize_referral_code(p_code)
    and referral.disabled_at is null
$$;

-- Public: counts a visit to a referral link. Stores no visitor data.
create or replace function public.record_referral_visit(p_code text)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.referral_codes
  set link_visits = link_visits + 1
  where code = private.normalize_referral_code(p_code)
    and disabled_at is null
$$;

-- Attaches the caller's account to a referrer. Allowed once, for a new
-- instructor account (30 days) that has no paid bookings yet.
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
    referred_account_id, referrer_account_id, code, source, attached_at, earning_ends_at
  ) values (
    caller.id, referral.account_id, referral.code, clean_source, now(), now() + interval '12 months'
  );
  return private.referral_display_name(referral.account_id);
end;
$$;

-- Everything the Referrals tab shows for the signed-in instructor.
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
      'joined_at', referral.attached_at,
      'earning_ends_at', referral.earning_ends_at,
      'profile_status', coalesce(profile.status, 'draft'),
      'bookings', (
        select count(*)
        from public.bookings booking
        where booking.instructor_account_id = referral.referred_account_id
          and booking.paid_at is not null
          and booking.paid_at between referral.attached_at and referral.earning_ends_at
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
          and booking.paid_at between referral.attached_at and referral.earning_ends_at
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
      and caller.created_at >= now() - interval '30 days'
      and not exists (
        select 1 from public.bookings booking
        where booking.instructor_account_id = caller.id and booking.paid_at is not null
      )
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Admin functions
-- ---------------------------------------------------------------------------

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

-- Sets, changes, or clears who referred an instructor. A referral that has
-- already produced earnings cannot be moved to someone else.
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
      referred_account_id, referrer_account_id, code, source, attached_at, earning_ends_at, attached_by_account_id
    ) values (
      p_referred_account_id, referral.account_id, referral.code, 'admin', now(), now() + interval '12 months', auth.uid()
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

create or replace function public.admin_set_referral_code_disabled(p_account_id uuid, p_disabled boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_marketplace_admin() then
    raise exception 'Administrator access required';
  end if;
  update public.referral_codes
  set disabled_at = case when p_disabled then coalesce(disabled_at, now()) else null end
  where account_id = p_account_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Earnings and payouts
-- ---------------------------------------------------------------------------

-- When a referred instructor's payout is recorded, the referrer earns their
-- share of what the platform kept from that booking.
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
    or new.paid_at < referral.attached_at
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

create trigger record_referral_earning_after_payout
after update of stripe_transfer_id on public.bookings
for each row execute function private.record_referral_earning();

-- Service role: claims referral earnings whose referrer can receive payouts.
create or replace function public.referral_claim_due_payouts(p_limit integer default 10)
returns table (
  earning_id uuid,
  amount_cents integer,
  stripe_account_id text,
  stripe_charge_id text,
  booking_id uuid,
  referrer_account_id uuid
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_service_role();
  return query
  with due as (
    select earning.id
    from public.referral_earnings earning
    join public.instructor_profiles profile on profile.account_id = earning.referrer_account_id
    where earning.status = 'due'
      and earning.payout_attempts < 8
      and earning.updated_at <= now() - case when earning.payout_attempts > 0 then interval '10 minutes' else interval '0 minutes' end
      and private.instructor_payouts_ready(profile.id)
    order by earning.created_at, earning.id
    limit greatest(1, least(coalesce(p_limit, 10), 25))
    for update of earning skip locked
  ), claimed as (
    update public.referral_earnings earning
    set payout_attempts = earning.payout_attempts + 1,
        updated_at = now()
    from due
    where earning.id = due.id
    returning earning.*
  )
  select
    claimed.id,
    claimed.amount_cents,
    account.stripe_account_id,
    booking.stripe_charge_id,
    claimed.booking_id,
    claimed.referrer_account_id
  from claimed
  join public.bookings booking on booking.id = claimed.booking_id
  join public.instructor_profiles profile on profile.account_id = claimed.referrer_account_id
  join public.instructor_payout_accounts account on account.instructor_profile_id = profile.id;
end;
$$;

create or replace function public.referral_record_payout(
  p_earning_id uuid,
  p_transfer_id text,
  p_amount_cents integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  earning public.referral_earnings%rowtype;
begin
  perform private.require_service_role();
  if p_transfer_id !~ '^tr_[A-Za-z0-9]+$' then
    raise exception 'Invalid Stripe transfer identifier';
  end if;
  select * into earning from public.referral_earnings where id = p_earning_id for update;
  if earning.id is null then
    raise exception 'Referral earning not found';
  end if;
  if earning.status = 'paid' then
    return;
  end if;
  if p_amount_cents is distinct from earning.amount_cents then
    raise exception 'Transfer amount does not match the referral earning';
  end if;
  update public.referral_earnings
  set status = 'paid',
      stripe_transfer_id = p_transfer_id,
      paid_at = now(),
      payout_error = null,
      updated_at = now()
  where id = earning.id;
end;
$$;

create or replace function public.referral_record_payout_error(p_earning_id uuid, p_error text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_service_role();
  update public.referral_earnings
  set payout_error = left(coalesce(p_error, 'Transfer failed'), 1000),
      updated_at = now()
  where id = p_earning_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

revoke all on function private.normalize_referral_code(text) from public, anon, authenticated;
revoke all on function private.referral_display_name(uuid) from public, anon, authenticated;
revoke all on function private.booking_platform_revenue_cents(public.bookings) from public, anon, authenticated;
revoke all on function private.record_referral_earning() from public, anon, authenticated;

revoke all on function public.create_my_referral_code() from public, anon;
grant execute on function public.create_my_referral_code() to authenticated;

revoke all on function public.lookup_referral_code(text) from public;
grant execute on function public.lookup_referral_code(text) to anon, authenticated;

revoke all on function public.record_referral_visit(text) from public;
grant execute on function public.record_referral_visit(text) to anon, authenticated;

revoke all on function public.attach_referral_code(text, text) from public, anon;
grant execute on function public.attach_referral_code(text, text) to authenticated;

revoke all on function public.get_my_referral_program() from public, anon;
grant execute on function public.get_my_referral_program() to authenticated;

revoke all on function public.admin_list_referral_program() from public, anon;
grant execute on function public.admin_list_referral_program() to authenticated;

revoke all on function public.admin_set_instructor_referral(uuid, text) from public, anon;
grant execute on function public.admin_set_instructor_referral(uuid, text) to authenticated;

revoke all on function public.admin_set_referral_code_disabled(uuid, boolean) from public, anon;
grant execute on function public.admin_set_referral_code_disabled(uuid, boolean) to authenticated;

revoke all on function public.referral_claim_due_payouts(integer) from public, anon, authenticated;
grant execute on function public.referral_claim_due_payouts(integer) to service_role;

revoke all on function public.referral_record_payout(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.referral_record_payout(uuid, text, integer) to service_role;

revoke all on function public.referral_record_payout_error(uuid, text) from public, anon, authenticated;
grant execute on function public.referral_record_payout_error(uuid, text) to service_role;
