-- Instructors never receive an organizer's email address or phone number
-- before a booking is paid, and see the organizer as first name plus last
-- initial. Paid bookings keep their existing day-of contacts. Organizers and
-- administrators see everything as before.

create or replace function private.organizer_short_name(p_name text)
returns text language plpgsql immutable set search_path='' as $$
declare parts text[];
begin
 if nullif(trim(p_name),'') is null then return p_name; end if;
 parts := regexp_split_to_array(trim(p_name), '[[:space:]]+');
 if array_length(parts,1) = 1 then return parts[1]; end if;
 return parts[1] || ' ' || upper(left(parts[array_length(parts,1)],1)) || '.';
end $$;

create or replace function private.mask_organizer_for_instructor(p_thread jsonb)
returns jsonb language plpgsql immutable set search_path='' as $$
declare inquiry jsonb := p_thread->'inquiry'; result jsonb := p_thread;
begin
 if inquiry is not null and jsonb_typeof(inquiry)='object' then
   inquiry := inquiry - array['email','contact_email','contact_phone_e164'];
   if inquiry ? 'contact_name' then
     inquiry := inquiry || jsonb_build_object('contact_name', private.organizer_short_name(inquiry->>'contact_name'));
   end if;
   if inquiry ? 'name' then
     inquiry := inquiry || jsonb_build_object('name', private.organizer_short_name(inquiry->>'name'));
   end if;
   if inquiry ? 'message' then
     inquiry := inquiry || jsonb_build_object('message', private.mask_contact_details(inquiry->>'message'));
   end if;
   result := result || jsonb_build_object('inquiry', inquiry);
 end if;
 if jsonb_typeof(result->'participants')='array' then
   result := result || jsonb_build_object('participants', (
     select coalesce(jsonb_agg(case when e.v->>'participant_role'='organizer'
       then e.v || jsonb_build_object('display_name', private.organizer_short_name(e.v->>'display_name')) else e.v end
       order by e.ord), '[]'::jsonb)
     from jsonb_array_elements(result->'participants') with ordinality as e(v, ord)));
 end if;
 if jsonb_typeof(result->'messages')='array' then
   result := result || jsonb_build_object('messages', (
     select coalesce(jsonb_agg(case when e.v->>'sender_role'='organizer'
       then e.v || jsonb_build_object('sender_name', private.organizer_short_name(e.v->>'sender_name')) else e.v end
       order by e.ord), '[]'::jsonb)
     from jsonb_array_elements(result->'messages') with ordinality as e(v, ord)));
 end if;
 return result;
end $$;

alter function public.get_inquiry_thread(uuid) rename to get_inquiry_thread_unmasked;
alter function public.get_inquiry_thread_unmasked(uuid) set schema private;
revoke all on function private.get_inquiry_thread_unmasked(uuid) from public, anon, authenticated;

