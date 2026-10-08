begin;
create extension if not exists pgtap with schema extensions;
set search_path=public,extensions;
select no_plan();

create temp table phase4c_state(test_key text primary key,test_value text not null);
grant select,insert,update,delete on phase4c_state to authenticated;

select is((select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relkind='r' and c.relrowsecurity),58::bigint,
  'RLS is enabled on all Phase 1 through Phase 4C public tables');
select is((select count(*) from pg_policies where schemaname='public' and cmd<>'SELECT'),0::bigint,
  'Phase 4C adds no direct-write RLS policy');
select is((select count(*) from public.cafeteria_memberships where role_code in ('pos_cashier','pos_supervisor')),4::bigint,
  'Fixtures keep cashier/supervisor roles as distinct exact-cafeteria memberships');
select is((select count(*) from public.cafeteria_registers),4::bigint,'Four logical registers are seeded');
select is((select count(*) from public.cafeteria_register_assignments),5::bigint,'Assignments are independent register-scoped rows');
select is((select count(*) from public.register_sessions),0::bigint,'No synthetic session history is invented');
select is((select count(*) from information_schema.columns where table_schema='public' and table_name='register_sessions'
  and column_name in ('expected_cash_minor','variance_minor','reconciled','reconciliation_status')),0::bigint,
  'Phase 4C stores no expected-cash/variance/reconciliation model');
select is((select count(*) from pg_indexes where schemaname='public' and indexname in
  ('register_sessions_one_open_per_register','register_sessions_one_open_per_person') and indexdef ilike '%where%status%open%'),2::bigint,
  'Partial unique indexes enforce one open session per register and globally per operator');
select ok(not has_table_privilege('authenticated','public.cafeteria_registers','INSERT') and
  not has_table_privilege('authenticated','public.cafeteria_registers','UPDATE') and
  not has_table_privilege('authenticated','public.cafeteria_registers','DELETE') and
  not has_table_privilege('authenticated','public.cafeteria_registers','TRUNCATE') and
  not has_table_privilege('authenticated','public.cafeteria_register_assignments','TRUNCATE') and
  not has_table_privilege('authenticated','public.register_sessions','SELECT') and
  not has_table_privilege('authenticated','public.register_sessions','INSERT') and
  not has_table_privilege('authenticated','public.register_sessions','UPDATE') and
  not has_table_privilege('authenticated','public.register_sessions','DELETE') and
  not has_table_privilege('authenticated','public.register_sessions','TRUNCATE'),
  'Operational tables expose no direct authenticated write or session-table read grants');
select ok(has_function_privilege('authenticated','public.open_register_session(uuid,uuid,bigint,text)','EXECUTE') and
  has_function_privilege('authenticated','public.get_my_open_register_session()','EXECUTE') and
  not has_function_privilege('anon','public.open_register_session(uuid,uuid,bigint,text)','EXECUTE') and
  not has_function_privilege('service_role','public.open_register_session(uuid,uuid,bigint,text)','EXECUTE'),
  'Session RPC execution is granted only to authenticated clients');
select ok(has_function_privilege('authenticated','pikas_private.pos_register_operator_can_read(uuid,uuid,uuid,uuid)','EXECUTE') and
  has_function_privilege('authenticated','pikas_private.is_pos_operator_membership(uuid,uuid,uuid,uuid,uuid,text)','EXECUTE') and
  not has_function_privilege('anon','pikas_private.pos_register_operator_can_read(uuid,uuid,uuid,uuid)','EXECUTE') and
  not has_function_privilege('service_role','pikas_private.is_pos_operator_membership(uuid,uuid,uuid,uuid,uuid,text)','EXECUTE'),
  'Only RLS-required private predicates are executable by authenticated, never anon/service_role');
select is((select count(*) from pikas_private.role_capabilities
  where role_code='pos_cashier' and capability in ('cafeteria:pos:catalog:read','cafeteria:customer:lookup',
    'cafeteria:pos:session:open','cafeteria:pos:session:read_own','cafeteria:pos:session:close_own')),
  5::bigint,'Cashier receives only narrow catalog/customer/own-session capabilities');
select ok(not exists(select 1 from pikas_private.role_capabilities where role_code='pos_cashier'
  and capability in ('cafeteria:registers:manage','cafeteria:register_assignments:manage',
    'cafeteria:pos:session:exceptional_close','cafeteria:refunds:approve','cafeteria:purchases:create')),
  'Cashier receives no management, recovery, purchase, or refund-approval capability');
select ok(not exists(select 1 from pikas_private.role_capabilities where role_code='pos_supervisor'
  and capability in ('cafeteria:registers:manage','cafeteria:register_assignments:manage',
    'cafeteria:pos:memberships:manage','cafeteria:refunds:approve')),
  'Supervisor is operational but receives no management or future refund approval authority');
select ok(not exists(select 1 from pikas_private.role_capabilities where role_code='pos_operator'
  and capability like 'cafeteria:pos:%'),'Reserved pos_operator remains without Phase 4C POS authority');
select is((select count(*) from pikas_private.role_capabilities where role_code='cafeteria_admin'
  and capability in ('cafeteria:pos:session:open','cafeteria:pos:catalog:read')),0::bigint,
  'Cafeteria Admin does not automatically become a POS operator');

select throws_ok($$insert into public.cafeteria_registers(id,account_id,school_id,school_location_id,cafeteria_id,register_code,display_name)
  values('00000000-0000-0000-0000-000000009410','00000000-0000-0000-0000-000000000002',
  '00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000211',
  '00000000-0000-0000-0000-000000000111','FORGED','Forged ancestry')$$,'23503',null,
  'Register composite ancestry rejects mismatched account');
select throws_ok($$insert into public.cafeteria_registers(id,account_id,school_id,school_location_id,cafeteria_id,register_code,display_name)
  values('00000000-0000-0000-0000-000000009410','00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000012','00000000-0000-0000-0000-000000000212',
  '00000000-0000-0000-0000-000000000111','FORGED','Forged campus')$$,'23503',null,
  'Register composite ancestry rejects another campus');
select throws_ok($$insert into public.cafeteria_registers(id,account_id,school_id,school_location_id,cafeteria_id,register_code,display_name)
  values('00000000-0000-0000-0000-000000009410','00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000213',
  '00000000-0000-0000-0000-000000000111','FORGED','Forged campus pair')$$,'23503',null,
  'Register composite FK rejects a valid but mismatched campus/cafeteria pair');
select is((select count(distinct cafeteria_id) from public.cafeteria_registers where code_key='caja-1'),3::bigint,
  'Normalized register code is unique within each cafeteria but reusable elsewhere');
select throws_ok($$insert into public.cafeteria_registers(account_id,school_id,school_location_id,cafeteria_id,register_code,display_name)
  values('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011',
  '00000000-0000-0000-0000-000000000211','00000000-0000-0000-0000-000000000111',' caja-1 ','Duplicate code')$$,
  '23505',null,'Case/whitespace register-code variants cannot duplicate within one cafeteria');
select throws_ok($$insert into public.cafeteria_registers(account_id,school_id,school_location_id,cafeteria_id,register_code,display_name)
  values('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011',
  '00000000-0000-0000-0000-000000000211','00000000-0000-0000-0000-000000000111','   ','Blank code')$$,
  '23514',null,'Blank register code is rejected');
select throws_ok($$insert into public.cafeteria_register_assignments(id,account_id,school_id,school_location_id,cafeteria_id,
  cafeteria_membership_id,operator_person_id,register_id)
  values('00000000-0000-0000-0000-000000009510','00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000211',
  '00000000-0000-0000-0000-000000000111','00000000-0000-0000-0000-000000004601',
  '00000000-0000-0000-0000-000000001008','00000000-0000-0000-0000-000000009403')$$,'23503',null,
  'Assignment composite FK rejects membership-to-register cross-cafeteria mapping');

reset role;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002003',true);
set local role authenticated;
select is((select count(*) from public.cafeteria_registers where cafeteria_id='00000000-0000-0000-0000-000000000111'),2::bigint,
  'Cafeteria Admin reads all registers only in assigned cafeteria');
