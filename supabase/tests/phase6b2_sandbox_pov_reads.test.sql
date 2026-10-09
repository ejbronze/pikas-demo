begin;
create extension if not exists pgtap with schema extensions;
set search_path=public,extensions;
select no_plan();

create function pg_temp.login(suffix text) returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000'||suffix,true); end $$;

create function pg_temp.sid(r uuid) returns uuid language sql security definer as $$ select id from pikas_private.sandbox_pov_sessions where request_id=r $$;
grant execute on function pg_temp.sid(uuid) to authenticated;

insert into auth.users(id,aud,role,email,confirmed_at) values
 ('00000000-0000-0000-0000-000000002301','authenticated','authenticated','p6b2-op-a@example.invalid',now()),
 ('00000000-0000-0000-0000-000000002302','authenticated','authenticated','p6b2-op-b@example.invalid',now()),
 ('00000000-0000-0000-0000-000000002303','authenticated','authenticated','p6b2-admin@example.invalid',now()),
 ('00000000-0000-0000-0000-000000002304','authenticated','authenticated','p6b2-expired@example.invalid',now());
insert into public.persons(id,auth_user_id,display_name,status) values
 ('00000000-0000-0000-0000-000000001301','00000000-0000-0000-0000-000000002301','Read operator A','active'),
 ('00000000-0000-0000-0000-000000001302','00000000-0000-0000-0000-000000002302','Read operator B','active'),
 ('00000000-0000-0000-0000-000000001303','00000000-0000-0000-0000-000000002303','Read admin only','active'),
 ('00000000-0000-0000-0000-000000001304','00000000-0000-0000-0000-000000002304','Read operator expired','active'),
 ('00000000-0000-0000-0000-000000001310',null,'Cajero Demo','active');
insert into pikas_private.platform_memberships(person_id,role_code,status) values
 ('00000000-0000-0000-0000-000000001301','platform_sandbox_operator','active'),
 ('00000000-0000-0000-0000-000000001302','platform_sandbox_operator','active'),
 ('00000000-0000-0000-0000-000000001303','platform_admin','active'),
 ('00000000-0000-0000-0000-000000001304','platform_sandbox_operator','active');
insert into public.cafeteria_memberships(id,account_id,school_id,cafeteria_id,person_id,role_code) values
 ('00000000-0000-0000-0000-000000004710','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000111','00000000-0000-0000-0000-000000001310','pos_cashier');

-- Before the account is classified as sandbox nothing is listable, and customer tenants can never hold personas.
select pg_temp.login('2301');
set local role authenticated;
select is(public.platform_list_sandbox_pov_targets(),'[]'::jsonb,'Customer tenants are never listed');
reset role;
alter table public.accounts disable trigger accounts_tenant_kind_immutable;
update public.accounts set tenant_kind='sandbox' where id='00000000-0000-0000-0000-000000000001';
alter table public.accounts enable trigger accounts_tenant_kind_immutable;
select pg_temp.login('2301');
set local role authenticated;
select is(public.platform_list_sandbox_pov_targets(),'[]'::jsonb,'Sandbox without a persona registration lists nothing');
reset role;
insert into pikas_private.sandbox_pov_personas(id,account_id,school_id,cafeteria_id,pov_code,person_id,cafeteria_membership_id)
values('00000000-0000-0000-0000-000000008910','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000111','cashier','00000000-0000-0000-0000-000000001310','00000000-0000-0000-0000-000000004710');

-- Authorization boundary.
select ok(not has_function_privilege('anon','public.platform_list_sandbox_pov_targets()','EXECUTE')
  and not has_function_privilege('anon','public.platform_get_active_sandbox_pov()','EXECUTE')
  and not has_function_privilege('service_role','public.platform_list_sandbox_pov_targets()','EXECUTE')
  and not has_function_privilege('service_role','public.platform_get_active_sandbox_pov()','EXECUTE')
  and has_function_privilege('authenticated','public.platform_list_sandbox_pov_targets()','EXECUTE')
  and has_function_privilege('authenticated','public.platform_get_active_sandbox_pov()','EXECUTE'),'Read RPC grants are authenticated only');
