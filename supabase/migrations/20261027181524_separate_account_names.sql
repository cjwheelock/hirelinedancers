alter table public.accounts
  add column first_name text,
  add column last_name text;

-- Preserve the original full name. Existing records retain every remaining name part.
update public.accounts
set first_name = split_part(regexp_replace(trim(full_name), '\s+', ' ', 'g'), ' ', 1),
    last_name = nullif(regexp_replace(trim(full_name), '^\S+\s*', ''), '')
where nullif(trim(full_name), '') is not null;

-- Old clients and auth-account creation can continue supplying a full name.
create function private.sync_account_names()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (tg_op = 'INSERT' and new.first_name is null and new.last_name is null)
    or (tg_op = 'UPDATE' and new.full_name is distinct from old.full_name
      and new.first_name is not distinct from old.first_name
      and new.last_name is not distinct from old.last_name) then
    new.first_name := nullif(split_part(regexp_replace(trim(new.full_name), '\s+', ' ', 'g'), ' ', 1), '');
    new.last_name := nullif(regexp_replace(trim(new.full_name), '^\S+\s*', ''), '');
  end if;
  return new;
end;
$$;
revoke all on function private.sync_account_names() from public, anon, authenticated;
create trigger sync_account_names
before insert or update of full_name, first_name, last_name on public.accounts
for each row execute function private.sync_account_names();

create function public.complete_account_onboarding_with_names(
  p_role text,
  p_first_name text,
  p_last_name text,
  p_company_name text default null,
  p_invitation_token_hash text default null
)
returns public.accounts
language plpgsql
security invoker
set search_path = ''
as $$
declare
  result public.accounts;
  clean_first_name text := nullif(trim(p_first_name), '');
  clean_last_name text := nullif(trim(p_last_name), '');
  combined_name text;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;
  if clean_first_name is null then
    raise exception 'First name is required';
  end if;
  if clean_last_name is null then
    raise exception 'Last name is required';
  end if;
  combined_name := clean_first_name || ' ' || clean_last_name;

  if p_invitation_token_hash is not null then
    if p_role is distinct from 'instructor' then
      raise exception 'This invitation requires an instructor account';
    end if;
    perform public.accept_instructor_invitation(p_invitation_token_hash, combined_name, p_company_name);
  else
    perform public.complete_account_onboarding(p_role, combined_name, p_company_name, null, false);
  end if;

  update public.accounts
  set first_name = clean_first_name,
      last_name = clean_last_name,
      full_name = combined_name
  where id = auth.uid()
  returning * into result;
  return result;
end;
$$;
revoke all on function public.complete_account_onboarding_with_names(text, text, text, text, text)
  from public, anon;
grant execute on function public.complete_account_onboarding_with_names(text, text, text, text, text)
  to authenticated;