select is((select count(*) from public.cafeteria_register_assignments where cafeteria_id='00000000-0000-0000-0000-000000000111'),3::bigint,
  'Cafeteria Admin reads exact-cafeteria assignments');
select is((select count(*) from public.cafeteria_registers where cafeteria_id='00000000-0000-0000-0000-000000000112'),0::bigint,
  'Cafeteria Admin cannot read a sibling cafeteria register');
select throws_ok($$select * from public.set_cafeteria_pos_membership('00000000-0000-0000-0000-000000000112',
  '00000000-0000-0000-0000-000000001005','pos_cashier','active')$$,'42501',null,
  'Cafeteria Admin cannot manage memberships in another cafeteria');
select throws_ok($$select * from public.set_cafeteria_pos_membership('00000000-0000-0000-0000-000000000113',
  '00000000-0000-0000-0000-000000001005','pos_cashier','active')$$,'42501',null,
  'Cafeteria Admin cannot manage a different campus cafeteria');
select throws_ok($$select * from public.set_cafeteria_pos_membership('00000000-0000-0000-0000-000000000121',
  '00000000-0000-0000-0000-000000001005','pos_cashier','active')$$,'42501',null,
  'Cafeteria Admin cannot manage a different account cafeteria');
reset role;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002001',true);
set local role authenticated;
select is((select count(*) from public.cafeteria_registers),0::bigint,
  'Account Admin has no implicit register access');
reset role;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002002',true);
set local role authenticated;
select is((select count(*) from public.cafeteria_register_assignments),0::bigint,
  'School Admin has no implicit POS assignment access');
reset role;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002007',true);
set local role authenticated;
select is((select count(*) from public.cafeteria_registers),0::bigint,
  'Reserved pos_operator customer lookup membership has no operational register access');
reset role;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002012',true);
set local role authenticated;
select is((select count(*) from public.cafeteria_register_assignments),0::bigint,
  'Staff affiliation alone has no register-assignment visibility');
reset role;
insert into auth.users(id,aud,role,email) values
  ('00000000-0000-0000-0000-000000002101','authenticated','authenticated','phase4c-student@example.invalid'),
  ('00000000-0000-0000-0000-000000002102','authenticated','authenticated','phase4c-guardian@example.invalid');
update public.persons set auth_user_id='00000000-0000-0000-0000-000000002101'
  where id='00000000-0000-0000-0000-000000005101';
update public.persons set auth_user_id='00000000-0000-0000-0000-000000002102'
  where id='00000000-0000-0000-0000-000000005103';
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002101',true);
set local role authenticated;
select is((select count(*) from public.cafeteria_registers),0::bigint,
  'Student identity has no direct register visibility');
reset role;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002102',true);
set local role authenticated;
select is((select count(*) from public.cafeteria_register_assignments),0::bigint,
  'Guardian relationship has no direct register-assignment visibility');
reset role;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002003',true);
set local role authenticated;
select lives_ok($$select * from public.set_cafeteria_pos_membership('00000000-0000-0000-0000-000000000111',
  '00000000-0000-0000-0000-000000001005','pos_cashier','active')$$,
  'Cafeteria Admin grants a narrow POS role to an existing Auth-linked person');
select lives_ok($$select * from public.set_cafeteria_pos_membership('00000000-0000-0000-0000-000000000111',
  '00000000-0000-0000-0000-000000001005','pos_cashier','active')$$,
  'Repeated POS membership grant is idempotent');
select is((select count(*) from public.cafeteria_memberships where person_id='00000000-0000-0000-0000-000000001005'
  and cafeteria_id='00000000-0000-0000-0000-000000000111' and role_code='pos_cashier' and status='active'),1::bigint,
  'POS role management preserves one membership per person/role/cafeteria');
select throws_ok($$select * from public.set_cafeteria_pos_membership('00000000-0000-0000-0000-000000000111',
  '00000000-0000-0000-0000-000000001005','cafeteria_admin','active')$$,'22023',null,
  'POS membership RPC cannot assign Cafeteria Admin');
select throws_ok($$select * from public.set_cafeteria_pos_membership('00000000-0000-0000-0000-000000000111',
  '00000000-0000-0000-0000-000000001005','school_admin','active')$$,'22023',null,
  'POS membership RPC cannot assign School Admin');
select throws_ok($$select * from public.set_cafeteria_pos_membership('00000000-0000-0000-0000-000000000111',
  '00000000-0000-0000-0000-000000001005','pos_operator','active')$$,'22023',null,
  'POS membership RPC cannot activate reserved pos_operator');
select throws_ok($$select * from public.set_cafeteria_pos_membership('00000000-0000-0000-0000-000000000111',
  '00000000-0000-0000-0000-000000001005','arbitrary_role','active')$$,'22023',null,
  'POS membership RPC rejects arbitrary roles');
reset role;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002008',true);
set local role authenticated;
select throws_ok($$select * from public.create_cafeteria_register('00000000-0000-0000-0000-000000000111',
  '00000000-0000-0000-0000-000000009410',' CAJA-3 ','Caja auxiliar')$$,
  '42501',null,'POS membership manager does not inherit register administration');
reset role;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002003',true);
set local role authenticated;
select lives_ok($$select * from public.create_cafeteria_register('00000000-0000-0000-0000-000000000111',
  '00000000-0000-0000-0000-000000009410',' CAJA-3 ','Caja auxiliar')$$,
  'Cafeteria Admin creates a logical register with normalized code');
select lives_ok($$select * from public.create_cafeteria_register('00000000-0000-0000-0000-000000000111',
  '00000000-0000-0000-0000-000000009410','CAJA-3','Caja auxiliar')$$,
  'Register creation retry returns the original register');
select throws_ok($$select * from public.create_cafeteria_register('00000000-0000-0000-0000-000000000111',
  '00000000-0000-0000-0000-000000009410','CAJA-3','Changed payload')$$,'23505',null,
  'Register UUID retry with changed payload is rejected');
select lives_ok($$select public.update_cafeteria_register('00000000-0000-0000-0000-000000000111',
  '00000000-0000-0000-0000-000000009410',1,'KIOSCO-3','Caja auxiliar renombrada','active')$$,
  'Register code/display may be corrected before any session history');
select throws_ok($$select public.update_cafeteria_register('00000000-0000-0000-0000-000000000111',
  '00000000-0000-0000-0000-000000009410',1,'KIOSCO-3','Stale','active')$$,'40001',null,
  'Stale register update is rejected');
select throws_ok($$select public.update_cafeteria_register('00000000-0000-0000-0000-000000000111',
  '00000000-0000-0000-0000-000000009410',null,'KIOSCO-3','Null version','active')$$,'40001',null,
  'NULL register version is rejected');
select throws_ok($$select * from public.create_cafeteria_register_assignment('00000000-0000-0000-0000-000000000111',
  '00000000-0000-0000-0000-000000009513','00000000-0000-0000-0000-000000003201',
  '00000000-0000-0000-0000-000000009401')$$,'23503',null,
  'Cafeteria Admin-only membership cannot be assigned as a POS operator');
select throws_ok($$select * from public.create_cafeteria_register_assignment('00000000-0000-0000-0000-000000000111',
  '00000000-0000-0000-0000-000000009513','00000000-0000-0000-0000-000000003101',
  '00000000-0000-0000-0000-000000009401')$$,'23503',null,
  'School Admin membership cannot be assigned as a POS operator');
select throws_ok($$select * from public.create_cafeteria_register_assignment('00000000-0000-0000-0000-000000000111',
  '00000000-0000-0000-0000-000000009513','00000000-0000-0000-0000-000000003001',
  '00000000-0000-0000-0000-000000009401')$$,'23503',null,
  'Account Admin membership cannot be assigned as a POS operator');
select throws_ok($$select * from public.create_cafeteria_register_assignment('00000000-0000-0000-0000-000000000111',
  '00000000-0000-0000-0000-000000009513','00000000-0000-0000-0000-000000003203',
  '00000000-0000-0000-0000-000000009401')$$,'23503',null,
  'Reserved pos_operator membership cannot be assigned to a register');
