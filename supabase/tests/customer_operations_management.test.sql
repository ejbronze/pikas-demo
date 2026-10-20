-- Backoffice Customer Management M2/M4: bounded non-financial cafeteria support management.
begin;
create extension if not exists pgtap with schema extensions;
set search_path=public,extensions;
select no_plan();
create function pg_temp.attempt(sql text) returns text language plpgsql as $$declare m text; begin execute sql; return 'ok';
 exception when others then get stacked diagnostics m=message_text; return sqlstate||':'||m; end$$;
create function pg_temp.as_user(u text) returns void language plpgsql as $$declare sid uuid:=gen_random_uuid(); begin
 execute 'reset role';
 perform set_config('pikas.customer_operations_account','',true); perform set_config('pikas.customer_operations_school','',true);
 perform set_config('pikas.customer_operations_cafeteria','',true); perform set_config('pikas.customer_operations_mode','',true);
 insert into auth.sessions(id,user_id,created_at,updated_at) values(sid,u::uuid,now(),now());
 insert into pikas_private.application_sessions(session_id,user_id,started_at,last_active_at) values(sid,u::uuid,clock_timestamp(),clock_timestamp());
 perform set_config('request.jwt.claim.sub',u,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',u,'role','authenticated','session_id',sid)::text,true);
 execute 'set local role authenticated'; end$$;
create function pg_temp.memberships(p uuid) returns text language sql security definer set search_path=public as $$
 select concat_ws('|',(select count(*) from account_memberships where person_id=p),(select count(*) from school_memberships where person_id=p),(select count(*) from cafeteria_memberships where person_id=p)) $$;
create function pg_temp.present(q text) returns boolean language plpgsql security definer set search_path=public as $$declare result boolean; begin execute 'select exists('||q||')' into result; return result; end$$;

reset role;
insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at,raw_app_meta_data,raw_user_meta_data)
 values('00000000-0000-0000-0000-00000000d0a0','00000000-0000-0000-0000-000000000000','authenticated','authenticated','admin.m2m4@example.invalid','',now(),now(),now(),'{}','{}');
insert into persons(id,auth_user_id,display_name) values('00000000-0000-0000-0000-00000000d0b0','00000000-0000-0000-0000-00000000d0a0','Admin Plataforma M2M4');
insert into pikas_private.platform_memberships(person_id,role_code) values('00000000-0000-0000-0000-00000000d0b0','platform_admin');
insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at,raw_app_meta_data,raw_user_meta_data)
 values('00000000-0000-0000-0000-00000000d0a2','00000000-0000-0000-0000-000000000000','authenticated','authenticated','cajera.m4@example.invalid','',now(),now(),now(),'{}','{}');
insert into persons(id,auth_user_id,display_name) values('00000000-0000-0000-0000-00000000d0c0','00000000-0000-0000-0000-00000000d0a2','Cajera ficticia existente');
insert into cafeteria_memberships(id,account_id,school_id,cafeteria_id,person_id,role_code,status)
 values('00000000-0000-4000-8000-00000000d0c1','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000111','00000000-0000-0000-0000-00000000d0c0','pos_cashier','active');
select set_config('t.admin','00000000-0000-0000-0000-00000000d0a0',true);
select set_config('t.actor','00000000-0000-0000-0000-00000000d0b0',true);
select set_config('t.a1','00000000-0000-0000-0000-000000000001',true);
select set_config('t.a2','00000000-0000-0000-0000-000000000002',true);
select set_config('t.s11','00000000-0000-0000-0000-000000000011',true);
select set_config('t.s12','00000000-0000-0000-0000-000000000012',true);
select set_config('t.c111','00000000-0000-0000-0000-000000000111',true);
select set_config('t.c121','00000000-0000-0000-0000-000000000121',true);
select set_config('t.before_memberships',pg_temp.memberships(current_setting('t.actor')::uuid),true);

-- A fictional read-only support operator proves separation from the new manage capability.
set local session_replication_role=replica;
insert into pikas_private.platform_roles(role_code) values('test_m2m4_reader');
insert into pikas_private.platform_role_capabilities(role_code,capability) values('test_m2m4_reader','platform:customer:operations:read');
set local session_replication_role=origin;
insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at,raw_app_meta_data,raw_user_meta_data)
 values('00000000-0000-0000-0000-00000000d0a1','00000000-0000-0000-0000-000000000000','authenticated','authenticated','solo.lectura.m2m4@example.invalid','',now(),now(),now(),'{}','{}');
insert into persons(id,auth_user_id,display_name) values('00000000-0000-0000-0000-00000000d0b1','00000000-0000-0000-0000-00000000d0a1','Soporte solo lectura');
insert into pikas_private.platform_memberships(person_id,role_code) values('00000000-0000-0000-0000-00000000d0b1','test_m2m4_reader');

