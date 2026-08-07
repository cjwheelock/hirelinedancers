-- Let an instructor keep editing an approved profile without another review.
-- Approval remains an administrator-only state change. Content edits preserve
-- the approved or published status and cannot alter review timestamps.

create or replace function public.protect_instructor_review_fields()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    if new.status in ('approved', 'published') then
      new.approved_at := coalesce(new.approved_at, now());
      new.approved_by := coalesce(new.approved_by, auth.uid());
    end if;

    if auth.role() = 'authenticated' and not public.is_marketplace_admin() then
      if new.status <> 'draft' then
        raise exception 'New profiles must begin as drafts';
      end if;
      if new.approved_at is not null or new.approved_by is not null then
        raise exception 'Review fields require an administrator';
      end if;
    end if;
    return new;
  end if;

  if new.status in ('approved', 'published') and old.status not in ('approved', 'published') then
    new.approved_at := coalesce(new.approved_at, now());
    new.approved_by := coalesce(new.approved_by, auth.uid());
  end if;

  if auth.role() = 'authenticated' and not public.is_marketplace_admin() then
    if new.id is distinct from old.id
      or new.account_id is distinct from old.account_id
      or new.slug is distinct from old.slug
      or new.created_at is distinct from old.created_at then
      raise exception 'Profile identity fields require an administrator';
    end if;
    if new.published_at is distinct from old.published_at
      or new.approved_at is distinct from old.approved_at
      or new.approved_by is distinct from old.approved_by then
      raise exception 'Review fields require an administrator';
    end if;
    if old.status not in ('draft', 'approved', 'published') then
      if not (
        old.status = 'pending_review'
        and new.status = 'draft'
        and (to_jsonb(new) - 'status' - 'updated_at')
          is not distinct from (to_jsonb(old) - 'status' - 'updated_at')
      ) then
        raise exception 'Profile content is locked in its current review state';
      end if;
    end if;
    if new.status is distinct from old.status
      and not (old.status = 'draft' and new.status = 'pending_review')
      and not (old.status = 'pending_review' and new.status = 'draft') then
      raise exception 'That profile status change requires an administrator';
    end if;
  end if;

  return new;
end;
$$;

drop policy if exists "instructors update their profile" on public.instructor_profiles;
create policy "instructors update their profile" on public.instructor_profiles
  for update to authenticated
  using (
    (account_id = auth.uid() and status in ('draft', 'pending_review', 'approved', 'published'))
    or public.is_marketplace_admin()
  )
  with check (
    (account_id = auth.uid() and status in ('draft', 'pending_review', 'approved', 'published'))
    or public.is_marketplace_admin()
  );

drop policy if exists "instructors manage profile media" on public.profile_media;
create policy "instructors manage profile media" on public.profile_media
  for all to authenticated
  using (
    exists (
      select 1 from public.instructor_profiles
      where id = instructor_profile_id
        and account_id = auth.uid()
        and status in ('draft', 'approved', 'published')
    ) or public.is_marketplace_admin()
  )
  with check (
    exists (
      select 1 from public.instructor_profiles
      where id = instructor_profile_id
        and account_id = auth.uid()
        and status in ('draft', 'approved', 'published')
    ) or public.is_marketplace_admin()
  );

drop policy if exists "instructors upload their media" on storage.objects;
create policy "instructors upload their media" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'instructor-media'
    and (storage.foldername(name))[1] = auth.uid()::text
    and exists (
      select 1
      from public.instructor_profiles profile
      join public.accounts account on account.id = profile.account_id
      where profile.account_id = auth.uid()
        and account.role = 'instructor'
        and profile.status in ('draft', 'approved', 'published')
        and (storage.foldername(name))[2] = profile.id::text
    )
  );

drop policy if exists "instructors update their media" on storage.objects;
create policy "instructors update their media" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'instructor-media'
    and owner_id = auth.uid()::text
    and (storage.foldername(name))[1] = auth.uid()::text
    and exists (
      select 1 from public.instructor_profiles profile
      where profile.account_id = auth.uid()
        and profile.status in ('draft', 'approved', 'published')
        and (storage.foldername(name))[2] = profile.id::text
    )
  )
  with check (
    bucket_id = 'instructor-media'
    and owner_id = auth.uid()::text
    and (storage.foldername(name))[1] = auth.uid()::text
    and exists (
      select 1 from public.instructor_profiles profile
      where profile.account_id = auth.uid()
        and profile.status in ('draft', 'approved', 'published')
        and (storage.foldername(name))[2] = profile.id::text
    )
  );

drop policy if exists "instructors delete their media" on storage.objects;
create policy "instructors delete their media" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'instructor-media'
    and owner_id = auth.uid()::text
    and (storage.foldername(name))[1] = auth.uid()::text
    and exists (
      select 1 from public.instructor_profiles profile
      where profile.account_id = auth.uid()
        and profile.status in ('draft', 'approved', 'published')
        and (storage.foldername(name))[2] = profile.id::text
    )
  );