select throws_ok($$select * from public.create_cafeteria_register_assignment('00000000-0000-0000-0000-000000000111',
  '00000000-0000-0000-0000-000000009513','00000000-0000-0000-0000-000000003202',
  '00000000-0000-0000-0000-000000009401')$$,'23503',null,
  'Unrelated cafeteria membership cannot be assigned across cafeterias');
select lives_ok($$select * from public.create_cafeteria_register_assignment('00000000-0000-0000-0000-000000000111',
  '00000000-0000-0000-0000-000000009510','00000000-0000-0000-0000-000000004601',
  '00000000-0000-0000-0000-000000009410')$$,'Admin assigns the cashier to a second register');
select lives_ok($$select * from public.create_cafeteria_register_assignment('00000000-0000-0000-0000-000000000111',
  '00000000-0000-0000-0000-000000009510','00000000-0000-0000-0000-000000004601',
  '00000000-0000-0000-0000-000000009410')$$,'Assignment create retry returns the same membership/register pair');
select throws_ok($$select public.update_cafeteria_register_assignment('00000000-0000-0000-0000-000000000111',
  '00000000-0000-0000-0000-000000009510',null,'inactive')$$,'40001',null,
  'NULL assignment version is rejected');
select throws_ok($$select public.update_cafeteria_register_assignment('00000000-0000-0000-0000-000000000111',
  '00000000-0000-0000-0000-000000009510',0,'inactive')$$,'40001',null,
  'Stale assignment version is rejected');
select lives_ok($$insert into phase4c_state(test_key,test_value)
  select 'cashier_supervisor_membership',membership_id::text
  from public.set_cafeteria_pos_membership('00000000-0000-0000-0000-000000000111',
    '00000000-0000-0000-0000-000000001008','pos_supervisor','active')$$,
  'One person may also hold Supervisor alongside Cashier in the same cafeteria');
select is((select count(*) from public.cafeteria_memberships where person_id='00000000-0000-0000-0000-000000001008'
  and cafeteria_id='00000000-0000-0000-0000-000000000111' and role_code='pos_supervisor' and status='active'),1::bigint,
  'Second operational role creates its own exact-cafeteria membership row');
reset role;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002005',true);
set local role authenticated;
select is((select count(*) from public.cafeteria_register_assignments),0::bigint,
  'Cashier with no exact active assignment cannot see another operator assignment');
select is((select count(*) from public.cafeteria_registers where cafeteria_id='00000000-0000-0000-0000-000000000111'),0::bigint,
  'Cashier with no exact active assignment cannot see cafeteria registers');
select throws_ok($$select * from public.open_register_session('00000000-0000-0000-0000-000000009401',
  '00000000-0000-0000-0000-000000009501',0,'phase4c-no-assignment-open-0001')$$,'42501',null,
  'POS capability without an active exact assignment cannot open a session');
reset role;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002003',true);
set local role authenticated;
select lives_ok($$select * from public.create_cafeteria_register_assignment('00000000-0000-0000-0000-000000000111',
  '00000000-0000-0000-0000-000000009511',(select test_value::uuid from phase4c_state
    where test_key='cashier_supervisor_membership'),
  '00000000-0000-0000-0000-000000009401')$$,'Multi-role operator can have an assignment tied to the second membership');
select lives_ok($$select * from public.create_cafeteria_register_assignment('00000000-0000-0000-0000-000000000111',
  '00000000-0000-0000-0000-000000009512',(select test_value::uuid from phase4c_state
    where test_key='cashier_supervisor_membership'),
  '00000000-0000-0000-0000-000000009402')$$,'Supervisor membership can be assigned a separate same-cafeteria register');
select is((select count(*) from public.cafeteria_register_assignments
  where id='00000000-0000-0000-0000-000000009511'),1::bigint,
  'Second role assignment persists under its distinct membership identity');
select is((select array_agg(id order by id) from public.cafeteria_register_assignments
  where operator_person_id='00000000-0000-0000-0000-000000001008'
    and cafeteria_id='00000000-0000-0000-0000-000000000111'),
  array['00000000-0000-0000-0000-000000009501'::uuid,'00000000-0000-0000-0000-000000009502'::uuid,
    '00000000-0000-0000-0000-000000009510'::uuid,'00000000-0000-0000-0000-000000009511'::uuid,
    '00000000-0000-0000-0000-000000009512'::uuid],
  'Cafeteria Admin sees role-specific assignments only in the assigned cafeteria');
reset role;
update public.cafeteria_memberships set status='suspended' where id='00000000-0000-0000-0000-000000004601';
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002008',true);
set local role authenticated;
select is((select count(*) from public.cafeteria_register_assignments
  where operator_person_id='00000000-0000-0000-0000-000000001008'
    and cafeteria_id='00000000-0000-0000-0000-000000000111'),2::bigint,
  'Assignment RLS hides rows whose exact backing POS membership is suspended');
select is((select count(*) from public.list_my_operable_registers()
  where cafeteria_id='00000000-0000-0000-0000-000000000111'),2::bigint,
  'Active second role retains only its two exact membership assignments');
reset role;
update public.cafeteria_memberships set status='active' where id='00000000-0000-0000-0000-000000004601';
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002003',true);
set local role authenticated;

reset role;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002008',true);
set local role authenticated;
select ok(pikas_private.is_pos_operator_membership('00000000-0000-0000-0000-000000004602',
  '00000000-0000-0000-0000-000000001008','00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000012','00000000-0000-0000-0000-000000000112',
  'cafeteria:pos:session:open'),'Exact Cafeteria B membership has active POS authority');
select ok(not pikas_private.is_pos_operator_membership('00000000-0000-0000-0000-000000004603',
  '00000000-0000-0000-0000-000000001011','00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000111',
  'cafeteria:pos:session:open'),'RLS capability helper cannot probe another person membership');
select ok(exists(select 1 from public.cafeteria_register_assignments where id='00000000-0000-0000-0000-000000009504'),
  'RLS exposes the exact Cafeteria B assignment for its assigned operator');
select lives_ok($$select public.get_cafeteria_saleable_catalog('00000000-0000-0000-0000-000000000111')$$,
  'Cashier may read exact-cafeteria saleability through the additive Phase 4C capability');
select is((select count(*) from public.cafeteria_customer_projection(
  '00000000-0000-0000-0000-000000000111','STU-001')),1::bigint,
  'Cashier customer lookup still resolves only explicitly shared exact-cafeteria customers');
select throws_ok($$select public.get_cafeteria_saleable_catalog('00000000-0000-0000-0000-000000000113')$$,
  '42501',null,'Cashier cannot read catalog saleability for a different cafeteria');
select is((select count(*) from public.cafeteria_customer_projection(
  '00000000-0000-0000-0000-000000000113','STU-001')),0::bigint,
  'Cashier lookup cannot bypass sibling cafeteria sharing controls');
select is((select count(*) from public.cafeteria_registers where cafeteria_id='00000000-0000-0000-0000-000000000111'),3::bigint,
  'Assigned POS memberships read only their assigned cafeteria registers');
select is((select count(*) from public.cafeteria_registers where cafeteria_id='00000000-0000-0000-0000-000000000112'),1::bigint,
  'A separate POS membership reads its exact-cafeteria assigned register');
select is((select count(*) from public.cafeteria_registers where cafeteria_id='00000000-0000-0000-0000-000000000113'),0::bigint,
  'Cashier cannot read a cafeteria without a membership/assignment');
select is((select count(*) from public.list_my_operable_registers()),6::bigint,
  'One person can list multiple explicitly assigned registers across two cafeterias');
select is((select count(*) from public.get_my_open_register_session()),0::bigint,
  'Cashier starts with no open durable session');
reset role;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002005',true);
set local role authenticated;
select throws_ok($$select public.get_cafeteria_open_register_sessions('00000000-0000-0000-0000-000000000111')$$,
  '42501',null,'Cashier-only membership cannot view other operators open sessions');
