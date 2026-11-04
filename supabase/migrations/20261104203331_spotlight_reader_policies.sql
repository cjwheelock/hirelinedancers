-- Evaluate one read policy per API role.
alter policy "Released spotlight articles" on public.instructor_spotlights to anon;
alter policy "Spotlight reviewers" on public.instructor_spotlights using (
  status = 'released' or (select public.is_marketplace_admin()) or exists (
    select 1 from public.instructor_profiles p
    where p.id = profile_id and p.account_id = (select auth.uid())
  )
);
