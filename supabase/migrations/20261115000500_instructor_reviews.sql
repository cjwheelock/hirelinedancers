-- Organizer reviews. After a paid booking's event is completed, the organizer
-- is emailed a request to rate the instructor from 1 to 5 stars with an
-- optional note. One review per booking, only from the organizer who paid.
-- Reviews are public on the instructor's profile; administrators can hide one.

create table if not exists public.instructor_reviews (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null unique references public.bookings(id) on delete cascade,
  instructor_profile_id uuid not null references public.instructor_profiles(id) on delete cascade,
  organizer_account_id uuid not null references public.accounts(id) on delete cascade,
  rating smallint not null check (rating between 1 and 5),
  note text check (note is null or char_length(note) <= 1000),
  hidden_at timestamptz,
  hidden_by uuid references public.accounts(id),
  created_at timestamptz not null default now()
);
create index if not exists instructor_reviews_profile_idx on public.instructor_reviews(instructor_profile_id, created_at desc);
alter table public.instructor_reviews enable row level security;
revoke all on public.instructor_reviews from public, anon, authenticated;
grant select on public.instructor_reviews to authenticated;
grant all on public.instructor_reviews to service_role;
create policy "admins and authors read reviews" on public.instructor_reviews for select to authenticated
  using (public.is_marketplace_admin() or organizer_account_id = (select auth.uid()));