reset role;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002008',true);
set local role authenticated;
select throws_ok($$select * from public.open_register_session('00000000-0000-0000-0000-000000009401',
  '00000000-0000-0000-0000-000000009501',-1,'phase4c-invalid-opening-key')$$,'22023',null,
  'Negative opening cash is rejected');
select throws_ok($$select * from public.open_register_session('00000000-0000-0000-0000-000000009401',
  '00000000-0000-0000-0000-000000009501',9223372036854775808::bigint,'phase4c-overflow-opening-key')$$,
  '22003',null,'Opening cash overflow beyond BIGINT is rejected');
select throws_ok($$select * from public.open_register_session('00000000-0000-0000-0000-000000009401',
  '00000000-0000-0000-0000-000000009501',0,'short')$$,'22023',null,
  'Short session-open request key is rejected');
reset role;
update public.supported_currencies set status='disabled' where currency_code='DOP';
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002008',true);
set local role authenticated;
select throws_ok($$select * from public.open_register_session('00000000-0000-0000-0000-000000009401',
  '00000000-0000-0000-0000-000000009501',0,'phase4c-disabled-currency-open')$$,'23514',null,
  'Disabled catalog currency blocks a new session');
reset role;
update public.supported_currencies set status='enabled' where currency_code='DOP';
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002003',true);
set local role authenticated;
select ok(pikas_private.has_capability('cafeteria:catalog:manage','00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000111'),
  'Scheduling toggle test actor is an authorized exact-cafeteria Admin');
select lives_ok($$select * from public.update_cafeteria_catalog_settings('00000000-0000-0000-0000-000000000111',true,1)$$,
  'Scheduling may be ON before register opening');
reset role;
update public.cafeteria_service_shifts set enabled=false where cafeteria_id='00000000-0000-0000-0000-000000000111';
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002008',true);
set local role authenticated;
select lives_ok($$select * from public.open_register_session('00000000-0000-0000-0000-000000009401',
  '00000000-0000-0000-0000-000000009501',0,'phase4c-open-cashier-register-0001')$$,
  'Cashier opens with zero cash even with no active service window');
select lives_ok($$select * from public.open_register_session('00000000-0000-0000-0000-000000009401',
  '00000000-0000-0000-0000-000000009501',0,'phase4c-open-cashier-register-0001')$$,
  'Same open key and payload returns the same session');
select throws_ok($$select * from public.open_register_session('00000000-0000-0000-0000-000000009401',
  '00000000-0000-0000-0000-000000009511',0,'phase4c-open-cashier-register-0001')$$,'23505',null,
  'Same person same cafeteria different membership cannot reuse an open key');
select throws_ok($$select * from public.open_register_session('00000000-0000-0000-0000-000000009402',
  '00000000-0000-0000-0000-000000009502',0,'phase4c-open-cashier-register-0001')$$,'23505',null,
  'Open idempotency fingerprint binds the exact register and assignment');
select throws_ok($$select * from public.open_register_session('00000000-0000-0000-0000-000000009401',
  '00000000-0000-0000-0000-000000009501',1,'phase4c-open-cashier-register-0001')$$,'23505',null,
  'Open retry with changed opening cash rejects');
select throws_ok($$select * from public.open_register_session('00000000-0000-0000-0000-000000009402',
  '00000000-0000-0000-0000-000000009502',0,'phase4c-open-cashier-register-0002')$$,'23505',null,
  'One operator cannot open a second register session simultaneously');
select throws_ok($$select * from public.open_register_session('00000000-0000-0000-0000-000000009402',
  '00000000-0000-0000-0000-000000009512',0,'phase4c-open-same-person-second-role-0002')$$,'23505',null,
  'One person cannot open another register through a second role in the same cafeteria');
reset role;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002011',true);
set local role authenticated;
select throws_ok($$select * from public.open_register_session('00000000-0000-0000-0000-000000009401',
  '00000000-0000-0000-0000-000000009503',0,'phase4c-other-cashier-same-register')$$,'23505',null,
  'A second operator cannot open a register already in session');
select throws_ok($$select * from public.open_register_session('00000000-0000-0000-0000-000000009401',
  '00000000-0000-0000-0000-000000009503',0,'phase4c-open-cashier-register-0001')$$,'23505',null,
  'Another actor cannot replay or inspect an existing open request key');
reset role;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002008',true);
set local role authenticated;
select throws_ok($$select * from public.open_register_session('00000000-0000-0000-0000-000000009403',
  '00000000-0000-0000-0000-000000009504',0,'phase4c-same-operator-other-cafe')$$,'23505',null,
  'Global operator uniqueness blocks simultaneous sessions in two cafeterias');
select is((select currency_code from public.get_my_open_register_session()),'DOP',
  'Session snapshots enabled cafeteria currency');
select is((select opened_business_date=(opened_at at time zone business_timezone_snapshot)::date
  from public.get_my_open_register_session()),true,'Session snapshots local business date/timezone');
select is((timestamptz '2026-01-02 03:30:00+00' at time zone 'America/Santo_Domingo')::date,
  date '2026-01-01','UTC-to-business-timezone conversion handles local-date rollover');
select is((select register_code_snapshot from public.get_my_open_register_session()),'CAJA-1',
  'Session snapshots original register code');
select set_config('phase4c.session_id',(select session_id::text from public.get_my_open_register_session()),true);
select throws_ok($$select * from public.close_my_register_session(
  current_setting('phase4c.session_id')::uuid,0,0,'phase4c-stale-owner-close-0001')$$,
  '40001',null,'Stale normal-close session version is rejected');
reset role;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002011',true);
set local role authenticated;
select throws_ok($$select * from public.close_my_register_session(current_setting('phase4c.session_id')::uuid,1,0,
  'phase4c-non-owner-close-0001')$$,'42501',null,'Another authorized operator cannot normal-close the owner session');
reset role;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002011',true);
set local role authenticated;
select is((select count(*) from public.get_cafeteria_open_register_sessions('00000000-0000-0000-0000-000000000111')),1::bigint,
  'Supervisor operational projection sees the open cafeteria session');
select is((select count(*) from public.get_my_open_register_session()),0::bigint,
  'Supervisor owner projection does not expose another operators open session');
select throws_ok($$select * from public.open_register_session('00000000-0000-0000-0000-000000009401',
  '00000000-0000-0000-0000-000000009503',0,'phase4c-other-cashier-same-register')$$,'23505',null,
  'A second operator cannot open a register already in session');
reset role;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002008',true);
set local role authenticated;
select throws_ok($$select * from public.open_register_session('00000000-0000-0000-0000-000000009403',
  '00000000-0000-0000-0000-000000009504',0,'phase4c-same-operator-other-cafe')$$,'23505',null,
  'Global operator uniqueness blocks simultaneous sessions in two cafeterias');
reset role;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002003',true);
set local role authenticated;
select lives_ok($$select public.update_cafeteria_register('00000000-0000-0000-0000-000000000111',
  '00000000-0000-0000-0000-000000009401',1,'CAJA-1','Caja renombrada','active')$$,
  'Register display name may change while preserving stable UUID');
select throws_ok($$select public.update_cafeteria_register('00000000-0000-0000-0000-000000000111',
  '00000000-0000-0000-0000-000000009401',2,'CAJA-UNO','Caja renombrada','active')$$,'23514',null,
  'Register code becomes immutable after session history exists');
reset role;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002008',true);
set local role authenticated;
select is((select register_name_snapshot from public.get_my_open_register_session()),'Caja 1',
  'Register rename does not rewrite an open session snapshot');
select lives_ok($$select * from public.close_my_register_session(
  current_setting('phase4c.session_id')::uuid,1,0,
  'phase4c-close-owner-session-0001')$$,'Original operator normally closes own session with zero counted cash');
select lives_ok($$select * from public.close_my_register_session(
  current_setting('phase4c.session_id')::uuid,1,0,
  'phase4c-close-owner-session-0001')$$,'Same normal close request/payload is idempotent');
reset role;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002003',true);
set local role authenticated;
select throws_ok($$select public.update_cafeteria_register('00000000-0000-0000-0000-000000000111',
  '00000000-0000-0000-0000-000000009401',2,'CAJA-UNO','Caja renombrada','active')$$,'23514',null,
  'Register code remains immutable after closed session history');