create function public.get_inquiry_thread(p_thread_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 result := private.get_inquiry_thread_unmasked(p_thread_id);
 if result is not null
   and not public.is_marketplace_admin()
   and exists(select 1 from public.inquiry_thread_participants p
     where p.thread_id=p_thread_id and p.account_id=(select auth.uid()) and p.participant_role='instructor')
   and not private.thread_has_paid_booking(p_thread_id) then
   result := private.mask_organizer_for_instructor(result);
 end if;
 return result;
end $$;
revoke all on function public.get_inquiry_thread(uuid) from public, anon;
grant execute on function public.get_inquiry_thread(uuid) to authenticated;

alter function public.list_inquiry_threads(text,text,text,integer,timestamptz,uuid,boolean) rename to list_inquiry_threads_unmasked;
alter function public.list_inquiry_threads_unmasked(text,text,text,integer,timestamptz,uuid,boolean) set schema private;
revoke all on function private.list_inquiry_threads_unmasked(text,text,text,integer,timestamptz,uuid,boolean) from public, anon, authenticated;

create function public.list_inquiry_threads(p_search text default null, p_filter text default 'all', p_sort text default 'recent',
  p_limit integer default 50, p_cursor_at timestamptz default null, p_cursor_id uuid default null, p_admin boolean default false)
returns table(thread_id uuid, inquiry_id uuid, thread_status text, assignment_order smallint, counterparty_name text,
  counterparty_profile_slug text, event_type text, event_date date, event_city text, event_region text, unread_count bigint,
  response_due_at timestamptz, last_message_id bigint, last_message_body text, last_message_at timestamptz,
  last_message_sender_account_id uuid, next_cursor_at timestamptz, next_cursor_id uuid)
language sql stable security definer set search_path='' as $$
 select l.thread_id, l.inquiry_id, l.thread_status, l.assignment_order,
   case when t.instructor_account_id=(select auth.uid()) and not coalesce(p_admin,false)
     and not private.thread_has_paid_booking(l.thread_id)
     then private.organizer_short_name(l.counterparty_name) else l.counterparty_name end,
   l.counterparty_profile_slug, l.event_type, l.event_date, l.event_city, l.event_region, l.unread_count,
   l.response_due_at, l.last_message_id, l.last_message_body, l.last_message_at, l.last_message_sender_account_id,
   l.next_cursor_at, l.next_cursor_id
 from private.list_inquiry_threads_unmasked(p_search,p_filter,p_sort,p_limit,p_cursor_at,p_cursor_id,p_admin) l
 left join public.inquiry_threads t on t.id=l.thread_id;
$$;
revoke all on function public.list_inquiry_threads(text,text,text,integer,timestamptz,uuid,boolean) from public, anon;
grant execute on function public.list_inquiry_threads(text,text,text,integer,timestamptz,uuid,boolean) to authenticated;

CREATE OR REPLACE FUNCTION public.get_inquiry_notification_context(p_job_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare j public.inquiry_thread_notification_jobs%rowtype; t public.inquiry_threads%rowtype; i public.inquiries%rowtype; result jsonb;
begin
 perform private.require_service_role();
 select * into j from public.inquiry_thread_notification_jobs where id=p_job_id;
 select * into t from public.inquiry_threads where id=j.thread_id;
 select * into i from public.inquiries where id=t.inquiry_id;
 if not coalesce(i.automatic_sharing,false) then return jsonb_build_object('automatic',false); end if;
 result:=jsonb_build_object('automatic',true,'opportunity_closed',j.notification_type='booking_update' and j.dedupe_key like 'opportunity-closed:%','invited_count',(select count(*) from public.inquiry_threads where inquiry_id=i.id and assignment_source='fallback'));
 if j.recipient_account_id=t.instructor_account_id and j.notification_type='new_thread' then
   result:=result||jsonb_build_object('brief',jsonb_strip_nulls(jsonb_build_object(
     'Organizer',private.organizer_short_name(i.contact_name),'Company',i.company_name,
     'Start time',i.event_start_time,'Time zone',i.time_zone,'Venue',i.venue_name,'ZIP code',i.event_postal_code,
     'Attendees',i.guest_count,'Budget',i.budget_range,'Music requests',i.music_requests,
     'Venue speakers',case when i.venue_has_speakers then 'Yes' when i.venue_has_speakers=false then 'No' else 'Not sure' end,
     'Venue microphone',case when i.venue_has_microphone then 'Yes' when i.venue_has_microphone=false then 'No' else 'Not sure' end)));
 end if;
 return result;
end; $function$;

CREATE OR REPLACE FUNCTION public.claim_inquiry_thread_notification_jobs_v2(p_limit integer DEFAULT 10, p_lock_timeout interval DEFAULT '00:10:00'::interval)
 RETURNS SETOF jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 if (select auth.role()) is distinct from 'service_role' then raise exception 'Service role required'; end if;
 return query select to_jsonb(j) || jsonb_build_object('response_policy_version',t.response_policy_version,
   'delivered_to_phone_e164',q.recipient_phone_e164,'inquiry_recipient_id',q.inquiry_recipient_id,
   'provider_message_id',q.provider_message_id,
   'recipient_role',case when j.recipient_account_id=t.instructor_account_id then 'instructor'
     when j.recipient_account_id=i.organizer_account_id then 'organizer' end)
   -- Instructors see the organizer as first name and last initial until a booking is paid.
   || case when j.recipient_account_id=t.instructor_account_id and not private.thread_has_paid_booking(t.id) then
        jsonb_build_object('organizer_name',private.organizer_short_name(j.organizer_name),
          'sender_name',case when j.sender_name='Hire Line Dancers' then j.sender_name else private.organizer_short_name(j.sender_name) end)
      else '{}'::jsonb end
 from public.claim_inquiry_thread_notification_jobs(p_limit,p_lock_timeout) j
 join public.inquiry_threads t on t.id=j.thread_id join public.inquiry_thread_notification_jobs q on q.id=j.job_id
 join public.inquiries i on i.id=t.inquiry_id;
end; $function$;
