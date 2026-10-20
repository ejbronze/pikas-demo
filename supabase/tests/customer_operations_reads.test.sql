-- Backoffice Customer Management M1: platform:customer:operations:read (202610290001).
-- Fictional local fixtures; everything is rolled back. Account 1 = customer (cafeterias 111/112/113),
-- account 2 = another customer (cafeteria 121), 03e71159… = sandbox tenant.
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
create function pg_temp.memberships(p text) returns text language sql security definer set search_path=public as $$
 select concat_ws('|',(select count(*) from account_memberships where person_id=p::uuid),(select count(*) from school_memberships where person_id=p::uuid),(select count(*) from cafeteria_memberships where person_id=p::uuid)) $$;
reset role;
select set_config('t.admin','8f6f4cb4-de08-41bf-a062-156f636873b2',true);
select set_config('t.admin_person',(select id::text from persons where auth_user_id='8f6f4cb4-de08-41bf-a062-156f636873b2'),true);
select set_config('t.a1','00000000-0000-0000-0000-000000000001',true);
select set_config('t.c111','00000000-0000-0000-0000-000000000111',true);

-- Test-only Platform role holding ONLY operations:read, and a fictional operator with it.
set local session_replication_role=replica;
insert into pikas_private.platform_roles(role_code) values('test_operations_reader');
insert into pikas_private.platform_role_capabilities(role_code,capability) values('test_operations_reader','platform:customer:operations:read');
set local session_replication_role=origin;
insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at,raw_app_meta_data,raw_user_meta_data)
 values('00000000-0000-0000-0000-00000000c0a1','00000000-0000-0000-0000-000000000000','authenticated','authenticated','soporte.m1@example.invalid','',now(),now(),now(),'{}','{}');
insert into persons(id,auth_user_id,display_name) values('00000000-0000-0000-0000-00000000c0b1','00000000-0000-0000-0000-00000000c0a1','Soporte Ficticio M1');
insert into pikas_private.platform_memberships(person_id,role_code) values('00000000-0000-0000-0000-00000000c0b1','test_operations_reader');
select set_config('t.reader','00000000-0000-0000-0000-00000000c0a1',true);
select set_config('t.before_admin',pg_temp.memberships(current_setting('t.admin_person')),true);
select set_config('t.before_reader',pg_temp.memberships('00000000-0000-0000-0000-00000000c0b1'),true);

-- Grants and privileges
select ok(exists(select 1 from pikas_private.platform_role_capabilities where role_code='platform_admin' and capability='platform:customer:operations:read'),'operations:read granted to platform_admin');
select ok(not exists(select 1 from pikas_private.platform_capabilities where capability='platform:customer:operations:manage'),'operations:manage is NOT created');
select ok(not has_function_privilege('authenticated','pikas_private.cafeteria_admin_read_core(uuid,uuid)','execute')
 and not has_function_privilege('authenticated','pikas_private.require_customer_operations_read(uuid,uuid)','execute')
 and not has_function_privilege('authenticated','pikas_private.cafeteria_read_scope(uuid,uuid,text)','execute'),'Cores and support guard are not client-callable');
select ok(not has_function_privilege('anon','platform_support_cafeteria_read(uuid,uuid)','execute'),'No anonymous support read');

-- 1: active customer, real Platform actor, no membership
select pg_temp.as_user(current_setting('t.admin'));
select is((select concat_ws('|',r->'scope'->>'support',r->'scope'->>'actor_id',coalesce(r->'scope'->>'membership_id','null'),r->'scope'->>'account_status',jsonb_typeof(r->'products'))
 from (select platform_support_cafeteria_read(current_setting('t.a1')::uuid,current_setting('t.c111')::uuid) r) x),
 'true|'||current_setting('t.admin_person')||'|null|active|array','Active customer: Platform admin reads the cafeteria as itself (no membership)');
select is(platform_support_cafeteria_transactions_read(current_setting('t.a1')::uuid,current_setting('t.c111')::uuid,'last_7_days')->>'cafeteria_id',current_setting('t.c111'),'Transactions history readable');
select is(platform_support_cafeteria_report_read(current_setting('t.a1')::uuid,current_setting('t.c111')::uuid,'sales_summary','last_7_days')->>'kind','sales_summary','Sales report readable');
select is(platform_support_cafeteria_operations_read(current_setting('t.a1')::uuid,current_setting('t.c111')::uuid,'sessions')->>'cafeteria_id',current_setting('t.c111'),'Register sessions readable');
select is(jsonb_array_length(platform_customer_operations_overview(current_setting('t.a1')::uuid)->'schools'),2,'Customer hierarchy derived server-side');
select pg_temp.as_user(current_setting('t.reader'));
select is(platform_support_cafeteria_read(current_setting('t.a1')::uuid,current_setting('t.c111')::uuid)->'scope'->>'actor_id','00000000-0000-0000-0000-00000000c0b1','An operator holding ONLY operations:read can read');
reset role;