reset role;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002008',true);
set local role authenticated;
select throws_ok($$select * from public.close_my_register_session(
  current_setting('phase4c.session_id')::uuid,1,100,
  'phase4c-close-owner-session-0001')$$,'23505',null,'Changed counted cash cannot retry a closed session');
select throws_ok($$select * from public.close_my_register_session(
  current_setting('phase4c.session_id')::uuid,null,0,
  'phase4c-close-owner-session-0001')$$,'40001',null,'NULL version is rejected even on a close retry');
select throws_ok($$select * from public.close_my_register_session(
  current_setting('phase4c.session_id')::uuid,1,-1,'phase4c-negative-count-0001')$$,
  '22023',null,'Negative counted cash is rejected');
select lives_ok($$select * from public.open_register_session('00000000-0000-0000-0000-000000009401',
  '00000000-0000-0000-0000-000000009501',9223372036854775807::bigint,'phase4c-bigint-max-open-0001')$$,
  'Maximum valid BIGINT opening cash is accepted');
select set_config('phase4c.max_session_id',(select session_id::text from public.get_my_open_register_session()),true);
select lives_ok($$select * from public.close_my_register_session(
  current_setting('phase4c.max_session_id')::uuid,1,9223372036854775807::bigint,
  'phase4c-bigint-max-close-0001')$$,'Maximum valid BIGINT counted cash is accepted');
reset role;
select is((select status='closed' and close_type='normal' and counted_cash_minor=0
  and closed_by_person_id='00000000-0000-0000-0000-000000001008'
  from public.register_sessions where open_request_key='phase4c-open-cashier-register-0001'),true,
  'Normal close preserves owner and immutable zero-count evidence');
select throws_ok($$update public.register_sessions set counted_cash_minor=5
  where open_request_key='phase4c-open-cashier-register-0001'$$,'23514',null,
  'Closed session cash evidence is immutable');
select throws_ok($$update public.register_sessions set operator_person_id='00000000-0000-0000-0000-000000001011'
  where open_request_key='phase4c-open-cashier-register-0001'$$,'23514',null,
  'Closed session original operator is immutable');
select throws_ok($$update public.register_sessions set status='open'
  where open_request_key='phase4c-open-cashier-register-0001'$$,'23514',null,
  'Closed session cannot be reopened');
select throws_ok($$insert into public.register_sessions(account_id,school_id,school_location_id,cafeteria_id,register_id,
  assignment_id,operator_membership_id,operator_person_id,operator_role_code,register_code_snapshot,register_name_snapshot,
  opened_at,opened_business_date,business_timezone_snapshot,currency_code,opening_cash_minor,status,closed_at,
  closed_by_person_id,counted_cash_minor,close_type,open_request_key,open_payload_fingerprint,close_request_key,
  close_payload_fingerprint,version)
  values('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011',
  '00000000-0000-0000-0000-000000000211','00000000-0000-0000-0000-000000000111',
  '00000000-0000-0000-0000-000000009401','00000000-0000-0000-0000-000000009501',
  '00000000-0000-0000-0000-000000004602','00000000-0000-0000-0000-000000001008','pos_supervisor',
  'CAJA-1','Caja 1','2026-01-01 12:00:00+00','2026-01-01','America/Santo_Domingo','DOP',0,
  'open',null,null,null,null,'phase4c-malformed-session-owner-0001',repeat('a',64),null,null,1)$$,
  '23503',null,'Session composite assignment FK rejects a different role membership than the assignment');
select throws_ok($$insert into public.register_sessions(account_id,school_id,school_location_id,cafeteria_id,register_id,
  assignment_id,operator_membership_id,operator_person_id,operator_role_code,register_code_snapshot,register_name_snapshot,
  opened_at,opened_business_date,business_timezone_snapshot,currency_code,opening_cash_minor,status,closed_at,
  closed_by_person_id,counted_cash_minor,close_type,open_request_key,open_payload_fingerprint,close_request_key,
  close_payload_fingerprint,version)
  values('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011',
  '00000000-0000-0000-0000-000000000211','00000000-0000-0000-0000-000000000111',
  '00000000-0000-0000-0000-000000009401','00000000-0000-0000-0000-000000009501',
  '00000000-0000-0000-0000-000000004601','00000000-0000-0000-0000-000000001008','pos_cashier',
  'CAJA-1','Caja 1','2026-01-01 12:00:00+00','2026-01-01','America/Santo_Domingo','DOP',0,
  'closed','2026-01-01 12:00:00+00','00000000-0000-0000-0000-000000001011',0,'normal',
  'phase4c-malformed-normal-actor-0001',repeat('a',64),'phase4c-malformed-normal-close-0001',repeat('b',64),2)$$,
  '23514',null,'Database constraint rejects a non-owner as normal closer');
select throws_ok($$insert into public.register_sessions(account_id,school_id,school_location_id,cafeteria_id,register_id,
  assignment_id,operator_membership_id,operator_person_id,operator_role_code,register_code_snapshot,register_name_snapshot,
  opened_at,opened_business_date,business_timezone_snapshot,currency_code,opening_cash_minor,status,closed_at,
  closed_by_person_id,counted_cash_minor,close_type,close_reason_code,open_request_key,open_payload_fingerprint,
  close_request_key,close_payload_fingerprint,version)
  values('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011',
  '00000000-0000-0000-0000-000000000211','00000000-0000-0000-0000-000000000111',
  '00000000-0000-0000-0000-000000009401','00000000-0000-0000-0000-000000009501',
  '00000000-0000-0000-0000-000000004601','00000000-0000-0000-0000-000000001008','pos_cashier',
  'CAJA-1','Caja 1','2026-01-01 12:00:00+00','2026-01-01','America/Santo_Domingo','DOP',0,
  'closed','2026-01-01 12:00:00+00','00000000-0000-0000-0000-000000001008',0,'exceptional',
  'administrative_recovery','phase4c-malformed-exception-owner-0001',repeat('a',64),
  'phase4c-malformed-exception-close-0001',repeat('b',64),2)$$,
  '23514',null,'Database constraint rejects exceptional close by the original owner');

set local role authenticated;
select lives_ok($$select * from public.open_register_session('00000000-0000-0000-0000-000000009401',
  '00000000-0000-0000-0000-000000009501',0,'phase4c-open-owner-revocation-0002')$$,
  'Owner opens a second session before access revocation');
select set_config('phase4c.session_id',(select session_id::text from public.get_my_open_register_session()),true);
reset role;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002003',true);
set local role authenticated;
select lives_ok($$select * from public.set_cafeteria_pos_membership('00000000-0000-0000-0000-000000000111',
  '00000000-0000-0000-0000-000000001008','pos_cashier','suspended')$$,
  'Admin may suspend POS membership without deleting its assignments');
select lives_ok($$select * from public.set_cafeteria_pos_membership('00000000-0000-0000-0000-000000000111',
  '00000000-0000-0000-0000-000000001008','pos_supervisor','suspended')$$,
  'Admin suspends the original operator other same-cafeteria POS role too');
select lives_ok($$select public.update_cafeteria_register_assignment('00000000-0000-0000-0000-000000000111',
  '00000000-0000-0000-0000-000000009501',1,'inactive')$$,
  'Admin may deactivate assignment while its session is open');
select lives_ok($$select public.update_cafeteria_register_assignment('00000000-0000-0000-0000-000000000111',
  '00000000-0000-0000-0000-000000009511',1,'inactive')$$,
  'Admin deactivates the second role assignment without deleting it');
select lives_ok($$select public.update_cafeteria_register_assignment('00000000-0000-0000-0000-000000000111',
  '00000000-0000-0000-0000-000000009512',1,'inactive')$$,
  'Admin deactivates the second-role second-register assignment');
select is((select count(*) from public.cafeteria_register_assignments
  where id in ('00000000-0000-0000-0000-000000009501','00000000-0000-0000-0000-000000009511',
    '00000000-0000-0000-0000-000000009512')),3::bigint,
  'POS membership revocation and assignment deactivation preserve assignment history');
