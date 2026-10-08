begin;
create extension if not exists pgtap with schema extensions;
set search_path=public,extensions;
select no_plan();

create temp table platform_test_state(state_key text primary key,payload jsonb not null);
grant select,insert,update,delete on platform_test_state to authenticated;

insert into auth.users(id,aud,role,email,confirmed_at)
values
  ('00000000-0000-0000-0000-000000002099','authenticated','authenticated','platform-operator@example.invalid',now()),
  ('00000000-0000-0000-0000-000000002098','authenticated','authenticated','pilot-admin@example.invalid',now()),
  ('00000000-0000-0000-0000-000000002097','authenticated','authenticated','suspended-operator@example.invalid',now()),
  ('00000000-0000-0000-0000-000000002096','authenticated','authenticated','other-person@example.invalid',now());
insert into public.persons(id,auth_user_id,display_name,status)
values
  ('00000000-0000-0000-0000-000000001099','00000000-0000-0000-0000-000000002099','Synthetic platform operator','active'),
  ('00000000-0000-0000-0000-000000001098','00000000-0000-0000-0000-000000002097','Suspended platform operator','active');
insert into pikas_private.platform_memberships(person_id,role_code,status)
values
  ('00000000-0000-0000-0000-000000001099','platform_admin','active'),
  ('00000000-0000-0000-0000-000000001098','platform_admin','suspended'),
  ('00000000-0000-0000-0000-000000001009','platform_admin','active');

select is((select count(*) from pikas_private.platform_capabilities),5::bigint,
  'Only the five approved platform capabilities are seeded');
select is((select count(*) from pikas_private.platform_role_capabilities
  where role_code='platform_admin'),5::bigint,'Platform admin receives only the approved capabilities');
select ok(not has_table_privilege('authenticated','pikas_private.platform_memberships','SELECT')
  and not has_table_privilege('authenticated','pikas_private.platform_memberships','INSERT')
  and not has_table_privilege('authenticated','pikas_private.platform_audit_events','SELECT')
  and not has_table_privilege('authenticated','public.staff_receivable_entries','SELECT'),
  'Private platform authorization and audit tables are not client-readable or writable');
select ok(not has_function_privilege('authenticated','pikas_private.platform_has_capability(text)','EXECUTE')
  and not has_function_privilege('anon','pikas_private.platform_has_capability(text)','EXECUTE'),
  'The private platform capability checker is not directly executable by clients');
select ok(has_function_privilege('authenticated','public.platform_get_context()','EXECUTE')
  and not has_function_privilege('anon','public.platform_get_context()','EXECUTE')
  and not has_function_privilege('service_role','public.platform_get_context()','EXECUTE'),
  'Platform context RPC is authenticated-only');
select is((select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='pikas_private' and p.proname='has_capability'
    and pg_get_function_identity_arguments(p.oid)='cap text, a uuid, s uuid, c uuid'),
  1::bigint,'Existing tenant capability checker remains present and unchanged');

select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002099',true);
set local role authenticated;
select is(public.platform_get_context()->>'role','platform_admin','Active platform operator resolves separate platform context');
select is(jsonb_array_length(public.platform_get_context()->'capabilities'),5,
  'Platform context exposes only seeded platform capabilities');
select ok(not pikas_private.has_capability('account:read','00000000-0000-0000-0000-000000000001'),
  'Platform authority does not imply tenant account capability');
select is((select count(*) from public.accounts),0::bigint,'Platform-only operator receives no tenant account rows');
select is((select count(*) from public.students),0::bigint,'Platform-only operator receives no student rows');
select is((select count(*) from public.student_wallets),0::bigint,'Platform-only operator receives no wallet rows');
select is((select count(*) from public.wallet_ledger_entries),0::bigint,'Platform-only operator receives no wallet ledger rows');
select is((select count(*) from public.purchases),0::bigint,'Platform-only operator receives no purchase rows');
select is((select count(*) from public.purchase_tenders),0::bigint,'Platform-only operator receives no purchase tender rows');
select is((select count(*) from public.purchase_cash_tenders),0::bigint,'Platform-only operator receives no cash tender rows');
select is((select count(*) from public.refunds),0::bigint,'Platform-only operator receives no refund rows');
select is((select count(*) from public.wallet_refund_credits),0::bigint,
  'Platform-only operator receives no wallet refund rows');