-- Public, read-only: visible reviews for a published instructor.
create or replace function public.get_instructor_reviews(p_instructor_profile_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object(
   'count', count(r.id),
   'average', round(avg(r.rating)::numeric, 1),
   'reviews', coalesce(jsonb_agg(jsonb_build_object(
     'id', r.id, 'rating', r.rating, 'note', r.note, 'created_at', r.created_at,
     'reviewer_name', private.organizer_short_name(coalesce(nullif(trim(a.full_name),''), 'Organizer')),
     'event_type', i.event_type) order by r.created_at desc) filter (where r.id is not null), '[]'::jsonb))
 from public.instructor_profiles p
 left join public.instructor_reviews r on r.instructor_profile_id = p.id and r.hidden_at is null
 left join public.accounts a on a.id = r.organizer_account_id
 left join public.bookings b on b.id = r.booking_id
 left join public.inquiries i on i.id = b.inquiry_id
 where p.id = p_instructor_profile_id and p.status = 'published';
$$;
revoke all on function public.get_instructor_reviews(uuid) from public;
grant execute on function public.get_instructor_reviews(uuid) to anon, authenticated;

create or replace function private.reviewable_booking(p_thread_id uuid)
returns public.bookings language sql stable security definer set search_path='' as $$
 select b.* from public.bookings b
 where b.thread_id = p_thread_id and b.paid_at is not null and b.status in ('completed','paid_out')
 order by b.event_ends_at desc limit 1;
$$;

create or replace function private.booking_review_request_needed(p_thread_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from private.reviewable_booking(p_thread_id) b
   where b.id is not null and not exists(select 1 from public.instructor_reviews r where r.booking_id = b.id));
$$;

-- The organizer's review state for a conversation.
create or replace function public.get_booking_review(p_thread_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare b public.bookings; r public.instructor_reviews;
begin
 select * into b from private.reviewable_booking(p_thread_id);
 if b.id is null or b.organizer_account_id is distinct from (select auth.uid()) then
   return jsonb_build_object('can_review', false);
 end if;
 select * into r from public.instructor_reviews where booking_id = b.id;
 return jsonb_build_object('booking_id', b.id, 'can_review', r.id is null,
   'review', case when r.id is null then null else jsonb_build_object('rating', r.rating, 'note', r.note, 'created_at', r.created_at) end);
end $$;
revoke all on function public.get_booking_review(uuid) from public, anon;
grant execute on function public.get_booking_review(uuid) to authenticated;

create or replace function public.submit_instructor_review(p_booking_id uuid, p_rating integer, p_note text default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare b public.bookings; clean_note text := nullif(trim(coalesce(p_note,'')), ''); review_id uuid;
begin
 if (select auth.uid()) is null then raise exception 'Authentication required'; end if;
 select * into b from public.bookings where id = p_booking_id;
 if b.id is null or b.organizer_account_id is distinct from (select auth.uid()) then raise exception 'Booking not found or access denied'; end if;
 if b.paid_at is null or b.status not in ('completed','paid_out') then raise exception 'You can review this instructor after the event'; end if;
 if p_rating is null or p_rating < 1 or p_rating > 5 then raise exception 'Choose a rating from 1 to 5'; end if;
 if char_length(coalesce(clean_note,'')) > 1000 then raise exception 'Keep your note under 1,000 characters'; end if;
 insert into public.instructor_reviews(booking_id, instructor_profile_id, organizer_account_id, rating, note)
 values (b.id, b.instructor_profile_id, b.organizer_account_id, p_rating, clean_note)
 on conflict (booking_id) do nothing returning id into review_id;
 if review_id is null then raise exception 'You already reviewed this booking'; end if;
 return review_id;
end $$;
revoke all on function public.submit_instructor_review(uuid, integer, text) from public, anon;
grant execute on function public.submit_instructor_review(uuid, integer, text) to authenticated;

create or replace function public.admin_set_instructor_review_hidden(p_review_id uuid, p_hidden boolean)
returns void language plpgsql security definer set search_path='' as $$
begin
 if not public.is_marketplace_admin() then raise exception 'Administrator access required'; end if;
 update public.instructor_reviews set hidden_at = case when p_hidden then now() else null end,
   hidden_by = case when p_hidden then (select auth.uid()) else null end where id = p_review_id;
 if not found then raise exception 'Review not found'; end if;
end $$;
revoke all on function public.admin_set_instructor_review_hidden(uuid, boolean) from public, anon;
grant execute on function public.admin_set_instructor_review_hidden(uuid, boolean) to authenticated;

create or replace function public.admin_list_instructor_reviews(p_limit integer default 50)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not public.is_marketplace_admin() then raise exception 'Administrator access required'; end if;
 return coalesce((select jsonb_agg(row_to_json(x) order by x.created_at desc) from (
   select r.id, r.rating, r.note, r.created_at, r.hidden_at, p.display_name as instructor_name,
     coalesce(nullif(trim(a.full_name),''), a.email) as organizer_name, r.booking_id, b.thread_id
   from public.instructor_reviews r join public.instructor_profiles p on p.id = r.instructor_profile_id
   join public.accounts a on a.id = r.organizer_account_id join public.bookings b on b.id = r.booking_id
   order by r.created_at desc limit greatest(1, least(coalesce(p_limit,50), 200))) x), '[]'::jsonb);
end $$;
revoke all on function public.admin_list_instructor_reviews(integer) from public, anon;
grant execute on function public.admin_list_instructor_reviews(integer) to authenticated;

-- Ask once, when a paid booking's event is marked completed.
create or replace function private.enqueue_booking_review_request()
returns trigger language plpgsql security definer set search_path='' as $$
declare organizer_email text;
begin
 if new.status <> 'completed' or new.paid_at is null or (tg_op = 'UPDATE' and old.status = new.status) then return new; end if;
 select email into organizer_email from public.accounts where id = new.organizer_account_id;
 if organizer_email is null or organizer_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' then return new; end if;
 insert into public.inquiry_thread_notification_jobs(thread_id, recipient_account_id, recipient_email, notification_type, dedupe_key)
 values (new.thread_id, new.organizer_account_id, organizer_email, 'review_request', 'booking:' || new.id::text || ':review-request')
 on conflict (dedupe_key) do nothing;
 return new;
end $$;
revoke all on function private.enqueue_booking_review_request() from public, anon, authenticated;
drop trigger if exists enqueue_booking_review_request on public.bookings;
create trigger enqueue_booking_review_request after insert or update of status on public.bookings
  for each row execute function private.enqueue_booking_review_request();

alter table public.inquiry_thread_notification_jobs drop constraint if exists inquiry_thread_notification_type_check;
alter table public.inquiry_thread_notification_jobs add constraint inquiry_thread_notification_type_check
  check (notification_type = any (array['new_thread','new_message','response_reminder_24','response_reminder_47',
    'response_reminder_48','response_timeout_instructor','response_timeout_organizer','thread_declined',
    'fallback_routed_organizer','booking_update','still_looking_organizer','review_request']));

CREATE OR REPLACE FUNCTION private.inquiry_notification_needed(p_job_id bigint)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare j public.inquiry_thread_notification_jobs%rowtype; t public.inquiry_threads%rowtype; i public.inquiries%rowtype;
begin
 select * into j from public.inquiry_thread_notification_jobs where id=p_job_id;
 select * into t from public.inquiry_threads where id=j.thread_id;
 select * into i from public.inquiries where id=t.inquiry_id;
 if j.id is null then return false; end if;
 if j.notification_type='booking_update' then return t.id is not null; end if;
 if j.notification_type='review_request' then return private.booking_review_request_needed(j.thread_id); end if;
 if i.status='withdrawn' then return false; end if;
 if j.notification_type='new_message' then return t.status in ('awaiting_response','active','declined','timed_out'); end if;
 if not private.inquiry_event_open(t.inquiry_id) then return false; end if;
 return case
 when j.notification_type='new_thread' then t.status='awaiting_response'
 when j.notification_type in ('response_reminder_24','response_reminder_47','response_reminder_48') then
   t.status='awaiting_response' and t.first_instructor_message_at is null and t.response_due_at>now()
   and (j.notification_type<>'response_reminder_24' or now()<t.response_clock_started_at+
     case when t.response_policy_version=1 then interval '48 hours' else interval '47 hours' end)
 when j.notification_type='response_timeout_instructor' then
   t.status='timed_out' and t.first_instructor_message_at is null
 -- Instructors invited by automatic sharing were never chosen by the organizer.
 -- Their silence or decline is summarized once by the still-looking notice.
 when j.notification_type='response_timeout_organizer' then
   t.status='timed_out' and t.first_instructor_message_at is null and t.assignment_source<>'fallback'
 when j.notification_type='thread_declined' then t.status='declined' and t.assignment_source<>'fallback'
 when j.notification_type='still_looking_organizer' then private.inquiry_sharing_unanswered(t.inquiry_id)
 when j.notification_type='fallback_routed_organizer' then t.status in ('awaiting_response','active','declined','timed_out')
 else false end;
end; $function$;