select ok((select provolatile='s' from pg_proc where oid='public.platform_list_sandbox_pov_targets()'::regprocedure)
  and (select provolatile='s' from pg_proc where oid='public.platform_get_active_sandbox_pov()'::regprocedure),'Both read RPCs are stable (read-only)');
select pg_temp.login('2303');
set local role authenticated;
select throws_ok($$select public.platform_list_sandbox_pov_targets()$$,'42501','not_authorized','platform_admin without sandbox capability cannot list targets');
select throws_ok($$select public.platform_get_active_sandbox_pov()$$,'42501','not_authorized','platform_admin without sandbox capability cannot read active POV');
reset role;
select pg_temp.login('2008');
set local role authenticated;
select throws_ok($$select public.platform_list_sandbox_pov_targets()$$,'42501','not_authorized','Ordinary tenant user cannot list targets');
select throws_ok($$select public.platform_get_active_sandbox_pov()$$,'42501','not_authorized','Ordinary tenant user cannot read active POV');
reset role;
set local role anon;
select throws_ok($$select public.platform_list_sandbox_pov_targets()$$,'42501',null,'Anonymous cannot list targets');
reset role;

-- Listing.
select pg_temp.login('2301');
set local role authenticated;
select is(jsonb_array_length(public.platform_list_sandbox_pov_targets()),1,'Sandbox operator lists exactly one valid cashier target');
select is(public.platform_list_sandbox_pov_targets()->0,jsonb_build_object(
  'account_id','00000000-0000-0000-0000-000000000001'::uuid,
  'account_name','SYNTHETIC-A',
  'cafeteria_id','00000000-0000-0000-0000-000000000111'::uuid,
  'cafeteria_name','Synthetic cafeteria A1-C1',
  'pov_code','cashier','persona_display_name','Cajero Demo'),'Target exposes only the minimum launcher fields');
select is(public.platform_get_active_sandbox_pov(),null::jsonb,'No active POV before entering');
select lives_ok($$select public.platform_enter_sandbox_pov('00000000-0000-0000-0000-00000000d001','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000111','cashier')$$,'Operator A enters');
select is((public.platform_get_active_sandbox_pov()) - 'session_id' - 'expires_at',jsonb_build_object(
  'account_id','00000000-0000-0000-0000-000000000001'::uuid,
  'account_name','SYNTHETIC-A',
  'cafeteria_id','00000000-0000-0000-0000-000000000111'::uuid,
  'cafeteria_name','Synthetic cafeteria A1-C1',
  'pov_code','cashier','persona_display_name','Cajero Demo'),'Active POV returns the server-derived account, cafeteria and persona');
select ok((public.platform_get_active_sandbox_pov()->>'session_id')::uuid=pg_temp.sid('00000000-0000-0000-0000-00000000d001')
  and (public.platform_get_active_sandbox_pov()->>'expires_at')::timestamptz>now(),'Active POV carries its session id and a future expiry');
select ok(not (public.platform_get_active_sandbox_pov() ? 'initiator_person_id' or public.platform_get_active_sandbox_pov() ? 'persona_person_id'
  or public.platform_get_active_sandbox_pov() ? 'persona_membership_id'),'Active POV exposes no internal identifiers');
reset role;

-- Another operator never sees this POV.
select pg_temp.login('2302');
set local role authenticated;
select is(public.platform_get_active_sandbox_pov(),null::jsonb,'Operator B cannot inspect operator A''s POV');
reset role;