-- 2/3: suspended and closed customers stay readable for support (tenant rules unchanged)
update accounts set status='suspended' where id=current_setting('t.a1')::uuid;
select pg_temp.as_user(current_setting('t.reader'));
select is(platform_support_cafeteria_read(current_setting('t.a1')::uuid,current_setting('t.c111')::uuid)->'scope'->>'account_status','suspended','Suspended customer: support read allowed');
select pg_temp.as_user('00000000-0000-0000-0000-000000002003');
select alike(pg_temp.attempt($$select cafeteria_admin_read('00000000-0000-0000-0000-000000000111')$$),'42501:%','Suspended customer: tenant Cafeteria Admin still blocked (unchanged)');
reset role; update accounts set status='closed' where id=current_setting('t.a1')::uuid;
select pg_temp.as_user(current_setting('t.reader'));
select is(platform_support_cafeteria_transactions_read(current_setting('t.a1')::uuid,current_setting('t.c111')::uuid,'last_7_days')->>'cafeteria_id',current_setting('t.c111'),'Closed customer: historical transactions readable');
select is(platform_support_cafeteria_read(current_setting('t.a1')::uuid,current_setting('t.c111')::uuid)->'scope'->>'account_status','closed','Closed customer: support read allowed');
reset role; update accounts set status='active' where id=current_setting('t.a1')::uuid;

-- 4–9: who is denied
select pg_temp.as_user('ec08ad21-4020-4b0d-b041-ee4a1fe09471');
select alike(pg_temp.attempt($$select platform_support_cafeteria_read('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000111')$$),'42501:%','Sandbox operator alone is denied');
select alike(pg_temp.attempt($$select platform_customer_operations_overview('00000000-0000-0000-0000-000000000001')$$),'42501:%','Sandbox operator cannot read the hierarchy');
select pg_temp.as_user('00000000-0000-0000-0000-000000002001');
select alike(pg_temp.attempt($$select platform_support_cafeteria_read('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000111')$$),'42501:%','Account Admin is not granted support authority');
select pg_temp.as_user('00000000-0000-0000-0000-000000002002');
select alike(pg_temp.attempt($$select platform_support_cafeteria_transactions_read('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000111','last_7_days')$$),'42501:%','School Admin is not granted support authority');
select pg_temp.as_user('00000000-0000-0000-0000-000000002003');
select alike(pg_temp.attempt($$select platform_support_cafeteria_read('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000111')$$),'42501:%','Cafeteria Admin is not granted support authority');
select pg_temp.as_user('00000000-0000-0000-0000-000000002008');
select alike(pg_temp.attempt($$select platform_support_cafeteria_report_read('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000111','sales_summary','today')$$),'42501:%','Cashier is denied');

-- 10–12: scope validation
select pg_temp.as_user(current_setting('t.reader'));
select is(pg_temp.attempt($$select platform_support_cafeteria_read('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000121')$$),'42501:customer_operations_scope_required','Customer A context cannot read customer B cafeteria');
select is(pg_temp.attempt($$select platform_support_cafeteria_transaction_detail('00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000111',gen_random_uuid())$$),'42501:customer_operations_scope_required','A cafeteria not belonging to the supplied account is refused (detail too)');
select is(pg_temp.attempt($$select platform_support_cafeteria_read(null,'00000000-0000-0000-0000-000000000111')$$),'42501:customer_operations_scope_required','An account is always required');
select is(pg_temp.attempt($$select platform_support_cafeteria_read('03e71159-69e9-4387-9b3b-65799d49faf0','b9496342-5079-46ae-83b8-05c39bcbd7fe')$$),'42501:customer_operations_scope_required','Sandbox tenant is refused');
select is(pg_temp.attempt($$select platform_customer_operations_overview('03e71159-69e9-4387-9b3b-65799d49faf0')$$),'42501:customer_operations_scope_required','Sandbox hierarchy is refused');

