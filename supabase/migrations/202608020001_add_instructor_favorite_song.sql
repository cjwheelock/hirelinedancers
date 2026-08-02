alter table public.instructor_applications
  add column if not exists favorite_song text,
  add column if not exists spotify_track_url text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'instructor_applications_favorite_song_length'
      and conrelid = 'public.instructor_applications'::regclass
  ) then
    alter table public.instructor_applications
      add constraint instructor_applications_favorite_song_length
        check (favorite_song is null or char_length(favorite_song) <= 200);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'instructor_applications_spotify_track_url'
      and conrelid = 'public.instructor_applications'::regclass
  ) then
    alter table public.instructor_applications
      add constraint instructor_applications_spotify_track_url
        check (
          spotify_track_url is null
          or spotify_track_url ~ '^https://open[.]spotify[.]com/track/[A-Za-z0-9]{22}$'
        );
  end if;
end
$$;
