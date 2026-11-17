-- Outreach done by hand (Instagram DMs, emails sent outside the outreach worker, anything else),
-- logged as one count per day and channel. Days are Eastern Time calendar days.
create table public.outreach_manual_activity (
  day date not null,
  channel text not null check (channel in ('instagram_dm', 'email_manual', 'other')),
  count integer not null default 0 check (count between 0 and 5000),
  note text check (char_length(note) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid,
  primary key (day, channel)
);

alter table public.outreach_manual_activity enable row level security;
revoke all on public.outreach_manual_activity from public, anon, authenticated;
grant all on public.outreach_manual_activity to service_role;
grant select, insert, update, delete on public.outreach_manual_activity to authenticated;
create policy "admins manage manual outreach activity" on public.outreach_manual_activity for all to authenticated
  using (public.is_marketplace_admin()) with check (public.is_marketplace_admin());

-- p_mode 'set' replaces the day's count (and the note when p_note is given; '' clears it).
-- p_mode 'add' adds p_count to the day's count atomically and leaves the note alone.
create function public.admin_log_manual_outreach(
  p_day date,
  p_channel text,
  p_count integer,
  p_mode text default 'set',
  p_note text default null
) returns public.outreach_manual_activity language plpgsql security definer set search_path = '' as $$
declare
  v_today date := (now() at time zone 'America/New_York')::date;
  v_note text := nullif(btrim(left(coalesce(p_note, ''), 500)), '');
  v_row public.outreach_manual_activity;
begin
  if not public.is_marketplace_admin() then raise exception 'Administrator access required'; end if;
  if p_day is null or p_day > v_today or p_day < date '2026-01-01' then raise exception 'Day is out of range'; end if;
  if p_channel is null or p_channel not in ('instagram_dm', 'email_manual', 'other') then raise exception 'Unknown channel'; end if;
  if p_mode is null or p_mode not in ('set', 'add') then raise exception 'Unknown mode'; end if;
  if p_count is null or (p_mode = 'set' and p_count < 0) or abs(p_count) > 5000 then raise exception 'Count is out of range'; end if;

  insert into public.outreach_manual_activity as a (day, channel, count, note, updated_by)
  values (p_day, p_channel, least(5000, greatest(0, p_count)), case when p_mode = 'set' then v_note end, auth.uid())
  on conflict (day, channel) do update set
    count = case when p_mode = 'add' then least(5000, greatest(0, a.count + p_count)) else excluded.count end,
    note = case when p_mode = 'set' and p_note is not null then v_note else a.note end,
    updated_at = now(),
    updated_by = auth.uid()
  returning a.* into v_row;
  return v_row;
end $$;
revoke all on function public.admin_log_manual_outreach(date, text, integer, text, text) from public, anon;
grant execute on function public.admin_log_manual_outreach(date, text, integer, text, text) to authenticated, service_role;