-- 13–18: operations:read alone mutates nothing (tenant commands keep requiring tenant authority)
select alike(pg_temp.attempt($$select cafeteria_admin_read('00000000-0000-0000-0000-000000000111')$$),'42501:%','Tenant read RPC still requires tenant authority');
select alike(pg_temp.attempt($$select cafeteria_admin_command('00000000-0000-0000-0000-000000000111',gen_random_uuid(),'product_save','{"id":"00000000-0000-0000-0000-00000000d001","version":null,"name":"X","description":"","category":"Comida","price_minor":"100","active":true,"available":true,"ingredients":[],"allergens":[]}')$$),'42501:%','Catalog mutation denied');
select alike(pg_temp.attempt($$select cafeteria_admin_command('00000000-0000-0000-0000-000000000111',gen_random_uuid(),'register_save','{"id":"00000000-0000-0000-0000-00000000d002","version":null,"code":"Z9","name":"Z","status":"active"}')$$),'42501:%','Register mutation denied');
select alike(pg_temp.attempt($$select cafeteria_admin_command('00000000-0000-0000-0000-000000000111',gen_random_uuid(),'staff_prepare','{"email":"x.m1@example.invalid","role":"pos_cashier"}')$$),'42501:%','Staff access preparation denied');
select alike(pg_temp.attempt($$select cafeteria_operations_close('00000000-0000-0000-0000-000000000111',gen_random_uuid(),1,1000::bigint,'other','Prueba',gen_random_uuid(),1000)$$),'42501:%','Exceptional register close denied');
select alike(pg_temp.attempt($$select platform_set_customer_lifecycle(gen_random_uuid(),'00000000-0000-0000-0000-000000000001','active','suspend','Prueba')$$),'42501:%','Lifecycle mutation denied');
select alike(pg_temp.attempt($$select platform_add_school_location(gen_random_uuid(),'00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011','X','X','Y','Y')$$),'42501:%','Tenant provisioning (Agregar sede) denied');
select alike(pg_temp.attempt($$select identity_support_lookup('nadie@example.invalid')$$),'42501:%','Identity support denied');
reset role;

-- Wallet and refund RPCs: every signature granted to clients refuses this operator.
create temp table m1_fin(sig text, result text);
do $$declare f record; args text; r text;
begin
 for f in select p.oid::regprocedure::text sig, p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and has_function_privilege('authenticated',p.oid,'execute')
   and p.proname ~ '(wallet_(replenish|adjust|reverse)|refund|settle|checkout_purchase|exceptionally_close)' loop
  select string_agg('null',',') into args from unnest(string_to_array(trim(both '()' from regexp_replace(f.sig,'^[^(]*','')),',')) x where x<>'';
  insert into m1_fin values(f.sig,null);
 end loop;
end $$;
grant select, update on m1_fin to authenticated;
select pg_temp.as_user(current_setting('t.reader'));
do $$declare f record; m text; s text; args text;
begin
 for f in select sig from m1_fin loop
  select coalesce(string_agg('null',','),'') into args from unnest(string_to_array(trim(both '()' from regexp_replace(f.sig,'^[^(]*','')),',')) x where btrim(x)<>'';
  begin execute format('select %s(%s)',split_part(f.sig,'(',1),args); s:='ok';
  exception when others then get stacked diagnostics m=message_text; s:=sqlstate||':'||m; end;
  update m1_fin set result=s where sig=f.sig;
 end loop;
end $$;
reset role;
select ok((select count(*)>=5 from m1_fin),'Financial RPCs probed: '||(select count(*) from m1_fin));
select is((select string_agg(sig,', ') from m1_fin where result='ok'),null,'No wallet/refund/settlement/checkout/close RPC succeeds for operations:read');

-- 19: tenant reads unchanged
select pg_temp.as_user('00000000-0000-0000-0000-000000002003');
select ok((select r->'scope'->>'membership_id' is not null and (r->'scope') ? 'capabilities' and not (r->'scope') ? 'support' from (select cafeteria_admin_read('00000000-0000-0000-0000-000000000111') r) x),'Cafeteria Admin tenant read unchanged (membership scope)');
select alike(pg_temp.attempt($$select cafeteria_admin_read('00000000-0000-0000-0000-000000000112')$$),'42501:%','Tenant still cannot read another cafeteria');
reset role;

-- 20: no tenant membership created for any operator
select is(pg_temp.memberships(current_setting('t.admin_person')),current_setting('t.before_admin'),'No membership created for the Platform admin');
select is(pg_temp.memberships('00000000-0000-0000-0000-00000000c0b1'),'0|0|0','No membership created for the support operator');

select * from finish();
rollback;