reset role;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002008',true);
set local role authenticated;
select throws_ok($$select * from public.open_register_session('00000000-0000-0000-0000-000000009401',
  '00000000-0000-0000-0000-000000009501',0,'phase4c-inactive-assignment-open')$$,'42501',null,
  'Inactive assignment blocks new session even while register remains active');
select throws_ok($$select * from public.open_register_session('00000000-0000-0000-0000-000000009401',
  '00000000-0000-0000-0000-000000009501',0,'phase4c-open-cashier-register-0001')$$,'42501',null,
  'Exact open idempotency retry rechecks membership and assignment authority');
reset role;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002003',true);
set local role authenticated;
select lives_ok($$select public.update_cafeteria_register('00000000-0000-0000-0000-000000000111',
  '00000000-0000-0000-0000-000000009401',2,'CAJA-1','Caja renombrada','inactive')$$,
  'Admin may deactivate register while its session remains open');
reset role;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002008',true);
set local role authenticated;
select is((select count(*) from public.get_my_open_register_session()),1::bigint,
  'Original active person retains own-session visibility after all exact-cafeteria POS roles and assignments are revoked');
select throws_ok($$select public.get_cafeteria_saleable_catalog('00000000-0000-0000-0000-000000000111')$$,
  '42501',null,'Close-only owner cannot retain catalog access after POS revocation');
select is((select count(*) from public.cafeteria_customer_projection(
  '00000000-0000-0000-0000-000000000111','STU-001')),0::bigint,
  'Close-only owner cannot retain customer lookup after POS revocation');
select throws_ok($$select * from public.open_register_session('00000000-0000-0000-0000-000000009401',
  '00000000-0000-0000-0000-000000009501',0,'phase4c-revoked-new-open-0003')$$,'23514',null,
  'Revoked operator cannot open another session');
select lives_ok($$select * from public.close_my_register_session(
  current_setting('phase4c.session_id')::uuid,1,0,
  'phase4c-owner-close-after-revocation-0002')$$,
  'Authenticated original owner retains close-only authority after all operational revocations');
reset role;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002003',true);
set local role authenticated;
select lives_ok($$select * from public.set_cafeteria_pos_membership('00000000-0000-0000-0000-000000000111',
  '00000000-0000-0000-0000-000000001008','pos_cashier','active')$$,'Admin reactivates cashier role');
select lives_ok($$select * from public.set_cafeteria_pos_membership('00000000-0000-0000-0000-000000000111',
  '00000000-0000-0000-0000-000000001008','pos_supervisor','active')$$,'Admin reactivates the second POS role');
select lives_ok($$select public.update_cafeteria_register('00000000-0000-0000-0000-000000000111',
  '00000000-0000-0000-0000-000000009401',3,'CAJA-1','Caja renombrada','active')$$,'Admin reactivates register');
select lives_ok($$select public.update_cafeteria_register_assignment('00000000-0000-0000-0000-000000000111',
  '00000000-0000-0000-0000-000000009501',2,'active')$$,'Admin reactivates register assignment');
select lives_ok($$select public.update_cafeteria_register_assignment('00000000-0000-0000-0000-000000000111',
  '00000000-0000-0000-0000-000000009511',2,'active')$$,'Admin reactivates the second role assignment');
select lives_ok($$select public.update_cafeteria_register_assignment('00000000-0000-0000-0000-000000000111',
  '00000000-0000-0000-0000-000000009512',2,'active')$$,'Admin reactivates the second-role second-register assignment');
reset role;

select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002008',true);
set local role authenticated;
select lives_ok($$select * from public.open_register_session('00000000-0000-0000-0000-000000009401',
  '00000000-0000-0000-0000-000000009501',0,'phase4c-open-inactive-normal-close-0002')$$,
  'Operator opens before normal close with inactive-tenant test');
select set_config('phase4c.session_id',(select session_id::text from public.get_my_open_register_session()),true);
reset role;
update public.cafeterias set status='inactive' where id='00000000-0000-0000-0000-000000000111';
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002008',true);
set local role authenticated;
select lives_ok($$select * from public.close_my_register_session(current_setting('phase4c.session_id')::uuid,1,0,
  'phase4c-owner-close-inactive-tenant-0002')$$,
  'Original authenticated owner retains normal close-only authority when cafeteria is inactive');
reset role;
update public.cafeterias set status='active' where id='00000000-0000-0000-0000-000000000111';

select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002008',true);
set local role authenticated;
select lives_ok($$select * from public.open_register_session('00000000-0000-0000-0000-000000009401',
  '00000000-0000-0000-0000-000000009501',0,'phase4c-open-inactive-campus-0002')$$,
  'Operator opens before inactive-campus close-only test');
select set_config('phase4c.session_id',(select session_id::text from public.get_my_open_register_session()),true);
reset role;
update public.school_locations set status='inactive' where id='00000000-0000-0000-0000-000000000211';
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002008',true);
set local role authenticated;
select is((select count(*) from public.get_my_open_register_session()),1::bigint,
  'Owner can still see own open session when campus is inactive');
select lives_ok($$select * from public.close_my_register_session(current_setting('phase4c.session_id')::uuid,1,0,
  'phase4c-owner-close-inactive-campus-0002')$$,'Owner can close own session when campus is inactive');
select throws_ok($$select * from public.open_register_session('00000000-0000-0000-0000-000000009401',
  '00000000-0000-0000-0000-000000009501',0,'phase4c-new-open-inactive-campus-0002')$$,'42501',null,
  'Inactive campus blocks new session opening');
reset role;
update public.school_locations set status='active' where id='00000000-0000-0000-0000-000000000211';

select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002008',true);
set local role authenticated;
select lives_ok($$select * from public.open_register_session('00000000-0000-0000-0000-000000009401',
  '00000000-0000-0000-0000-000000009501',0,'phase4c-open-inactive-school-0002')$$,
  'Operator opens before inactive-school close-only test');
select set_config('phase4c.session_id',(select session_id::text from public.get_my_open_register_session()),true);
reset role;
update public.schools set status='inactive' where id='00000000-0000-0000-0000-000000000011';
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002008',true);
set local role authenticated;
select is((select count(*) from public.get_my_open_register_session()),1::bigint,
  'Owner can still see own open session when school is inactive');
select lives_ok($$select * from public.close_my_register_session(current_setting('phase4c.session_id')::uuid,1,0,
  'phase4c-owner-close-inactive-school-0002')$$,'Owner can close own session when school is inactive');
select throws_ok($$select * from public.open_register_session('00000000-0000-0000-0000-000000009401',
  '00000000-0000-0000-0000-000000009501',0,'phase4c-new-open-inactive-school-0002')$$,'42501',null,
  'Inactive school blocks new session opening');
reset role;
update public.schools set status='active' where id='00000000-0000-0000-0000-000000000011';

select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002008',true);
set local role authenticated;
select lives_ok($$select * from public.open_register_session('00000000-0000-0000-0000-000000009401',
  '00000000-0000-0000-0000-000000009501',0,'phase4c-open-inactive-account-0002')$$,
  'Operator opens before inactive-account close-only test');
select set_config('phase4c.session_id',(select session_id::text from public.get_my_open_register_session()),true);
reset role;
update public.accounts set status='inactive' where id='00000000-0000-0000-0000-000000000001';
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002008',true);
set local role authenticated;
select is((select count(*) from public.get_my_open_register_session()),1::bigint,
  'Owner can still see own open session when account is inactive');
select lives_ok($$select * from public.close_my_register_session(current_setting('phase4c.session_id')::uuid,1,0,
  'phase4c-owner-close-inactive-account-0002')$$,'Owner can close own session when account is inactive');
select throws_ok($$select * from public.open_register_session('00000000-0000-0000-0000-000000009401',
  '00000000-0000-0000-0000-000000009501',0,'phase4c-new-open-inactive-account-0002')$$,'42501',null,
  'Inactive account blocks new session opening');
reset role;
update public.accounts set status='active' where id='00000000-0000-0000-0000-000000000001';

