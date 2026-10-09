begin;
create extension if not exists pgtap with schema extensions;
set search_path=public,extensions;
select no_plan();

insert into auth.users(id,aud,role,email,confirmed_at)
values
  ('00000000-0000-0000-0000-000000006099','authenticated','authenticated','phase6a2-platform@example.invalid',now()),
  ('00000000-0000-0000-0000-000000006098','authenticated','authenticated','phase6a2-other-platform@example.invalid',now()),
  ('00000000-0000-0000-0000-000000006097','authenticated','authenticated','phase6a2-unauthorized@example.invalid',now());
insert into public.persons(id,auth_user_id,display_name,status)
values
  ('00000000-0000-0000-0000-000000005099','00000000-0000-0000-0000-000000006099','Phase 6A.2 platform operator','active'),
  ('00000000-0000-0000-0000-000000005098','00000000-0000-0000-0000-000000006098','Phase 6A.2 second platform operator','active'),
  ('00000000-0000-0000-0000-000000005097','00000000-0000-0000-0000-000000006097','Phase 6A.2 unauthorized user','active');
insert into pikas_private.platform_memberships(person_id,role_code,status)
values
  ('00000000-0000-0000-0000-000000005099','platform_admin','active'),
  ('00000000-0000-0000-0000-000000005098','platform_admin','active');
insert into public.accounts(id,code,name,status)
values
  ('00000000-0000-0000-0000-000000004002','PHASE6A2-OTHER','Phase 6A.2 other account','active'),
  ('00000000-0000-0000-0000-000000004003','PHASE6A2-INACTIVE','Phase 6A.2 inactive account','inactive'),
  ('00000000-0000-0000-0000-000000004004','PHASE6A2-SCHOOL-STATE','Phase 6A.2 school state account','active');
insert into public.schools(id,account_id,code,name,status)
values
  ('00000000-0000-0000-0000-000000003002','00000000-0000-0000-0000-000000004002','OTHER-SCHOOL','Other school','active'),
  ('00000000-0000-0000-0000-000000003003','00000000-0000-0000-0000-000000004003','INACTIVE-SCHOOL','Inactive school','active'),
  ('00000000-0000-0000-0000-000000003004','00000000-0000-0000-0000-000000004004','SUSPENDED-SCHOOL','Suspended school','suspended');

create temp table phase6a2_state(state_key text primary key,payload jsonb not null);
grant select,insert,update,delete on phase6a2_state to authenticated;

select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000006099',true);
set local role authenticated;