select ok(exists(select 1 from pikas_private.platform_role_capabilities where role_code='platform_admin' and capability='platform:customer:operations:manage'),'operations:manage granted through Platform capabilities');
select ok(not has_function_privilege('authenticated','pikas_private.begin_customer_operations_scope(uuid,uuid,uuid,text)','execute'),'Private support context is not client-callable');
select ok(not has_function_privilege('anon','platform_support_cafeteria_command(uuid,uuid,uuid,text,jsonb)','execute'),'Anonymous cannot call support commands');

-- M2: same product command engine, true Platform audit, no membership.
select pg_temp.as_user(current_setting('t.admin'));
select is((platform_support_cafeteria_command(current_setting('t.a1')::uuid,current_setting('t.c111')::uuid,
 '00000000-0000-4000-8000-00000000d201','product_save',
 '{"id":"00000000-0000-4000-8000-00000000d211","version":null,"name":"Producto soporte ficticio","description":"Prueba local","category":"Comida","price_minor":12500,"unit":"Unidad","active":true,"available":true,"ingredients":[],"allergens":[]}'::jsonb))->>'operation','product_save','M2 creates a product through the shared command');
select ok(pg_temp.present(format($q$select 1 from cafeteria_products where id='00000000-0000-4000-8000-00000000d211' and cafeteria_id=%L::uuid and price_minor=12500$q$,current_setting('t.c111'))),'M2 product persisted in selected cafeteria');
select ok(pg_temp.present(format($q$select 1 from audit_events where request_id='00000000-0000-4000-8000-00000000d201' and actor_person_id=%L::uuid and authenticated_user_id=%L::uuid and actor_scope_kind='platform' and actor_role='platform_support'$q$,current_setting('t.actor'),current_setting('t.admin'))),'M2 command audit names the real Platform operator');

-- School administration (students, parents, staff) is not a Platform support surface.
select ok(to_regprocedure('public.platform_support_school_command(uuid,uuid,uuid,text,jsonb)') is null
 and to_regprocedure('public.platform_support_school_read(uuid,uuid,text,text,text,uuid,integer)') is null
 and to_regprocedure('public.platform_support_school_student_roster(uuid,uuid,text,text,uuid,integer,uuid,text)') is null
 and to_regprocedure('public.platform_support_student_bulk_validate(uuid,uuid,jsonb)') is null
 and to_regprocedure('public.platform_support_student_bulk_commit(uuid,uuid,uuid,jsonb,integer[],boolean)') is null,
 'No Platform school, roster or student-import support RPC exists');
select ok(to_regprocedure('pikas_private.require_school_admin_tenant(uuid,text,boolean)') is null,'School Admin guard is not routed through Platform support');
select alike(pg_temp.attempt($$select school_admin_command('00000000-0000-0000-0000-000000000011',gen_random_uuid(),'student_create','{"first_name":"Luna","last_name":"Ficticia","student_code":"SUP-X","location_id":null,"starts_on":"2026-10-20","grade":null,"class":null,"homeroom":null}')$$),'42501:%','Platform manager cannot create students through the School Admin engine');
select alike(pg_temp.attempt($$select school_student_bulk_commit('00000000-0000-0000-0000-000000000011',gen_random_uuid(),'[{"source_row":2,"first_name":"Sol","last_name":"Ficticia","student_code":"SUP-B","starts_on":"2026-10-20"}]',array[2],true)$$),'42501:%','Platform manager cannot bulk-import students');
select alike(pg_temp.attempt($$select school_admin_command('00000000-0000-0000-0000-000000000011',gen_random_uuid(),'admin_prepare','{"email":"x@example.invalid"}')$$),'42501:%','Platform manager cannot provision school staff through the School Admin engine');

-- M4: register configuration and assignment only to an existing active POS membership.
select set_config('t.staff','00000000-0000-4000-8000-00000000d0c1',true);
select is((platform_support_cafeteria_command(current_setting('t.a1')::uuid,current_setting('t.c111')::uuid,
 '00000000-0000-4000-8000-00000000d401','register_save',
 '{"id":"00000000-0000-4000-8000-00000000d411","version":null,"code":"SUP-M4","name":"Caja soporte ficticia","status":"active"}'::jsonb))->>'operation','register_save','M4 creates register configuration');
select is((platform_support_cafeteria_command(current_setting('t.a1')::uuid,current_setting('t.c111')::uuid,
 '00000000-0000-4000-8000-00000000d402','assignment_save',
 jsonb_build_object('membership_id',current_setting('t.staff'),'register_id','00000000-0000-4000-8000-00000000d411','status','active','version',null)))->>'operation','assignment_save','M4 assigns existing authorized staff');
select ok(pg_temp.present(format($q$select 1 from cafeteria_register_assignments where register_id='00000000-0000-4000-8000-00000000d411' and cafeteria_membership_id=%L::uuid and status='active'$q$,current_setting('t.staff'))),'M4 assignment references the pre-existing POS membership');
select is(pg_temp.memberships(current_setting('t.actor')::uuid),current_setting('t.before_memberships'),'Support writes create no tenant membership for the Platform operator');