select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002008',true);
set local role authenticated;
select lives_ok($$select * from public.open_register_session('00000000-0000-0000-0000-000000009401',
  '00000000-0000-0000-0000-000000009501',0,'phase4c-open-cashier-recovery-denial-0002')$$,
  'Cashier opens before recovery-capability denial test');
select set_config('phase4c.session_id',(select session_id::text from public.get_my_open_register_session()),true);
reset role;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002005',true);
set local role authenticated;
select throws_ok($$select * from public.exceptionally_close_register_session(
  current_setting('phase4c.session_id')::uuid,1,0,'administrative_recovery',null,
  'phase4c-cashier-recovery-denial-0002')$$,'42501',null,
  'Cashier without exceptional-close capability cannot recover another session');
reset role;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002011',true);
set local role authenticated;
select lives_ok($$select * from public.exceptionally_close_register_session(
  current_setting('phase4c.session_id')::uuid,1,0,'administrative_recovery',null,
  'phase4c-supervisor-close-after-cashier-denial-0002')$$,
  'Exact-cafeteria Supervisor can recover after cashier denial');

select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002003',true);
set local role authenticated;
select lives_ok($$select * from public.set_cafeteria_pos_membership('00000000-0000-0000-0000-000000000111',
  '00000000-0000-0000-0000-000000001005','pos_supervisor','active')$$,
  'Admin grants a recovery-only Supervisor membership to a Cashier without Admin rights');
reset role;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002008',true);
set local role authenticated;
select lives_ok($$select * from public.open_register_session('00000000-0000-0000-0000-000000009401',
  '00000000-0000-0000-0000-000000009501',0,'phase4c-open-exception-campus-0002')$$,
  'Operator opens before exceptional close with inactive campus');
select set_config('phase4c.session_id',(select session_id::text from public.get_my_open_register_session()),true);
reset role;
update public.school_locations set status='inactive' where id='00000000-0000-0000-0000-000000000211';
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002005',true);
set local role authenticated;
select lives_ok($$select * from public.exceptionally_close_register_session(
  current_setting('phase4c.session_id')::uuid,1,0,'administrative_recovery',null,
  'phase4c-exception-supervisor-inactive-campus-0002')$$,
  'Exact-cafeteria Supervisor recovery works when campus is inactive');
reset role;
update public.school_locations set status='active' where id='00000000-0000-0000-0000-000000000211';

select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002008',true);
set local role authenticated;
select lives_ok($$select * from public.open_register_session('00000000-0000-0000-0000-000000009401',
  '00000000-0000-0000-0000-000000009501',0,'phase4c-open-exception-school-0002')$$,
  'Operator opens before exceptional close with inactive school');
select set_config('phase4c.session_id',(select session_id::text from public.get_my_open_register_session()),true);
reset role;
update public.schools set status='inactive' where id='00000000-0000-0000-0000-000000000011';
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002005',true);
set local role authenticated;
select lives_ok($$select * from public.exceptionally_close_register_session(
  current_setting('phase4c.session_id')::uuid,1,0,'administrative_recovery',null,
  'phase4c-exception-supervisor-inactive-school-0002')$$,
  'Exact-cafeteria Supervisor recovery works when school is inactive');
reset role;
update public.schools set status='active' where id='00000000-0000-0000-0000-000000000011';

select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002008',true);
set local role authenticated;
select lives_ok($$select * from public.open_register_session('00000000-0000-0000-0000-000000009401',
  '00000000-0000-0000-0000-000000009501',0,'phase4c-open-exception-account-0002')$$,
  'Operator opens before exceptional close with inactive account');
select set_config('phase4c.session_id',(select session_id::text from public.get_my_open_register_session()),true);
reset role;
update public.accounts set status='inactive' where id='00000000-0000-0000-0000-000000000001';
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002005',true);
set local role authenticated;
select lives_ok($$select * from public.exceptionally_close_register_session(
  current_setting('phase4c.session_id')::uuid,1,0,'administrative_recovery',null,
  'phase4c-exception-supervisor-inactive-account-0002')$$,
  'Exact-cafeteria Supervisor recovery works when account is inactive');
reset role;
update public.accounts set status='active' where id='00000000-0000-0000-0000-000000000001';

select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002008',true);
set local role authenticated;
select lives_ok($$select * from public.open_register_session('00000000-0000-0000-0000-000000009401',
  '00000000-0000-0000-0000-000000009501',0,'phase4c-open-auth-loss-0003')$$,
  'Cashier opens before Auth-link removal recovery scenario');
select set_config('phase4c.session_id',(select session_id::text from public.get_my_open_register_session()),true);
reset role;
update public.persons set status='suspended' where id='00000000-0000-0000-0000-000000001008';
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002008',true);
set local role authenticated;
select throws_ok($$select * from public.get_my_open_register_session()$$,'42501',null,
  'Suspended owner cannot use own-session read');
select throws_ok($$select * from public.close_my_register_session(
  current_setting('phase4c.session_id')::uuid,1,0,'phase4c-suspended-owner-close-0003')$$,'42501',null,
  'Suspended owner cannot normal-close');
reset role;
update public.persons set status='active' where id='00000000-0000-0000-0000-000000001008';
update public.persons set auth_user_id=null where id='00000000-0000-0000-0000-000000001008';
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002008',true);
set local role authenticated;
select throws_ok($$select * from public.get_my_open_register_session()$$,'42501',null,
  'Unlinked owner cannot authenticate for normal close');
reset role;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002002',true);
set local role authenticated;
select throws_ok($$select * from public.exceptionally_close_register_session(
  current_setting('phase4c.session_id')::uuid,1,0,'auth_access_lost','Recovery',
  'phase4c-school-admin-no-recovery-0003')$$,'42501',null,
  'School Admin cannot recover a cafeteria session');
reset role;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002001',true);
set local role authenticated;
select throws_ok($$select * from public.exceptionally_close_register_session(
  current_setting('phase4c.session_id')::uuid,1,0,'auth_access_lost','Recovery',
  'phase4c-account-admin-no-recovery-0003')$$,'42501',null,
  'Account Admin cannot recover a cafeteria session');
reset role;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002004',true);
set local role authenticated;
select throws_ok($$select * from public.exceptionally_close_register_session(
  current_setting('phase4c.session_id')::uuid,1,0,'auth_access_lost','Recovery',
  'phase4c-wrong-cafe-admin-no-recovery-0003')$$,'42501',null,
  'Cafeteria Admin in a different cafeteria cannot recover the session');
reset role;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002007',true);
set local role authenticated;
select throws_ok($$select * from public.exceptionally_close_register_session(
  current_setting('phase4c.session_id')::uuid,1,0,'auth_access_lost','Recovery',
  'phase4c-reserved-pos-no-recovery-0003')$$,'42501',null,
  'Reserved pos_operator cannot recover a session');
reset role;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002011',true);
set local role authenticated;
select throws_ok($$select * from public.exceptionally_close_register_session(
  current_setting('phase4c.session_id')::uuid,1,0,'other',null,
  'phase4c-exception-other-no-note-0003')$$,'22023',null,
  'Exceptional reason other requires a bounded note');
select throws_ok($$select * from public.exceptionally_close_register_session(
  current_setting('phase4c.session_id')::uuid,1,0,'unlisted_reason','Recovery',
  'phase4c-exception-unlisted-reason-0003')$$,'22023',null,
  'Exceptional close rejects arbitrary reason codes');
select throws_ok($$select * from public.exceptionally_close_register_session(
  current_setting('phase4c.session_id')::uuid,1,0,'administrative_recovery',repeat('n',1001),
  'phase4c-exception-overlength-note-0003')$$,'22023',null,
  'Exceptional close rejects notes longer than 1000 characters');
select throws_ok($$select * from public.exceptionally_close_register_session(
  current_setting('phase4c.session_id')::uuid,0,0,'administrative_recovery',null,
  'phase4c-stale-exception-close-0003')$$,'40001',null,
  'Stale exceptional-close session version is rejected');
