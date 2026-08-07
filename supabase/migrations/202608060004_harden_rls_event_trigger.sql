-- Supabase may install an event-trigger helper that automatically enables RLS
-- on new public tables. It runs through its event trigger and does not need to
-- be callable through PostgREST by browser or service API roles.

do $$
begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    execute 'revoke execute on function public.rls_auto_enable() from public, anon, authenticated, service_role';
  end if;
end;
$$;