insert into phase6a2_state(state_key,payload) values(
  'tenant',
  public.platform_provision_tenant(
    '00000000-0000-0000-0000-000000008201',
    'PHASE6A2-TEST','Phase 6A.2 test account',
    'S1','Phase 6A.2 test school','America/Santo_Domingo',
    'C1','Phase 6A.2 first campus','CAF1','Phase 6A.2 first cafeteria'
  )
);
select is(jsonb_array_length(public.platform_get_tenant_lifecycle(
  (select (payload->>'account_id')::uuid from phase6a2_state where state_key='tenant')
)->'schools'),1,'Existing tenant provisioning still creates one School');
select is(jsonb_array_length((public.platform_get_tenant_lifecycle(
  (select (payload->>'account_id')::uuid from phase6a2_state where state_key='tenant')
 )#>'{schools,0,locations}')),1,
  'Existing tenant provisioning still creates one Location before expansion');

insert into phase6a2_state(state_key,payload) values(
  'expansion',
  public.platform_add_school_location(
    '00000000-0000-0000-0000-000000008202',
    (select (payload->>'account_id')::uuid from phase6a2_state where state_key='tenant'),
    (select (payload->>'school_id')::uuid from phase6a2_state where state_key='tenant'),
    'C2','Phase 6A.2 second campus','CAF2','Phase 6A.2 second cafeteria'
  )
);
select is((select count(*) from phase6a2_state s
  cross join lateral jsonb_object_keys(s.payload) as fields(key)
  where s.state_key='expansion'),4::bigint,'Expansion returns the four hierarchy IDs');
select is((select payload->>'account_id' from phase6a2_state where state_key='expansion'),
  (select payload->>'account_id' from phase6a2_state where state_key='tenant'),
  'Expansion reuses the existing Account');
select is((select payload->>'school_id' from phase6a2_state where state_key='expansion'),
  (select payload->>'school_id' from phase6a2_state where state_key='tenant'),
  'Expansion reuses the existing School');
select is(jsonb_array_length((public.platform_get_tenant_lifecycle(
  (select (payload->>'account_id')::uuid from phase6a2_state where state_key='tenant')
 )#>'{schools,0,locations}')),2,
  'Lifecycle read represents both Locations under the existing School');
reset role;
select is((select count(*) from public.accounts
  where id=(select (payload->>'account_id')::uuid from phase6a2_state where state_key='tenant')),
  1::bigint,'Exactly one Account exists in the provisioned hierarchy');
select is((select count(*) from public.schools
  where account_id=(select (payload->>'account_id')::uuid from phase6a2_state where state_key='tenant')),
  1::bigint,'Exactly one School belongs to the Account');
select is((select count(*) from public.school_locations
  where school_id=(select (payload->>'school_id')::uuid from phase6a2_state where state_key='tenant')),
  2::bigint,'Exactly two Locations belong to the School');
select is((select count(*) from public.cafeterias
  where school_id=(select (payload->>'school_id')::uuid from phase6a2_state where state_key='tenant')),
  2::bigint,'Exactly two Cafeterias belong to the School');
select is((select count(*) from public.cafeterias c
  join public.school_locations l on l.id=c.school_location_id
  where l.school_id=(select (payload->>'school_id')::uuid from phase6a2_state where state_key='tenant')
    and c.account_id=l.account_id and c.school_id=l.school_id),
  2::bigint,'Each Cafeteria has matching Account, School, and Location ancestry');
select is((select count(*) from (
  select l.id from public.school_locations l
  join public.cafeterias c on c.school_location_id=l.id
  where l.school_id=(select (payload->>'school_id')::uuid from phase6a2_state where state_key='tenant')
  group by l.id having count(c.id)=1
) as locations),2::bigint,
  'Exactly one Cafeteria belongs to each Location');
select is((select count(*) from public.accounts
  where id=(select (payload->>'account_id')::uuid from phase6a2_state where state_key='tenant')
    and status='active'),1::bigint,'Account remains active');
select is((select count(*) from public.schools
  where id=(select (payload->>'school_id')::uuid from phase6a2_state where state_key='tenant')
    and status='active'),1::bigint,'School remains active');
select is((select count(*) from public.school_locations
  where school_id=(select (payload->>'school_id')::uuid from phase6a2_state where state_key='tenant')
    and status='active'),2::bigint,'Both Locations are active');
select is((select count(*) from public.cafeterias
  where school_id=(select (payload->>'school_id')::uuid from phase6a2_state where state_key='tenant')
    and status='active'),2::bigint,'Both Cafeterias are active');
select is((select count(*) from public.account_memberships
  where person_id='00000000-0000-0000-0000-000000005099'),0::bigint,
  'Platform-only operator receives no Account membership');
select is((select count(*) from public.school_memberships
  where person_id='00000000-0000-0000-0000-000000005099'),0::bigint,
  'Platform-only operator receives no School membership');
select is((select count(*) from public.cafeteria_memberships
  where person_id='00000000-0000-0000-0000-000000005099'),0::bigint,
  'Platform-only operator receives no Cafeteria membership');
set local role authenticated;
select ok(not pikas_private.has_capability(
  'account:read','00000000-0000-0000-0000-000000005099'
),'Platform authority still does not satisfy tenant app-role checks');

select is(public.platform_add_school_location(
  '00000000-0000-0000-0000-000000008202',
  (select (payload->>'account_id')::uuid from phase6a2_state where state_key='tenant'),
  (select (payload->>'school_id')::uuid from phase6a2_state where state_key='tenant'),
  'C2','Phase 6A.2 second campus','CAF2','Phase 6A.2 second cafeteria'
), (select payload from phase6a2_state where state_key='expansion'),
  'Same request, actor, operation, and payload replays the original IDs');
select throws_ok($$select public.platform_add_school_location(
  '00000000-0000-0000-0000-000000008202',
  (select (payload->>'account_id')::uuid from phase6a2_state where state_key='tenant'),
  (select (payload->>'school_id')::uuid from phase6a2_state where state_key='tenant'),
  'C2-CHANGED','Changed campus','CAF2','Phase 6A.2 second cafeteria')$$,
  '23505',null,'Reusing a request ID with a changed payload is rejected');
select throws_ok($$select public.platform_add_school_location(
  '00000000-0000-0000-0000-000000008201',
  (select (payload->>'account_id')::uuid from phase6a2_state where state_key='tenant'),
  (select (payload->>'school_id')::uuid from phase6a2_state where state_key='tenant'),
  'C2','Phase 6A.2 second campus','CAF2','Phase 6A.2 second cafeteria')$$,
  '23505',null,'A request ID used by tenant provisioning cannot be reused for expansion');
select throws_ok($$select public.platform_add_school_location(
  '00000000-0000-0000-0000-000000008203',
  '00000000-0000-0000-0000-000000004002',
  (select (payload->>'school_id')::uuid from phase6a2_state where state_key='tenant'),
  'C3','Cross-account campus','CAF3','Cross-account cafeteria')$$,
  '23503',null,'School belonging to another Account is rejected');
select throws_ok($$select public.platform_add_school_location(
  '00000000-0000-0000-0000-000000008204',
  '00000000-0000-0000-0000-000000004003',
  '00000000-0000-0000-0000-000000003003',
  'C3','Inactive campus','CAF3','Inactive cafeteria')$$,
  '23503',null,'Inactive Account is rejected');
select throws_ok($$select public.platform_add_school_location(
  '00000000-0000-0000-0000-000000008209',
  '00000000-0000-0000-0000-000000004004',
  '00000000-0000-0000-0000-000000003004',
  'C3','Suspended campus','CAF3','Suspended cafeteria')$$,
  '23503',null,'Suspended School is rejected');
select throws_ok($$select public.platform_add_school_location(
  '00000000-0000-0000-0000-000000008205',
  (select (payload->>'account_id')::uuid from phase6a2_state where state_key='tenant'),
  '00000000-0000-0000-0000-000000003002',
  'C3','Cross-school campus','CAF3','Cross-school cafeteria')$$,
  '23503',null,'School belonging to another Account cannot be paired with this Account');
select throws_ok($$select public.platform_add_school_location(
  '00000000-0000-0000-0000-000000008206',
  (select (payload->>'account_id')::uuid from phase6a2_state where state_key='tenant'),
  (select (payload->>'school_id')::uuid from phase6a2_state where state_key='tenant'),
  'C1','Duplicate campus code','CAF3','Duplicate cafeteria test')$$,
  '23505',null,'Duplicate Location code is rejected at the School uniqueness scope');
select is(jsonb_array_length((public.platform_get_tenant_lifecycle(
  (select (payload->>'account_id')::uuid from phase6a2_state where state_key='tenant')
 )#>'{schools,0,locations}')),2,'Rejected hierarchy attempts leave no extra Location');

reset role;
create function public.phase6a2_reject_test_cafeteria() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.code='TRIGGER-FAIL' then
    raise exception using errcode='23514',message='test_cafeteria_insert_rejected';
  end if;
  return new;
end $$;
create trigger phase6a2_reject_test_cafeteria
before insert on public.cafeterias
for each row execute function public.phase6a2_reject_test_cafeteria();
set local role authenticated;
select throws_ok($$select public.platform_add_school_location(
  '00000000-0000-0000-0000-000000008207',
  (select (payload->>'account_id')::uuid from phase6a2_state where state_key='tenant'),
  (select (payload->>'school_id')::uuid from phase6a2_state where state_key='tenant'),
  'ATOMIC-FAIL','Atomicity test campus','TRIGGER-FAIL','Rejected cafeteria')$$,
  '23514',null,'Cafeteria insertion failure aborts the expansion operation');
reset role;
drop trigger phase6a2_reject_test_cafeteria on public.cafeterias;
drop function public.phase6a2_reject_test_cafeteria();
set local role authenticated;
select ok(not exists(select 1 from jsonb_array_elements((public.platform_get_tenant_lifecycle(
  (select (payload->>'account_id')::uuid from phase6a2_state where state_key='tenant')
 )#>'{schools,0,locations}')) as locations(location)
  where location->>'code'='ATOMIC-FAIL'),
  'Failed Cafeteria insertion rolls back its new Location');

select is((select count(*) from public.platform_read_audit(null,100)
  where request_id='00000000-0000-0000-0000-000000008202'
    and action='school_location_added' and reason_code='school_location_added'
    and capability='platform:tenant:provision'
    and actor_auth_user_id='00000000-0000-0000-0000-000000006099'
    and actor_person_id='00000000-0000-0000-0000-000000005099'
    and target_account_id=(select (payload->>'account_id')::uuid
      from phase6a2_state where state_key='tenant')
    and target_school_id=(select (payload->>'school_id')::uuid
      from phase6a2_state where state_key='tenant')
    and target_location_id=(select (payload->>'location_id')::uuid
      from phase6a2_state where state_key='expansion')
    and target_cafeteria_id=(select (payload->>'cafeteria_id')::uuid
      from phase6a2_state where state_key='expansion')
    and metadata->>'location_code'='C2'
    and metadata->>'cafeteria_code'='CAF2'),1::bigint,
  'Audit identifies actor, capability, request, hierarchy, and submitted codes');

select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000006098',true);
select throws_ok($$select public.platform_add_school_location(
  '00000000-0000-0000-0000-000000008202',
  (select (payload->>'account_id')::uuid from phase6a2_state where state_key='tenant'),
  (select (payload->>'school_id')::uuid from phase6a2_state where state_key='tenant'),
  'C2','Phase 6A.2 second campus','CAF2','Phase 6A.2 second cafeteria')$$,
  '23505',null,'Same request under a different authorized actor is rejected');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000006097',true);
select throws_ok($$select public.platform_add_school_location(
  '00000000-0000-0000-0000-000000008208',
  (select (payload->>'account_id')::uuid from phase6a2_state where state_key='tenant'),
  (select (payload->>'school_id')::uuid from phase6a2_state where state_key='tenant'),
  'C3','Unauthorized campus','CAF3','Unauthorized cafeteria')$$,
  '42501',null,'Authenticated caller without platform authority is denied');

select * from finish();
rollback;
