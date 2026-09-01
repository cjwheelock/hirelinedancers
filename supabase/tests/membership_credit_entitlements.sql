\set ON_ERROR_STOP on

-- Run after all migrations. Every fixture is rolled back.
begin;

create or replace function pg_temp.credit_assert(
  p_condition boolean,
  p_message text
)
returns void
language plpgsql
as $$
begin
  if coalesce(p_condition, false) is not true then
    raise exception 'Membership credit assertion failed: %', p_message;
  end if;
end;
$$;

-- Mutation RPCs and direct table writes remain server-only. The authenticated
-- read RPC is protected internally by the marketplace-admin check.
select pg_temp.credit_assert(
  has_function_privilege(
    'service_role',
    'public.issue_membership_credit_entitlement(uuid,text,text,uuid,uuid,text)',
    'execute'
  )
    and not has_function_privilege(
      'authenticated',
      'public.issue_membership_credit_entitlement(uuid,text,text,uuid,uuid,text)',
      'execute'
    )
    and has_function_privilege(
      'authenticated',
      'public.admin_list_membership_credit_entitlements(uuid)',
      'execute'
    )
    and not has_table_privilege(
      'authenticated', 'public.membership_credit_entitlements', 'insert'
    )
    and not has_table_privilege(
      'authenticated', 'public.membership_credit_applications', 'update'
    ),
  'only the intended API roles may read or mutate the ledger'
);

select pg_temp.credit_assert(
  (
    select count(*) = 7
    from pg_proc procedure
    join pg_namespace namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.proname in (
        'admin_list_membership_credit_entitlements',
        'issue_membership_credit_entitlement',
        'claim_membership_credit_application',
        'defer_membership_credit_application',
        'mark_membership_credit_applied',
        'consume_membership_credit_application',
        'requeue_canceled_membership_credits'
      )
      and procedure.prosecdef
      and exists (
        select 1
        from unnest(procedure.proconfig) setting
        where setting like 'search_path=%'
          and replace(setting, 'search_path=', '') in ('', '""')
      )
  ),
  'every SECURITY DEFINER function must have an empty search_path'
);

insert into auth.users (id, email, raw_user_meta_data) values
  (
    '91000000-0000-4000-8000-000000000001',
    'credit-owner@example.test',
    '{"full_name":"Credit Owner"}'
  ),
  (
    '91000000-0000-4000-8000-000000000002',
    'credit-instructor@example.test',
    '{"full_name":"Credit Instructor"}'
  );

update public.accounts
set role = case
  when id = '91000000-0000-4000-8000-000000000001' then 'admin'
  else 'instructor'
end,
onboarding_completed_at = now()
where id in (
  '91000000-0000-4000-8000-000000000001',
  '91000000-0000-4000-8000-000000000002'
);

insert into public.marketplace_admins (account_id, is_owner, granted_by)
values (
  '91000000-0000-4000-8000-000000000001',
  true,
  '91000000-0000-4000-8000-000000000001'
);

insert into public.instructor_profiles (
  id, account_id, display_name, status
) values (
  '91000000-0000-4000-8000-000000000010',
  '91000000-0000-4000-8000-000000000002',
  'Credit Instructor',
  'draft'
);

set local role service_role;

select public.issue_membership_credit_entitlement(
  '91000000-0000-4000-8000-000000000010',
  'admin',
  'admin:test:91000001',
  '91000000-0000-4000-8000-000000000020',
  '91000000-0000-4000-8000-000000000001',
  'Audit note'
);

-- A transport retry is an exact replay, not a second credit.
select public.issue_membership_credit_entitlement(
  '91000000-0000-4000-8000-000000000010',
  'admin',
  'admin:test:91000001',
  '91000000-0000-4000-8000-000000000020',
  '91000000-0000-4000-8000-000000000001',
  'Audit note'
);

select pg_temp.credit_assert(
  (
    select count(*) = 1
    from public.membership_credit_entitlements
    where instructor_profile_id =
      '91000000-0000-4000-8000-000000000010'
  ),
  'an idempotent grant retry must create one entitlement'
);

-- No membership is a defer outcome. It must not consume or void the credit.
select public.claim_membership_credit_application(
  '91000000-0000-4000-8000-000000000010',
  (
    select id from public.membership_credit_entitlements
    where source_reference = 'admin:test:91000001'
  ),
  'price_hldmonthly',
  true
);

select pg_temp.credit_assert(
  (
    select status = 'pending'
      and last_deferred_reason = 'no_membership'
    from public.membership_credit_entitlements
    where source_reference = 'admin:test:91000001'
  ),
  'an ineligible credit must remain pending'
);