select throws_ok($$select * from public.exceptionally_close_register_session(
  current_setting('phase4c.session_id')::uuid,1,-1,'auth_access_lost','Recovery',
  'phase4c-exception-negative-count-0003')$$,'22023',null,
  'Exceptional close rejects negative counted cash');
select lives_ok($$select * from public.exceptionally_close_register_session(
  current_setting('phase4c.session_id')::uuid,1,0,
  'auth_access_lost','Auth link removed','phase4c-exception-supervisor-0003')$$,
  'Supervisor exceptional-closes a session whose owner Auth link was removed');
select lives_ok($$select * from public.exceptionally_close_register_session(
  current_setting('phase4c.session_id')::uuid,1,0,
  'auth_access_lost','Auth link removed','phase4c-exception-supervisor-0003')$$,
  'Exceptional close retry is idempotent for same actor and evidence');
select throws_ok($$select * from public.exceptionally_close_register_session(
  current_setting('phase4c.session_id')::uuid,1,10,
  'auth_access_lost','Changed evidence','phase4c-exception-supervisor-0003')$$,'23505',null,
  'Changed exceptional-close evidence cannot overwrite terminal session');
reset role;
select is((select operator_person_id='00000000-0000-0000-0000-000000001008'
  and closed_by_person_id='00000000-0000-0000-0000-000000001011'
  and close_type='exceptional' and close_reason_code='auth_access_lost'
  from public.register_sessions where open_request_key='phase4c-open-auth-loss-0003'),true,
  'Exceptional close preserves original owner and records recovery actor separately');
update public.persons set auth_user_id='00000000-0000-0000-0000-000000002008'
  where id='00000000-0000-0000-0000-000000001008';

select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002008',true);
set local role authenticated;
select lives_ok($$select * from public.open_register_session('00000000-0000-0000-0000-000000009401',
  '00000000-0000-0000-0000-000000009501',0,'phase4c-open-inactive-cafe-0004')$$,
  'Cashier opens before inactive-cafeteria recovery scenario');
select set_config('phase4c.session_id',(select session_id::text from public.get_my_open_register_session()),true);
reset role;
update public.cafeterias set status='inactive' where id='00000000-0000-0000-0000-000000000111';
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002003',true);
set local role authenticated;
select lives_ok($$select * from public.exceptionally_close_register_session(
  current_setting('phase4c.session_id')::uuid,1,0,
  'administrative_recovery',null,'phase4c-exception-admin-0004')$$,
  'Cafeteria Admin recovery-close works for an existing session when cafeteria is inactive');
reset role;
update public.cafeterias set status='active' where id='00000000-0000-0000-0000-000000000111';

select ok(exists(select 1 from public.audit_events where target_type='register_sessions'
  and target_id=(select id from public.register_sessions where open_request_key='phase4c-open-cashier-register-0001')
  and action='register_session_opened' and actor_person_id='00000000-0000-0000-0000-000000001008'),
  'Session opening has actor-attributed audit evidence');
select ok(exists(select 1 from public.audit_events where target_type='register_sessions'
  and target_id=(select id from public.register_sessions where open_request_key='phase4c-open-auth-loss-0003')
  and action='register_session_exceptionally_closed' and actor_person_id='00000000-0000-0000-0000-000000001011'
  and after_metadata->>'close_reason_code'='auth_access_lost'),
  'Exceptional-close audit records recovery actor and structured reason');
select ok(not exists(select 1 from public.audit_events where target_type='register_sessions'
  and target_id=(select id from public.register_sessions where open_request_key='phase4c-open-cashier-register-0001')
  and (before_metadata ? 'opening_cash_minor' or after_metadata ? 'opening_cash_minor'
    or before_metadata ? 'counted_cash_minor' or after_metadata ? 'counted_cash_minor')),
  'Session audit does not duplicate opening or counted cash amounts');
select ok(not exists(select 1 from public.audit_events where target_type='register_sessions'
  and target_id=(select id from public.register_sessions where open_request_key='phase4c-open-auth-loss-0003')
  and (before_metadata ? 'close_note' or after_metadata ? 'close_note'
    or before_metadata ? 'counted_cash_minor' or after_metadata ? 'counted_cash_minor')),
  'Exceptional-close audit omits free-text note and duplicate cash evidence');

reset role;
grant insert,update,delete on public.cafeteria_registers,public.cafeteria_register_assignments,public.register_sessions to authenticated;
grant select on public.register_sessions to authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002003',true);
set local role authenticated;
select throws_ok($$insert into public.cafeteria_registers(account_id,school_id,school_location_id,cafeteria_id,register_code,display_name)
  values('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011',
  '00000000-0000-0000-0000-000000000211','00000000-0000-0000-0000-000000000111','DIRECT','Direct register')$$,
  '42501',null,'RLS denies direct register insert despite broadened grants');
select throws_ok($$insert into public.cafeteria_register_assignments(account_id,school_id,school_location_id,cafeteria_id,
  cafeteria_membership_id,operator_person_id,register_id)
  values('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011',
  '00000000-0000-0000-0000-000000000211','00000000-0000-0000-0000-000000000111',
  '00000000-0000-0000-0000-000000004601','00000000-0000-0000-0000-000000001008',
  '00000000-0000-0000-0000-000000009401')$$,'42501',null,
  'RLS denies direct register assignment insert despite broadened grants');
select throws_ok($$insert into public.register_sessions(account_id,school_id,school_location_id,cafeteria_id,register_id,
  assignment_id,operator_membership_id,operator_person_id,operator_role_code,register_code_snapshot,register_name_snapshot,
  opened_at,opened_business_date,business_timezone_snapshot,currency_code,opening_cash_minor,open_request_key,open_payload_fingerprint)
  values('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011',
  '00000000-0000-0000-0000-000000000211','00000000-0000-0000-0000-000000000111',
  '00000000-0000-0000-0000-000000009401','00000000-0000-0000-0000-000000009501',
  '00000000-0000-0000-0000-000000004601','00000000-0000-0000-0000-000000001008','pos_cashier',
  'CAJA-1','Caja 1',now(),current_date,'America/Santo_Domingo','DOP',0,
  'direct-session-request-0001',repeat('a',64))$$,'42501',null,
  'RLS denies direct session insert despite broadened grants');
with changed as (update public.cafeteria_registers set display_name='Direct rewrite',version=999
  where id='00000000-0000-0000-0000-000000009401' returning id)
select is(count(*),0::bigint,'RLS denies direct register update despite broadened grants') from changed;
with changed as (update public.cafeteria_register_assignments set status='inactive',version=999
  where id='00000000-0000-0000-0000-000000009501' returning id)
select is(count(*),0::bigint,'RLS denies direct assignment update despite broadened grants') from changed;
with changed as (update public.register_sessions set opening_cash_minor=999
  where operator_person_id='00000000-0000-0000-0000-000000001008' returning id)
select is(count(*),0::bigint,'RLS denies direct session cash/owner update despite broadened grants') from changed;
with removed as (delete from public.cafeteria_registers where id='00000000-0000-0000-0000-000000009401' returning id)
select is(count(*),0::bigint,'RLS denies direct register delete despite broadened grants') from removed;
with removed as (delete from public.cafeteria_register_assignments where id='00000000-0000-0000-0000-000000009501' returning id)
select is(count(*),0::bigint,'RLS denies direct assignment delete despite broadened grants') from removed;
with removed as (delete from public.register_sessions where operator_person_id='00000000-0000-0000-0000-000000001008' returning id)
select is(count(*),0::bigint,'RLS denies direct session delete despite broadened grants') from removed;
select throws_ok($$truncate table public.cafeteria_registers$$,'42501',null,'TRUNCATE of registers is denied');
select throws_ok($$truncate table public.cafeteria_register_assignments$$,'42501',null,'TRUNCATE of assignments is denied');
select throws_ok($$truncate table public.register_sessions$$,'42501',null,'TRUNCATE of sessions is denied');
reset role;
revoke insert,update,delete on public.cafeteria_registers,public.cafeteria_register_assignments,public.register_sessions from authenticated;
revoke select on public.register_sessions from authenticated;
select * from finish();
rollback;