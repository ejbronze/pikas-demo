-- PIKAS UX 2: read-only launch-readiness facts (202611080001). Fictional local fixtures only.
-- Foundation customer 00…01 (cafeteria 111: registers 9401/9402 assigned to POS staff, product 8101
-- available, account admin 2001) is the "configured" customer; a colegio onboarded here is the
-- "almost empty" one. Facts are compared as deltas or by account so other local data never matters.
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
create function pg_temp.operator(n int,role text) returns void language plpgsql as $$
declare u uuid:=('00000000-0000-0000-0000-0000000ad0a'||n)::uuid; p uuid:=('00000000-0000-0000-0000-0000000ad0b'||n)::uuid; begin
 insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at,raw_app_meta_data,raw_user_meta_data)
  values(u,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','listo.caso.'||n||'@example.invalid','',now(),now(),now(),'{}','{}');
 insert into persons(id,auth_user_id,display_name) values(p,u,'Operador readiness '||n);
 insert into pikas_private.platform_memberships(person_id,role_code) values(p,role);
end$$;
create function pg_temp.c(r jsonb,account text) returns jsonb language sql as $$
 select x from jsonb_array_elements(r->'customers') x where x->>'account_id'=account$$;

reset role;
set local session_replication_role=replica;
insert into pikas_private.platform_roles(role_code) values('test_ready_ops'),('test_ready_lifecycle_only');
insert into pikas_private.platform_role_capabilities(role_code,capability) values
 ('test_ready_ops','platform:customer:operations:read'),('test_ready_lifecycle_only','platform:tenant:lifecycle:read'),('test_ready_lifecycle_only','platform:customer:access:read');
set local session_replication_role=origin;
select pg_temp.operator(1,'platform_admin');
select pg_temp.operator(2,'test_ready_ops');
select pg_temp.operator(3,'test_ready_lifecycle_only');

-- Privileges and authority
select ok(has_function_privilege('authenticated','platform_customer_readiness(uuid)','execute'),'Authenticated may call the readiness read');
select ok(not has_function_privilege('anon','platform_customer_readiness(uuid)','execute') and not has_function_privilege('service_role','platform_customer_readiness(uuid)','execute'),'No anonymous or service bypass');
select pg_temp.as_user('00000000-0000-0000-0000-0000000ad0a3');
select is(pg_temp.attempt('select platform_customer_readiness()'),'42501:not_authorized','Lifecycle and access read alone do not grant readiness');
select pg_temp.as_user('00000000-0000-0000-0000-000000002001');
select is(pg_temp.attempt('select platform_customer_readiness()'),'42501:not_authorized','A customer administrator cannot read the network');
select pg_temp.as_user('00000000-0000-0000-0000-000000002003');
select is(pg_temp.attempt('select platform_customer_readiness()'),'42501:not_authorized','A cafeteria administrator cannot read the network');
select pg_temp.as_user('00000000-0000-0000-0000-0000000ad0a2');
select is(pg_temp.attempt('select platform_customer_readiness()'),'ok','The narrow customer-operations read is sufficient');

-- Sandbox is listed apart and never counted with customers (a fictional sandbox tenant is added here)
reset role;
insert into accounts(id,code,name,tenant_kind) values('7e00c000-0000-4000-8000-0000000000aa','DEMO-LISTO-FICTICIO','Demo ficticia de readiness','sandbox');
select pg_temp.as_user('00000000-0000-0000-0000-0000000ad0a1');
select set_config('t.all',platform_customer_readiness()::text,true);
select is(pg_temp.attempt('select platform_customer_readiness(''7e00c000-0000-4000-8000-0000000000aa'')'),'42501:customer_operations_scope_required','A sandbox tenant cannot be read as a customer');
reset role;
select ok((select bool_and(a.tenant_kind='customer') from jsonb_array_elements(current_setting('t.all')::jsonb->'customers') x join accounts a on a.id=(x->>'account_id')::uuid),'Only real customers are in customers');
select is(jsonb_array_length(current_setting('t.all')::jsonb->'customers')::bigint,(select count(*) from accounts where tenant_kind='customer'),'Every real customer is listed');
select ok((select bool_and(a.tenant_kind='sandbox') from jsonb_array_elements(current_setting('t.all')::jsonb->'sandbox') x join accounts a on a.id=(x->>'account_id')::uuid)
 and jsonb_array_length(current_setting('t.all')::jsonb->'sandbox')=(select count(*) from accounts where tenant_kind='sandbox'),'Every sandbox tenant is listed apart, including the fictional one');
select pg_temp.as_user('00000000-0000-0000-0000-0000000ad0a1');
select is(pg_temp.attempt('select platform_customer_readiness(''7e000000-0000-4000-8000-00000000dead'')'),'42501:customer_operations_scope_required','Unknown account refused');
select ok(position('total_minor' in current_setting('t.all'))=0 and position('amount' in current_setting('t.all'))=0 and position('balance' in current_setting('t.all'))=0 and position('token' in current_setting('t.all'))=0,'No amounts, balances or tokens are returned');

-- Configured customer (foundation): structure, admin, staff, staffed caja and products, no sale yet
select set_config('t.f',pg_temp.c(current_setting('t.all')::jsonb,'00000000-0000-0000-0000-000000000001')::text,true);
select ok((current_setting('t.f')::jsonb->'profile'->>'active_schools')::int>=1,'Configured: active colegio');
select ok((current_setting('t.f')::jsonb->'profile'->>'missing_tax_id')::int>=1,'Legacy colegios report optional profile fields missing, never invented');
select ok((current_setting('t.f')::jsonb->'structure'->>'operating_cafeterias')::int>=1 and current_setting('t.f')::jsonb->'structure'->>'first_cafeteria_id' is not null,'Configured: operating cafetería and its id');
select ok((current_setting('t.f')::jsonb->'administrators'->>'active')::int>=1,'Configured: active administrator');
select ok((current_setting('t.f')::jsonb->'staff'->>'active_pos')::int>=1,'Configured: active POS staff');
select ok((current_setting('t.f')::jsonb->'registers'->>'staffed')::int>=1,'Configured: caja with an assigned active POS member');
select ok((current_setting('t.f')::jsonb->'products'->>'available')::int>=1,'Configured: product available for sale');
select ok(current_setting('t.f')::jsonb->'sales'->'first_at'='null'::jsonb,'Configured: no first sale yet');

-- Almost-empty customer: onboarded colegio (structure only), no admin, staff, caja, products or sale
select set_config('t.r',platform_onboard_school('7e00c000-0000-4000-8000-000000000001','Colegio Puesta Ficticio','1-31-55555-1','Calle Ficticia 1','DO','DO-25')::text,true);
select set_config('t.e',pg_temp.c(platform_customer_readiness((current_setting('t.r')::jsonb->>'account_id')::uuid),current_setting('t.r')::jsonb->>'account_id')::text,true);
select is((current_setting('t.e')::jsonb->'profile'->>'active_schools')::int,1,'Empty: one colegio');
select is((current_setting('t.e')::jsonb->'profile'->>'missing_tax_id')::int,0,'Empty: onboarding captured the profile');
select is((current_setting('t.e')::jsonb->'structure'->>'operating_cafeterias')::int,1,'Empty: onboarding created an operating sede and cafetería');
select is((current_setting('t.e')::jsonb->'administrators'->>'active')::int,0,'Empty: no active administrator');
select is(current_setting('t.e')::jsonb->'administrators'->'requests','[]'::jsonb,'Empty: no administrator request');
select is((current_setting('t.e')::jsonb->'staff'->>'active_pos')::int,0,'Empty: no POS staff');
select is((current_setting('t.e')::jsonb->'registers'->>'active')::int,0,'Empty: no caja');
select is((current_setting('t.e')::jsonb->'products'->>'available')::int,0,'Empty: no products');
select is(jsonb_array_length(platform_customer_readiness((current_setting('t.r')::jsonb->>'account_id')::uuid)->'customers'),1,'Single-customer read returns only that customer');
select is(platform_customer_readiness((current_setting('t.r')::jsonb->>'account_id')::uuid)->'sandbox','[]'::jsonb,'Single-customer read omits sandbox');

-- Administrator request: pending (no link yet), then expired
select platform_prepare_customer_admin('7e00c000-0000-4000-8000-000000000002',(current_setting('t.r')::jsonb->>'account_id')::uuid,'account',null,null,'account_admin','puesta.admin@example.invalid',now()+interval '7 days');
select set_config('t.p',(platform_customer_readiness((current_setting('t.r')::jsonb->>'account_id')::uuid)->'customers'->0->'administrators'->'requests'->0)::text,true);
select is(current_setting('t.p')::jsonb->>'request_expired','false','Pending request is not expired');
select is(current_setting('t.p')::jsonb->>'link_state','none','No activation link generated yet');
reset role;
set local session_replication_role=replica;
update pikas_private.platform_customer_admin_intents set expires_at=now()-interval '1 day',created_at=now()-interval '8 days' where request_id='7e00c000-0000-4000-8000-000000000002';
set local session_replication_role=origin;
select pg_temp.as_user('00000000-0000-0000-0000-0000000ad0a1');
select is(platform_customer_readiness((current_setting('t.r')::jsonb->>'account_id')::uuid)->'customers'->0->'administrators'->'requests'->0->>'request_expired','true','An expired request is reported expired and never as access');
select is((platform_customer_readiness((current_setting('t.r')::jsonb->>'account_id')::uuid)->'customers'->0->'administrators'->>'active')::int,0,'An expired request does not count as an administrator');

-- No caja → caja without staff → staffed caja is only for active POS members
reset role;
insert into cafeteria_registers(account_id,school_id,school_location_id,cafeteria_id,register_code,display_name)
 select account_id,school_id,school_location_id,id,'CAJA-01','Caja ficticia' from cafeterias where account_id=(current_setting('t.r')::jsonb->>'account_id')::uuid;
select pg_temp.as_user('00000000-0000-0000-0000-0000000ad0a1');
select set_config('t.e2',(platform_customer_readiness((current_setting('t.r')::jsonb->>'account_id')::uuid)->'customers'->0)::text,true);
select is((current_setting('t.e2')::jsonb->'registers'->>'active')::int,1,'Caja created: one active caja');
select is((current_setting('t.e2')::jsonb->'registers'->>'staffed')::int,0,'A caja without assigned POS staff is not usable yet');

-- Products absent → present (inactive or unavailable products never count)
reset role;
insert into cafeteria_products(account_id,school_id,cafeteria_id,name,price_minor,active,available)
 select account_id,school_id,id,'Producto archivado ficticio',1000,false,true from cafeterias where account_id=(current_setting('t.r')::jsonb->>'account_id')::uuid
 union all select account_id,school_id,id,'Producto agotado ficticio',1000,true,false from cafeterias where account_id=(current_setting('t.r')::jsonb->>'account_id')::uuid;
select pg_temp.as_user('00000000-0000-0000-0000-0000000ad0a1');
select is((platform_customer_readiness((current_setting('t.r')::jsonb->>'account_id')::uuid)->'customers'->0->'products'->>'available')::int,0,'Inactive or unavailable products are not available for sale');
reset role;
insert into cafeteria_products(account_id,school_id,cafeteria_id,name,price_minor)
 select account_id,school_id,id,'Empanada ficticia',6500 from cafeterias where account_id=(current_setting('t.r')::jsonb->>'account_id')::uuid;
select pg_temp.as_user('00000000-0000-0000-0000-0000000ad0a1');
select is((platform_customer_readiness((current_setting('t.r')::jsonb->>'account_id')::uuid)->'customers'->0->'products'->>'available')::int,1,'An active, available product counts');

-- First sale: a real committed purchase of the configured customer
select pg_temp.as_user('00000000-0000-0000-0000-000000002011');
select set_config('t.sid',(select session_id::text from open_register_session('00000000-0000-0000-0000-000000009401','00000000-0000-0000-0000-000000009503',10000,'ready-open-session-0001')),true);
select checkout_purchase(jsonb_build_object('request_key','ready-first-sale-000001','register_session_id',current_setting('t.sid'),
 'cafeteria_customer_id','00000000-0000-0000-0000-000000006901','items',jsonb_build_array(jsonb_build_object('product_id','00000000-0000-0000-0000-000000008101',
 'quantity',1,'expected_product_version',1,'expected_unit_price_minor','5000')),'expected_total_minor','5000','tender',jsonb_build_object('type','cash','cash_received_minor','5000')));
select pg_temp.as_user('00000000-0000-0000-0000-0000000ad0a1');
select set_config('t.s',(platform_customer_readiness('00000000-0000-0000-0000-000000000001')->'customers'->0->'sales')::text,true);
select ok(current_setting('t.s')::jsonb->>'first_at' is not null and current_setting('t.s')::jsonb->>'last_at' is not null,'First sale: first and last sale timestamps present');
select is(platform_customer_readiness((current_setting('t.r')::jsonb->>'account_id')::uuid)->'customers'->0->'sales'->'first_at','null'::jsonb,'Another customer''s sale never counts');

-- Read-only: calling the read writes no audit
reset role;
select set_config('t.audit',(select count(*)::text from pikas_private.platform_audit_events),true);
select pg_temp.as_user('00000000-0000-0000-0000-0000000ad0a1');
select platform_customer_readiness();
reset role;
select is((select count(*)::text from pikas_private.platform_audit_events),current_setting('t.audit'),'The read writes no audit or state');

select * from finish();
rollback;
