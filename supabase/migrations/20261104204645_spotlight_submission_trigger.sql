create or replace function private.spotlight_profile_changed()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and old.account_id is distinct from new.account_id then
    update public.instructor_spotlights set status = 'draft', released_at = null, revision = gen_random_uuid()
      where profile_id = new.id;
  end if;
  -- Only a submission starts a spotlight. Later reviews and media edits
  -- can refresh an existing article without enrolling a historical profile.
  perform private.refresh_spotlight(
    new.id, new.status = 'pending_review' and (tg_op = 'INSERT' or old.status = 'draft')
  );
  return null;
end;
$$;