select is((select count(*) from public.families),0::bigint,'Platform-only operator receives no family rows');
select is((select count(*) from public.family_guardians),0::bigint,'Platform-only operator receives no guardian rows');
select is((select count(*) from public.family_student_relationships),0::bigint,
  'Platform-only operator receives no family/student relationship rows');
select is((select count(*) from public.cafeteria_customers),0::bigint,'Platform-only operator receives no cafeteria-customer rows');
select is((select count(*) from public.receipt_print_jobs),0::bigint,'Platform-only operator receives no receipt rows');
reset role;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002001',true);
set local role authenticated;
select ok(pikas_private.has_capability('account:read','00000000-0000-0000-0000-000000000001'),
  'Existing account-admin capability remains effective through the tenant checker');
select throws_ok($$select public.platform_provision_tenant(
  '00000000-0000-0000-0000-000000008001','FORBIDDEN','Forbidden tenant','S1','School','America/Santo_Domingo',
  'L1','Location','C1','Cafeteria')$$,'42501',null,
  'Account administrator cannot call platform provisioning');
reset role;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002099',true);
set local role authenticated;

insert into platform_test_state(state_key,payload) values(
  'tenant',
  public.platform_provision_tenant(
    '00000000-0000-0000-0000-000000008101','PHASE6A1-TEST','Platform test account',
    'S1','Platform test school','America/Santo_Domingo',
    'C1','Platform test campus','CAF1','Platform test cafeteria'
  )
);
select is(
  (select count(*) from platform_test_state s
    cross join lateral jsonb_object_keys(s.payload) as fields(key)
    where s.state_key='tenant'),
  4::bigint,'Tenant provisioning returns only four hierarchy identifiers'
);
select is(
  (public.platform_get_tenant_lifecycle(
    (select (payload->>'account_id')::uuid from platform_test_state where state_key='tenant')
  )#>>'{account,code}'),
  'PHASE6A1-TEST','Tenant provisioning creates the Account'
);
select is(
  jsonb_array_length(public.platform_get_tenant_lifecycle(
    (select (payload->>'account_id')::uuid from platform_test_state where state_key='tenant')
  )#>'{schools,0,locations,0,cafeterias}'),
  1,'Tenant provisioning creates the complete valid hierarchy atomically'
);
select is(
  public.platform_provision_tenant(
    '00000000-0000-0000-0000-000000008101','PHASE6A1-TEST','Platform test account',
    'S1','Platform test school','America/Santo_Domingo',
    'C1','Platform test campus','CAF1','Platform test cafeteria'
  ),
  (select payload from platform_test_state where state_key='tenant'),
  'An exact request retry returns the original hierarchy identifiers'
);
select throws_ok($$select public.platform_provision_tenant(
  '00000000-0000-0000-0000-000000008102','PHASE6A1-TEST','Changed account','S1','School',
  'America/Santo_Domingo','L1','Location','C1','Cafeteria')$$,'23505',null,
  'Duplicate business code is rejected without creating a second tenant');
select throws_ok($$select public.platform_provision_tenant(
  '00000000-0000-0000-0000-000000008101','CHANGED-CODE','Changed account','S1','Platform test school',
  'America/Santo_Domingo','C1','Platform test campus','CAF1','Platform test cafeteria')$$,
  '23505',null,'Reusing a request ID with a changed payload is rejected');
select is(
  (public.platform_get_tenant_lifecycle(
    (select (payload->>'account_id')::uuid from platform_test_state where state_key='tenant')
  )#>>'{account,code}'),
  'PHASE6A1-TEST','Failed duplicate provisioning leaves the existing hierarchy intact'
);

select throws_ok($$select public.platform_prepare_customer_admin(
  '00000000-0000-0000-0000-000000008103',
  (select (payload->>'account_id')::uuid from platform_test_state where state_key='tenant'),
  'cafeteria','00000000-0000-0000-0000-000000000011',null,'pos_cashier',
  'pilot-admin@example.invalid',now()+interval '1 day')$$,'22023',null,
  'Customer-admin provisioning refuses POS operational roles');
select throws_ok($$select public.platform_prepare_customer_admin(
  '00000000-0000-0000-0000-000000008103',
  (select (payload->>'account_id')::uuid from platform_test_state where state_key='tenant'),
  'cafeteria','00000000-0000-0000-0000-000000000012',
  '00000000-0000-0000-0000-000000000111','cafeteria_admin',
  'pilot-admin@example.invalid',now()+interval '1 day')$$,'23503',null,
  'Customer administrator scope ancestry must match the tenant');
insert into platform_test_state(state_key,payload) values(
  'intent',
  public.platform_prepare_customer_admin(
    '00000000-0000-0000-0000-000000008104',
    (select (payload->>'account_id')::uuid from platform_test_state where state_key='tenant'),
    'cafeteria',
    (select (payload->>'school_id')::uuid from platform_test_state where state_key='tenant'),
    (select (payload->>'cafeteria_id')::uuid from platform_test_state where state_key='tenant'),
    'cafeteria_admin','pilot-admin@example.invalid',now()+interval '1 day'
  )
);
select throws_ok($$select public.platform_link_customer_admin_identity(
  '00000000-0000-0000-0000-000000008105',
  (select (payload->>'intent_id')::uuid from platform_test_state where state_key='intent'),
  '00000000-0000-0000-0000-000000002096','Mismatched identity')$$,'42501',null,
  'Identity linking rejects a confirmed Auth email that does not match the intent');
insert into platform_test_state(state_key,payload) values(
  'linked',
  public.platform_link_customer_admin_identity(
    '00000000-0000-0000-0000-000000008107',
    (select (payload->>'intent_id')::uuid from platform_test_state where state_key='intent'),
    '00000000-0000-0000-0000-000000002098','Synthetic pilot administrator'
  )
);
select is((select payload->>'status' from platform_test_state where state_key='linked'),
  'linked','Confirmed intended Auth identity is linked to an active Person');
insert into platform_test_state(state_key,payload) values(
  'granted',
  public.platform_grant_customer_admin(
    '00000000-0000-0000-0000-000000008106',
    (select (payload->>'intent_id')::uuid from platform_test_state where state_key='intent')
  )
);
select is((select payload->>'role_code' from platform_test_state where state_key='granted'),
  'cafeteria_admin','Customer onboarding grants only the allowed scoped cafeteria administrator');
select is((select payload->>'status' from platform_test_state where state_key='granted'),
  'granted','Customer administrator grant completes the onboarding intent');
select is((public.platform_get_tenant_lifecycle(
  (select (payload->>'account_id')::uuid from platform_test_state where state_key='tenant')
)->'customer_admin_onboarding'->0->>'status'),'granted',
  'Lifecycle read reports onboarding status without operational data');
select ok((select count(*)>0 from public.platform_read_audit(null,100)
  where action in ('tenant_provisioned','customer_admin_identity_linked','customer_admin_membership_granted')),
  'Successful platform mutations are available through the bounded audit RPC');
select throws_ok($$update pikas_private.platform_audit_events set outcome='failed'$$,
  '42501',null,'Platform audit is not client-mutable');
select throws_ok($$select public.platform_read_audit(null,101)$$,'22023',null,
  'Audit reads enforce a bounded page size');

reset role;
select throws_ok($$update pikas_private.platform_audit_events set outcome='failed'
  where action='tenant_provisioned'$$,'23514',null,
  'Platform audit rows are append-only even for owner-level updates');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002002',true);
set local role authenticated;
select is(public.platform_get_context(),null::jsonb,
  'Ordinary tenant administrator has no platform context');
select throws_ok($$select public.platform_prepare_customer_admin(
  '00000000-0000-0000-0000-000000008201','00000000-0000-0000-0000-000000000001',
  'school','00000000-0000-0000-0000-000000000011',null,'school_admin',
  'pilot-admin@example.invalid',now()+interval '1 day')$$,'42501',null,
  'Ordinary tenant administrator cannot use platform onboarding RPCs');

reset role;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002009',true);
set local role authenticated;
select is(public.platform_get_context(),null::jsonb,
  'Suspended Person cannot resolve platform context even with an active platform membership');

reset role;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002097',true);
set local role authenticated;
select is(public.platform_get_context(),null::jsonb,
  'Active Person with suspended platform membership has no platform context');

reset role;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002098',true);
set local role authenticated;
select is(public.platform_get_context(),null::jsonb,
  'Person without an active platform membership has no platform context');

select * from finish();
rollback;