reset role;
insert into public.instructor_memberships (
  instructor_profile_id,
  stripe_customer_id,
  stripe_subscription_id,
  stripe_price_id,
  status
) values (
  '91000000-0000-4000-8000-000000000010',
  'cus_credit1',
  'sub_credit1',
  'price_hldmonthly',
  'active'
);
set local role service_role;

select public.claim_membership_credit_application(
  '91000000-0000-4000-8000-000000000010',
  (
    select id from public.membership_credit_entitlements
    where source_reference = 'admin:test:91000001'
  ),
  'price_hldmonthly',
  true
);

select public.mark_membership_credit_applied(
  (
    select id from public.membership_credit_applications
    where stripe_subscription_id = 'sub_credit1'
  ),
  'cus_credit1',
  'sub_credit1',
  'price_hldmonthly',
  'coupon_free_month',
  'di_credit1',
  'req_credit1',
  now()
);

-- Cancellation abandons only the Stripe attempt and restores the entitlement.
select public.requeue_canceled_membership_credits(
  '91000000-0000-4000-8000-000000000010',
  'sub_credit1'
);

select pg_temp.credit_assert(
  (
    select status = 'pending'
      and applied_at is null
      and last_deferred_reason = 'subscription_canceled'
    from public.membership_credit_entitlements
    where source_reference = 'admin:test:91000001'
  ) and (
    select status = 'abandoned'
    from public.membership_credit_applications
    where stripe_subscription_id = 'sub_credit1'
  ),
  'a canceled subscription must not lose its unused credit'
);

-- A matching invoice webhook can arrive after subscription.deleted. Exact
-- Stripe facts reverse the requeue and consume the original application.
select public.consume_membership_credit_application(
  'evt_credit1_finalized_late',
  (
    select id from public.membership_credit_applications
    where stripe_subscription_id = 'sub_credit1'
  ),
  'cus_credit1',
  'sub_credit1',
  'price_hldmonthly',
  'coupon_free_month',
  'di_credit1',
  'in_credit1',
  1500,
  'usd',
  true,
  now()
);

select pg_temp.credit_assert(
  (
    select entitlement.status = 'consumed'
      and application.status = 'consumed'
      and application.actual_discount_amount_cents = 1500
      and application.stripe_invoice_id = 'in_credit1'
    from public.membership_credit_entitlements entitlement
    join public.membership_credit_applications application
      on application.entitlement_id = entitlement.id
      and application.stripe_subscription_id = 'sub_credit1'
    where entitlement.source_reference = 'admin:test:91000001'
  ),
  'deleted-before-finalized delivery must consume instead of reuse the credit'
);

-- A Stripe update can succeed while its database application remains
-- applying. Exact old-invoice facts must still consume that application after
-- a rapid rejoin changes the canonical subscription.
select public.issue_membership_credit_entitlement(
  '91000000-0000-4000-8000-000000000010',
  'welcome_video',
  'welcome:test:91000002',
  '91000000-0000-4000-8000-000000000030',
  null,
  null
);

select public.claim_membership_credit_application(
  '91000000-0000-4000-8000-000000000010',
  (
    select id from public.membership_credit_entitlements
    where source_reference = 'welcome:test:91000002'
  ),
  'price_hldmonthly',
  true
);

reset role;
update public.instructor_memberships
set stripe_customer_id = 'cus_creditnew',
    stripe_subscription_id = 'sub_creditnew'
where instructor_profile_id = '91000000-0000-4000-8000-000000000010';
set local role service_role;

select public.consume_membership_credit_application(
  'evt_credit_old_finalized_after_rejoin',
  (
    select id from public.membership_credit_applications
    where entitlement_id = (
      select id from public.membership_credit_entitlements
      where source_reference = 'welcome:test:91000002'
    )
  ),
  'cus_credit1',
  'sub_credit1',
  'price_hldmonthly',
  'coupon_free_month',
  'di_creditold',
  'in_creditold',
  1500,
  'usd',
  true,
  now()
);

select pg_temp.credit_assert(
  (
    select entitlement.status = 'consumed'
      and application.status = 'consumed'
      and application.stripe_customer_id = 'cus_credit1'
      and application.stripe_subscription_id = 'sub_credit1'
      and application.stripe_invoice_id = 'in_creditold'
    from public.membership_credit_entitlements entitlement
    join public.membership_credit_applications application
      on application.entitlement_id = entitlement.id
    where entitlement.source_reference = 'welcome:test:91000002'
  ),
  'canonical rejoin must not prevent exact old-application consumption'
);

rollback;