-- Denials: capability, customer ancestry, sandbox, lifecycle, provisioning and finance.
select pg_temp.as_user('00000000-0000-0000-0000-00000000d0a1');
select alike(pg_temp.attempt($$select platform_support_cafeteria_command('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000111',gen_random_uuid(),'product_save','{}')$$),'42501:%','Read-only support cannot mutate');
select pg_temp.as_user(current_setting('t.admin'));
select is(pg_temp.attempt($$select platform_support_cafeteria_command('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000121',gen_random_uuid(),'register_save','{}')$$),'42501:customer_operations_scope_required','Wrong-customer cafeteria denied');
select is(pg_temp.attempt($$select platform_support_cafeteria_command('03e71159-69e9-4387-9b3b-65799d49faf0','b9496342-5079-46ae-83b8-05c39bcbd7fe',gen_random_uuid(),'product_save','{}')$$),'42501:customer_operations_scope_required','Sandbox customer denied');
reset role; update accounts set status='suspended' where id=current_setting('t.a1')::uuid;
select pg_temp.as_user(current_setting('t.admin'));
select is(pg_temp.attempt($$select platform_support_cafeteria_command('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000111',gen_random_uuid(),'product_save','{}')$$),'42501:customer_operations_scope_required','Suspended customer write denied');
select is(platform_support_cafeteria_read(current_setting('t.a1')::uuid,current_setting('t.c111')::uuid)->'scope'->>'account_status','suspended','Suspended customer remains readable');
reset role; update accounts set status='closed' where id=current_setting('t.a1')::uuid;
select pg_temp.as_user(current_setting('t.admin'));
select is(pg_temp.attempt($$select platform_support_cafeteria_command('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000111',gen_random_uuid(),'register_save','{}')$$),'42501:customer_operations_scope_required','Closed customer write denied');
reset role; update accounts set status='active' where id=current_setting('t.a1')::uuid;
select pg_temp.as_user(current_setting('t.admin'));
select is(pg_temp.attempt($$select platform_support_cafeteria_command('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000111',gen_random_uuid(),'staff_prepare','{}')$$),'42501:customer_operations_command_denied','Staff provisioning is outside the allow-list');
select is(pg_temp.attempt($$select platform_support_cafeteria_command('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000111',gen_random_uuid(),'student_create','{}')$$),'42501:customer_operations_command_denied','Student management is outside the allow-list');
select is(pg_temp.attempt($$select platform_support_cafeteria_command('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000111',gen_random_uuid(),'checkout_purchase','{}')$$),'42501:customer_operations_command_denied','POS checkout is outside the allow-list');
select ok((select bool_and(pg_temp.attempt(format($sql$select platform_support_cafeteria_command('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000111',gen_random_uuid(),%L,'{}')$sql$,operation))='42501:customer_operations_command_denied')
 from unnest(array['refund_purchase','wallet_replenish','wallet_adjust','wallet_reverse','settlement_export','register_close','register_exception','transaction_update','transaction_delete','financial_report_grant','tenant_lifecycle_update','identity_update']) operation),
 'Refunds, wallets, settlements, closes, transaction edits, financial authority, lifecycle and identity changes are all outside the allow-list');
select is(pg_temp.attempt($$select platform_support_cafeteria_command('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000111',gen_random_uuid(),'staff_status','{}')$$),'42501:customer_operations_command_denied','Support cannot grant or change POS membership authority');
select alike(pg_temp.attempt($$select school_wallet_replenish('00000000-0000-0000-0000-000000000011',gen_random_uuid(),100,gen_random_uuid(),'manual_verified','x')$$),'42501:%','Manage capability alone cannot replenish wallets');
select alike(pg_temp.attempt($$select cafeteria_operations_close('00000000-0000-0000-0000-000000000111',gen_random_uuid(),1,1000::bigint,'other','Prueba',gen_random_uuid(),1000)$$),'42501:%','Manage capability alone cannot exceptionally close a register');

-- Ordinary tenant commands retain tenant attribution and behavior.
select pg_temp.as_user('00000000-0000-0000-0000-000000002003');
select is((cafeteria_admin_command(current_setting('t.c111')::uuid,'00000000-0000-4000-8000-00000000d501','category_save',
 '{"id":"00000000-0000-4000-8000-00000000d511","version":null,"name":"Tenant intacto","display_order":99,"status":"active"}'::jsonb))->>'operation','category_save','Normal Cafeteria Admin command still works');
select ok(pg_temp.present($q$select 1 from audit_events where request_id='00000000-0000-4000-8000-00000000d501' and actor_scope_kind='cafeteria' and actor_role='cafeteria_admin'$q$),'Tenant audit attribution remains unchanged');

select * from finish();
rollback;