-- Reads grant nothing.
select is((select count(*) from pikas_private.sandbox_pov_sessions),1::bigint,'Reads create no sessions');
select is((select count(*) from pikas_private.platform_memberships),4::bigint,'Reads create no platform memberships');
select pg_temp.login('2303');
select ok(not pikas_private.platform_has_capability('platform:sandbox:pov:enter'),'platform_admin gains no sandbox authority from the reads');
select pg_temp.login('2301');
select ok(pikas_private.pos_actor_person_id()='00000000-0000-0000-0000-000000001310'::uuid
  and pikas_private.current_person_id()='00000000-0000-0000-0000-000000001301'::uuid,'Reads leave actor resolution unchanged');

-- Exit clears the active read.
set local role authenticated;
select lives_ok($$select public.platform_exit_sandbox_pov('00000000-0000-0000-0000-00000000d002')$$,'Operator A exits');
select is(public.platform_get_active_sandbox_pov(),null::jsonb,'Exit leaves no active demonstration');
select is(jsonb_array_length(public.platform_list_sandbox_pov_targets()),1,'Target remains listable after exit');
reset role;

-- Expired session never resolves active.
insert into pikas_private.sandbox_pov_sessions(request_id,initiator_person_id,initiator_auth_user_id,account_id,school_id,cafeteria_id,pov_code,persona_id,persona_person_id,persona_membership_id,started_at,expires_at)
values('00000000-0000-0000-0000-00000000d003','00000000-0000-0000-0000-000000001304','00000000-0000-0000-0000-000000002304','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000111','cashier','00000000-0000-0000-0000-000000008910','00000000-0000-0000-0000-000000001310','00000000-0000-0000-0000-000000004710',now()-interval '5 hours',now()-interval '1 hour');
select pg_temp.login('2304');
set local role authenticated;
select is(public.platform_get_active_sandbox_pov(),null::jsonb,'Expired POV is not active');
reset role;

-- Revoked platform authority fails closed.
select pg_temp.login('2301');
set local role authenticated;
select lives_ok($$select public.platform_enter_sandbox_pov('00000000-0000-0000-0000-00000000d004','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000111','cashier')$$,'Operator A re-enters');
reset role;
update pikas_private.platform_memberships set status='inactive' where person_id='00000000-0000-0000-0000-000000001301';
set local role authenticated;
select throws_ok($$select public.platform_get_active_sandbox_pov()$$,'42501','not_authorized','Revoked operator cannot read the POV');
select throws_ok($$select public.platform_list_sandbox_pov_targets()$$,'42501','not_authorized','Revoked operator cannot list targets');
reset role;

-- Operator B: inactive scope, membership and persona are never listed or active.
select pg_temp.login('2302');
set local role authenticated;
select lives_ok($$select public.platform_enter_sandbox_pov('00000000-0000-0000-0000-00000000d005','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000111','cashier')$$,'Operator B enters');
reset role;
update public.cafeterias set status='suspended' where id='00000000-0000-0000-0000-000000000111';
set local role authenticated;
select ok(public.platform_list_sandbox_pov_targets()='[]'::jsonb and public.platform_get_active_sandbox_pov() is null,'Inactive cafeteria is neither listed nor active');
reset role;
update public.cafeterias set status='active' where id='00000000-0000-0000-0000-000000000111';
update public.accounts set status='suspended' where id='00000000-0000-0000-0000-000000000001';
set local role authenticated;
select ok(public.platform_list_sandbox_pov_targets()='[]'::jsonb and public.platform_get_active_sandbox_pov() is null,'Inactive account is neither listed nor active');
reset role;
update public.accounts set status='active' where id='00000000-0000-0000-0000-000000000001';
set local role authenticated;
select is(jsonb_array_length(public.platform_list_sandbox_pov_targets()),1,'Target returns once the scope is active again');
select ok(public.platform_get_active_sandbox_pov() is not null,'POV resolves again once the scope is active again');
reset role;
update pikas_private.sandbox_pov_personas set status='inactive' where id='00000000-0000-0000-0000-000000008910';
set local role authenticated;
select ok(public.platform_list_sandbox_pov_targets()='[]'::jsonb and public.platform_get_active_sandbox_pov() is null,'Inactive persona is neither listed nor active');
reset role;

select * from finish();
rollback;
