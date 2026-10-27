begin;
create function pg_temp.check_names(ok boolean, message text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception '%', message; end if; end $$;

insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values
 ('92000000-0000-4000-8000-000000000001', 'names-organizer@example.test', now(), '{"full_name":"Legacy de la Cruz"}'),
 ('92000000-0000-4000-8000-000000000002', 'names-instructor@example.test', now(), '{}'),
 ('92000000-0000-4000-8000-000000000003', 'names-invited@example.test', now(), '{}');
select pg_temp.check_names((select first_name='Legacy' and last_name='de la Cruz' and full_name='Legacy de la Cruz'
  from public.accounts where id='92000000-0000-4000-8000-000000000001'), 'legacy auth name must be retained');

select set_config('request.jwt.claims', '{"sub":"92000000-0000-4000-8000-000000000001","email":"names-organizer@example.test","role":"authenticated"}', true);
set local role authenticated;
select public.complete_account_onboarding_with_names('organizer', ' Mary Jane ', ' de la Cruz ');
select pg_temp.check_names((select first_name='Mary Jane' and last_name='de la Cruz' and full_name='Mary Jane de la Cruz' and role='organizer'
  from public.accounts where id=auth.uid()), 'structured names must retain compound first and last names');
do $$ begin
  begin
    perform public.complete_account_onboarding_with_names('organizer', ' ', 'Last');
    raise exception 'blank first name accepted';
  exception when raise_exception then if sqlerrm <> 'First name is required' then raise; end if; end;
  begin
    perform public.complete_account_onboarding_with_names('organizer', 'First', ' ');
    raise exception 'blank last name accepted';
  exception when raise_exception then if sqlerrm <> 'Last name is required' then raise; end if; end;
  begin
    perform public.complete_account_onboarding_with_names('instructor', 'First', 'Last');
    raise exception 'role change accepted';
  exception when raise_exception then if sqlerrm <> 'Contact support to change your account type' then raise; end if; end;
end $$;
select pg_temp.check_names((select count(*)=1 from public.accounts), 'account names must remain owner-only');
reset role;
select set_config('request.jwt.claims', '{"sub":"92000000-0000-4000-8000-000000000002","email":"names-instructor@example.test","role":"authenticated"}', true);
set local role authenticated;
select public.complete_account_onboarding_with_names('instructor', 'CJ', 'Wheelock');
select pg_temp.check_names((select first_name='CJ' and last_name='Wheelock' from public.accounts where id=auth.uid()), 'instructor names persisted');
select pg_temp.check_names((select display_name='CJ Wheelock' from public.instructor_profiles where account_id=auth.uid()), 'public name preserved');
reset role;

insert into public.instructor_invitations(email,token_hash,request_key,status,invited_by,sent_at)
values ('names-invited@example.test', repeat('e',64), 'names-invitation-regression', 'sent', '92000000-0000-4000-8000-000000000001',now());
select set_config('request.jwt.claims', '{"sub":"92000000-0000-4000-8000-000000000003","email":"names-invited@example.test","role":"authenticated"}', true);
set local role authenticated;
select public.claim_instructor_invitation(repeat('e',64));
select public.complete_account_onboarding_with_names('instructor', 'Ana Maria', 'van der Meer', null, repeat('e',64));
select pg_temp.check_names((select first_name='Ana Maria' and last_name='van der Meer' and role='instructor' from public.accounts where id=auth.uid()), 'invited instructor names persisted');
reset role;
select pg_temp.check_names(not has_function_privilege('anon','public.complete_account_onboarding_with_names(text,text,text,text,text)','execute'), 'anonymous onboarding denied');
select pg_temp.check_names((select not prosecdef from pg_proc where oid='public.complete_account_onboarding_with_names(text,text,text,text,text)'::regprocedure), 'wrapper must enforce account RLS');
rollback;
select 'account_names.sql passed, all changes rolled back' as result;
