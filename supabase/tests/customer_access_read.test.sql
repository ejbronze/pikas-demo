-- Backoffice "Usuarios y accesos": read-only customer access support view.
begin;
create extension if not exists pgtap with schema extensions;
set search_path=public,extensions;
select no_plan();
create function pg_temp.attempt(sql text) returns text language plpgsql as $$declare m text; begin execute sql; return 'ok';
 exception when others then get stacked diagnostics m=message_text; return sqlstate||':'||m; end$$;
create function pg_temp.as_user(u text) returns void language plpgsql as $$declare sid uuid:=gen_random_uuid(); begin
 execute 'reset role';
 insert into auth.sessions(id,user_id,created_at,updated_at) values(sid,u::uuid,now(),now());
 insert into pikas_private.application_sessions(session_id,user_id,started_at,last_active_at) values(sid,u::uuid,clock_timestamp(),clock_timestamp());
 perform set_config('request.jwt.claim.sub',u,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',u,'role','authenticated','session_id',sid)::text,true);
 execute 'set local role authenticated'; end$$;
create function pg_temp.q(sql text) returns text language plpgsql security definer set search_path=public as $$declare r text; begin execute sql into r; return r; end$$;
-- One fictional Platform operator; n picks ids, demo: none | expired | current.
create function pg_temp.operator(n int,role text,demo text) returns void language plpgsql as $$
declare u uuid:=('00000000-0000-0000-0000-0000000ac0a'||n)::uuid; p uuid:=('00000000-0000-0000-0000-0000000ac0b'||n)::uuid; pr pikas_private.sandbox_pov_personas%rowtype; begin
 insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at,raw_app_meta_data,raw_user_meta_data)
  values(u,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','acceso.caso.'||n||'@example.invalid','',now(),now(),now(),'{}','{}');
 insert into persons(id,auth_user_id,display_name) values(p,u,'Operador accesos '||n);
 insert into pikas_private.platform_memberships(person_id,role_code) values(p,role);
 if demo='none' then return; end if;
 select * into pr from pikas_private.sandbox_pov_personas where pov_code='cashier' order by id limit 1;
 insert into pikas_private.sandbox_pov_sessions(request_id,initiator_person_id,initiator_auth_user_id,account_id,school_id,cafeteria_id,pov_code,persona_id,persona_person_id,persona_membership_id,status,started_at,expires_at)
 values(gen_random_uuid(),p,u,pr.account_id,pr.school_id,pr.cafeteria_id,'cashier',pr.id,pr.person_id,pr.cafeteria_membership_id,'active',
  case when demo='current' then now()-interval '5 minutes' else now()-interval '3 days' end, case when demo='current' then now()+interval '1 hour' else now()-interval '3 days'+interval '1 hour' end);
end$$;

reset role;
set local session_replication_role=replica;
insert into pikas_private.platform_roles(role_code) values('test_access_ops_only'),('test_access_reader_only');
insert into pikas_private.platform_role_capabilities(role_code,capability) values
 ('test_access_ops_only','platform:customer:operations:read'),('test_access_ops_only','platform:customer:operations:manage'),('test_access_ops_only','platform:identity:support'),
 ('test_access_reader_only','platform:customer:access:read');
set local session_replication_role=origin;
select pg_temp.operator(1,'platform_admin','none');
select pg_temp.operator(2,'platform_admin','expired');
select pg_temp.operator(3,'platform_admin','current');
select pg_temp.operator(4,'test_access_ops_only','none');
select pg_temp.operator(5,'test_access_reader_only','none');
select pg_temp.operator(6,'platform_admin','none');
-- Operator 6 is PIKAS staff who ALSO holds a real customer membership; operator 1 holds none.
insert into cafeteria_memberships(account_id,school_id,cafeteria_id,person_id,role_code,status)
 values('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000111','00000000-0000-0000-0000-0000000ac0b6','pos_cashier','active');
-- Login-state fixtures on existing fictional people.
insert into pikas_private.login_identities(person_id,username,must_change_password,temporary_requested_at,temporary_issued_at) values('00000000-0000-0000-0000-000000001008','cajero.ocho',true,now(),now())
 on conflict(person_id) do update set username=excluded.username,must_change_password=true,temporary_requested_at=now(),temporary_issued_at=now();
insert into pikas_private.login_identities(person_id,login_suspended_at) values('00000000-0000-0000-0000-000000001003',now())
 on conflict(person_id) do update set login_suspended_at=now();
select set_config('t.tenant',(select auth_user_id::text from persons where id='00000000-0000-0000-0000-000000001001'),true);
select set_config('t.guardians',coalesce((select string_agg(person_id::text,',') from family_guardians),''),true);

select ok(exists(select 1 from pikas_private.platform_role_capabilities where role_code='platform_admin' and capability='platform:customer:access:read')
 and not exists(select 1 from pikas_private.platform_role_capabilities where role_code='platform_sandbox_operator' and capability='platform:customer:access:read'),
 'Access read granted to platform_admin only');
select ok(not has_function_privilege('anon','platform_customer_access_read(uuid)','execute'),'Anonymous cannot read customer access');

-- A pending Platform initial-admin request with no Person yet (prepared through the real command).
select pg_temp.as_user('00000000-0000-0000-0000-0000000ac0a1');
select is(platform_prepare_customer_admin_with_username(gen_random_uuid(),'00000000-0000-0000-0000-000000000001','account',null,null,'account_admin',
 'director.pendiente@example.invalid',now()+interval '7 days','director.pendiente')->>'status','pending','Pending initial-admin fixture prepared');

reset role;
select set_config('t.counts',pg_temp.q($s$select concat_ws('|',(select count(*) from pikas_private.login_identities),(select count(*) from audit_events),(select count(*) from pikas_private.platform_audit_events),
 (select count(*) from pikas_private.platform_requests),(select count(*) from pikas_private.identity_audit_events),(select count(*) from pikas_private.account_activation_flows),(select count(*) from persons))$s$),true);

-- 1. Authorized read.
select pg_temp.as_user('00000000-0000-0000-0000-0000000ac0a1');
select set_config('t.r',platform_customer_access_read('00000000-0000-0000-0000-000000000001')::text,true);
select is(current_setting('t.r')::jsonb->>'account_id','00000000-0000-0000-0000-000000000001','1. platform_admin reads a normal customer');
create function pg_temp.person(pid text) returns jsonb language sql as $$ select p from jsonb_array_elements(current_setting('t.r')::jsonb->'people') p where p->>'person_id'=pid $$;

-- 20. Reading wrote nothing.
reset role;
select is(pg_temp.q($s$select concat_ws('|',(select count(*) from pikas_private.login_identities),(select count(*) from audit_events),(select count(*) from pikas_private.platform_audit_events),
 (select count(*) from pikas_private.platform_requests),(select count(*) from pikas_private.identity_audit_events),(select count(*) from pikas_private.account_activation_flows),(select count(*) from persons))$s$),
 current_setting('t.counts'),'20. Read creates no login identity, audit, request, activation flow or person');
select is((select provolatile::text from pg_proc where oid='public.platform_customer_access_read(uuid)'::regprocedure),'v','Function is a plain read (no locks requested in its body)');
select ok((select prosrc from pg_proc where oid='public.platform_customer_access_read(uuid)'::regprocedure) !~* '\m(insert|update|delete|for update|for share|require_identity_support|identity_support_read)\M','20. Function body contains no write, lock or identity-support path');

-- 9-14. Grants, scopes, multiple roles, registers.
select is(pg_temp.person('00000000-0000-0000-0000-000000001001')->'grants'->0->>'scope','account','9. Account-level membership returned');
select is(pg_temp.person('00000000-0000-0000-0000-000000001001')->'grants'->0->>'role_code','account_admin','9. Account admin role');
select is((select concat_ws('|',g->>'scope',g->>'role_code',g->>'school_name') from jsonb_array_elements(pg_temp.person('00000000-0000-0000-0000-000000001002')->'grants') g limit 1),
 pg_temp.q($s$select concat_ws('|','school','school_admin',s.name) from school_memberships m join schools s on s.id=m.school_id where m.person_id='00000000-0000-0000-0000-000000001002' limit 1$s$),'10. School-level membership with its colegio');
select is((select concat_ws('|',g->>'scope',g->>'role_code',g->>'cafeteria_id') from jsonb_array_elements(pg_temp.person('00000000-0000-0000-0000-000000001003')->'grants') g),
 'cafeteria|cafeteria_admin|00000000-0000-0000-0000-000000000111','11. Cafeteria-level membership with its cafetería');
select is((select count(*)::int from jsonb_array_elements(current_setting('t.r')::jsonb->'people') p where p->>'person_id'='00000000-0000-0000-0000-000000001011'),1,'12. Multi-role person appears once');
select is(jsonb_array_length(pg_temp.person('00000000-0000-0000-0000-000000001011')->'grants'),4,'12. ... with all four grants');
select is((select string_agg(distinct g->>'cafeteria_name',' | ' order by g->>'cafeteria_name') from jsonb_array_elements(pg_temp.person('00000000-0000-0000-0000-000000001011')->'grants') g),
 pg_temp.q($s$select string_agg(distinct c.name,' | ' order by c.name) from cafeteria_memberships m join cafeterias c on c.id=m.cafeteria_id where m.person_id='00000000-0000-0000-0000-000000001011'$s$),'13. Multiple cafetería grants keep their own cafetería');
select is((select string_agg(r->>'name',',' order by r->>'name') from jsonb_array_elements(pg_temp.person('00000000-0000-0000-0000-000000001008')->'grants') g, jsonb_array_elements(g->'registers') r where g->>'role_code'='pos_cashier'),
 'Caja 1,Caja 2','14. Register assignments map to the right person and cafetería grant');
select is((select string_agg(r->>'name',',') from jsonb_array_elements(pg_temp.person('00000000-0000-0000-0000-000000001008')->'grants') g, jsonb_array_elements(g->'registers') r where g->>'role_code'='pos_supervisor'),
 pg_temp.q($s$select string_agg(r.display_name,',') from cafeteria_register_assignments a join cafeteria_registers r on r.id=a.register_id join cafeteria_memberships m on m.id=a.cafeteria_membership_id where m.person_id='00000000-0000-0000-0000-000000001008' and m.role_code='pos_supervisor'$s$),
 '14. The same person''s other cafetería grant carries only its own registers');
select is(jsonb_array_length(pg_temp.person('00000000-0000-0000-0000-000000001001')->'grants'->0->'registers'),0,'14. Non-cafetería grants carry no registers');
select is(pg_temp.person('00000000-0000-0000-0000-000000001007')->'grants'->0->>'role_code','pos_operator','Legacy pos_operator presented as stored');

-- 18. Login state derived from real data.
select is(concat_ws('|',pg_temp.person('00000000-0000-0000-0000-000000001008')->>'username',pg_temp.person('00000000-0000-0000-0000-000000001008')->>'must_change_password',pg_temp.person('00000000-0000-0000-0000-000000001008')->>'login_suspended'),'cajero.ocho|true|false','18. Username and password-change state');
select is(pg_temp.person('00000000-0000-0000-0000-000000001003')->>'login_suspended','true','18. Login suspension state');
select ok(pg_temp.person('00000000-0000-0000-0000-000000001001') ?& array['email','email_confirmed','last_sign_in_at','has_login','email_change_pending','temporary_issued_at'],'18. Email/sign-in/login fields present');

-- 8. Platform staff appear only with a real customer membership.
select ok(pg_temp.person('00000000-0000-0000-0000-0000000ac0b1') is null,'8. PIKAS staff without a customer membership are not listed');
select is(pg_temp.person('00000000-0000-0000-0000-0000000ac0b6')->'grants'->0->>'role_code','pos_cashier','8. PIKAS staff with a real customer membership are listed for that grant');

-- 7 / 21. No cross-customer, student or guardian leakage.
select ok(pg_temp.person('00000000-0000-0000-0000-000000001006') is null,'7. Another customer''s user is not listed');
select ok((select bool_and(g->>'school_id' is null or g->>'school_id' in ('00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000012'))
 from jsonb_array_elements(current_setting('t.r')::jsonb->'people') p, jsonb_array_elements(p->'grants') g),'7. Every grant belongs to the requested customer');
select ok(current_setting('t.guardians')='' or not exists(select 1 from jsonb_array_elements(current_setting('t.r')::jsonb->'people') p where p->>'person_id'=any(string_to_array(current_setting('t.guardians'),','))),'21. Guardians are not listed');
select ok(current_setting('t.r') !~* '(student|guardian|wallet|purchase|balance)','21. No student, guardian or financial data in the payload');
select is(pg_temp.q($s$select count(*)::text from jsonb_array_elements((select platform_customer_access_read('00000000-0000-0000-0000-000000000001'))->'people')$s$),
 pg_temp.q($s$select count(distinct person_id)::text from (select person_id from account_memberships where account_id='00000000-0000-0000-0000-000000000001' union select person_id from school_memberships where account_id='00000000-0000-0000-0000-000000000001' union select person_id from cafeteria_memberships where account_id='00000000-0000-0000-0000-000000000001') x$s$),
 'Exactly the customer''s membership holders are listed');

-- 15-17. Pending access.
select is((select concat_ws('|',x->>'role_code',x->>'email',x->>'username',x->>'identity_state',x->>'link_state',x->>'request_expired') from jsonb_array_elements(current_setting('t.r')::jsonb->'pending') x where x->>'kind'='initial_admin'),
 'account_admin|director.pendiente@example.invalid|director.pendiente|missing|none|false','15/17. Pending initial admin without a Person: derived state, no person');
select ok((select bool_and(not (x ? 'person_id')) from jsonb_array_elements(current_setting('t.r')::jsonb->'pending') x),'17. Pending entries do not pretend to have a Person');
select is((select concat_ws('|',x->>'role_code',x->>'scope',x->>'school_name' is not null) from jsonb_array_elements(current_setting('t.r')::jsonb->'pending') x where x->>'kind'='invitation' limit 1),'school_admin|school|t','16. Pending staff invitation returned with its colegio');

-- 19. No secrets.
select ok(current_setting('t.r') !~* '"[a-z_]*(token|digest|baseline|hash|handle|secret|owner_key|raw_|session|url|encrypted)[a-z_]*":' and current_setting('t.r') !~ '"password":',
 '19. No token, password trace, link handle/URL, session or raw Auth metadata key in the payload');

-- 5. Expired Demo history does not block.
select pg_temp.as_user('00000000-0000-0000-0000-0000000ac0a2');
select is(pg_temp.attempt($$select platform_customer_access_read('00000000-0000-0000-0000-000000000001')$$),'ok','5. Expired Demo history does not block the read');
-- 4. Current Demo POV refused.
select pg_temp.as_user('00000000-0000-0000-0000-0000000ac0a3');
select is(pg_temp.attempt($$select platform_customer_access_read('00000000-0000-0000-0000-000000000001')$$),'42501:customer_access_authority_required','4. Current Demo POV refused');
-- 2. Missing capability (even with operations and identity-support capabilities).
select pg_temp.as_user('00000000-0000-0000-0000-0000000ac0a4');
select is(pg_temp.attempt($$select platform_customer_access_read('00000000-0000-0000-0000-000000000001')$$),'42501:not_authorized','2. Without customer:access:read the read is refused');
-- 3. Tenant administrator refused.
select pg_temp.as_user(current_setting('t.tenant'));
select is(pg_temp.attempt($$select platform_customer_access_read('00000000-0000-0000-0000-000000000001')$$),'42501:not_authorized','3. Tenant administrator refused');
-- 6. Sandbox customer refused; unknown customer indistinguishable.
select pg_temp.as_user('00000000-0000-0000-0000-0000000ac0a1');
select is(pg_temp.attempt($$select platform_customer_access_read('03e71159-69e9-4387-9b3b-65799d49faf0')$$),'42501:customer_access_scope_required','6. Sandbox customer refused');
select is(pg_temp.attempt($$select platform_customer_access_read(gen_random_uuid())$$),'42501:customer_access_scope_required','6. Unknown customer refused the same way');
select ok(position('00000000-0000-0000-0000-000000001001' in platform_customer_access_read('00000000-0000-0000-0000-000000000002')::text)=0,'7. Other customer''s read excludes this customer''s people');

-- 22. The read capability grants no mutation.
select pg_temp.as_user('00000000-0000-0000-0000-0000000ac0a5');
select is(pg_temp.attempt($$select platform_customer_access_read('00000000-0000-0000-0000-000000000001')$$),'ok','A role holding only customer:access:read can read');
select ok((select bool_and(pg_temp.attempt(sql) ~ '^42501:') from unnest(array[
 $$select platform_support_cafeteria_command('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000111',gen_random_uuid(),'product_save','{}')$$,
 $$select platform_update_colegio_profile(gen_random_uuid(),'00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011','{}','X','','','','')$$,
 $$select platform_rename_customer_structure(gen_random_uuid(),'00000000-0000-0000-0000-000000000001','location','00000000-0000-0000-0000-000000000211','x','y')$$,
 $$select platform_onboard_school(gen_random_uuid(),'X','101234567','Calle','DO','DO-01')$$,
 $$select platform_prepare_customer_admin(gen_random_uuid(),'00000000-0000-0000-0000-000000000001','account',null,null,'account_admin','x@example.invalid',now()+interval '1 day')$$,
 $$select identity_support_lookup('cajero.ocho')$$,
 $$select school_wallet_replenish('00000000-0000-0000-0000-000000000011',gen_random_uuid(),100,gen_random_uuid(),'manual_verified','x')$$]) sql),
 '22. Access-read alone cannot change catalog, profile, structure, onboarding, provisioning, identity or money');

select * from finish();
rollback;
