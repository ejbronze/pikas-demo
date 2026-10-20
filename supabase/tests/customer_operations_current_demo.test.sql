-- Customer Operations ignores expired Demo history; only a CURRENT (active and unexpired) POV blocks.
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
-- One fictional Platform operator per Demo-history case; n selects the user/person ids.
create function pg_temp.operator(n int,role text,demo text) returns void language plpgsql as $$
declare u uuid:=('00000000-0000-0000-0000-0000000fd0a'||n)::uuid; p uuid:=('00000000-0000-0000-0000-0000000fd0b'||n)::uuid;
 pr pikas_private.sandbox_pov_personas%rowtype; begin
 insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at,raw_app_meta_data,raw_user_meta_data)
  values(u,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','demo.case.'||n||'@example.invalid','',now(),now(),now(),'{}','{}');
 insert into persons(id,auth_user_id,display_name) values(p,u,'Operador ficticio caso '||n);
 insert into pikas_private.platform_memberships(person_id,role_code) values(p,role);
 if demo='none' then return; end if;
 select * into pr from pikas_private.sandbox_pov_personas where pov_code='cashier' order by id limit 1;
 insert into pikas_private.sandbox_pov_sessions(request_id,initiator_person_id,initiator_auth_user_id,account_id,school_id,cafeteria_id,pov_code,
  persona_id,persona_person_id,persona_membership_id,status,started_at,expires_at,ended_at,end_reason)
 values(gen_random_uuid(),p,u,pr.account_id,pr.school_id,pr.cafeteria_id,'cashier',pr.id,pr.person_id,pr.cafeteria_membership_id,
  case when demo='closed' then 'exited' else 'active' end,
  case when demo='current' then now()-interval '5 minutes' else now()-interval '3 days' end,
  case when demo='current' then now()+interval '1 hour' else now()-interval '3 days'+interval '1 hour' end,
  case when demo='closed' then now()-interval '3 days'+interval '30 minutes' end,
  case when demo='closed' then 'exited' end);
end$$;

reset role;
select pg_temp.operator(1,'platform_admin','none');
select pg_temp.operator(2,'platform_admin','expired');
select pg_temp.operator(3,'platform_admin','current');
select pg_temp.operator(4,'platform_admin','closed');
select pg_temp.operator(5,'platform_sandbox_operator','expired');
select is((select count(*)::int from pikas_private.sandbox_pov_sessions s join persons p on p.auth_user_id=s.initiator_auth_user_id
 where p.id in ('00000000-0000-0000-0000-0000000fd0b2','00000000-0000-0000-0000-0000000fd0b3') and s.status='active'),2,'Expired and current cases both carry status active');
select ok((select prosrc from pg_proc where oid='pikas_private.sandbox_pov_active_attempt()'::regprocedure) !~ 'expires_at','sandbox_pov_active_attempt() keeps its fail-closed, expiry-agnostic definition');
select ok(not has_function_privilege('authenticated','pikas_private.sandbox_pov_current_attempt()','execute'),'Current-Demo helper is not client-callable');
select ok(not has_function_privilege('authenticated','pikas_private.sandbox_admin_actor(text)','execute'),'sandbox_admin_actor wrapper is not client-callable');
select ok((select prosrc from pg_proc where oid='pikas_private.sandbox_admin_actor_tenant(text)'::regprocedure) ~ 'sandbox_pov_active_attempt\(\)','Original tenant/Demo actor resolution is preserved, fail-closed, under sandbox_admin_actor_tenant');

create function pg_temp.ops(label text,expect text) returns setof text language plpgsql as $$
declare read_sql text:=$q$select platform_customer_operations_overview('00000000-0000-0000-0000-000000000001')$q$;
 caf_sql text:=$q$select platform_support_cafeteria_read('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000111')$q$;
 cmd_sql text:=format($q$select platform_support_cafeteria_command('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000111',gen_random_uuid(),'category_save',%L::jsonb)$q$,
  jsonb_build_object('id',gen_random_uuid(),'version',null,'name','Demo '||label,'display_order',90,'status','active')::text);
begin
 if expect='ok' then
  return next is(pg_temp.attempt(read_sql),'ok',label||': customer operations overview allowed');
  return next is(pg_temp.attempt(caf_sql),'ok',label||': cafeteria support read allowed');
  return next is(pg_temp.attempt(cmd_sql),'ok',label||': approved support command allowed');
 else
  return next is(pg_temp.attempt(read_sql),expect,label||': customer operations overview refused');
  return next is(pg_temp.attempt(caf_sql),expect,label||': cafeteria support read refused');
  return next is(pg_temp.attempt(cmd_sql),expect,label||': approved support command refused');
 end if;
end$$;

select pg_temp.as_user('00000000-0000-0000-0000-0000000fd0a1'); select pg_temp.ops('No Demo history','ok');
select pg_temp.as_user('00000000-0000-0000-0000-0000000fd0a2'); select pg_temp.ops('Expired but status-active Demo','ok');
select pg_temp.as_user('00000000-0000-0000-0000-0000000fd0a4'); select pg_temp.ops('Closed historical Demo','ok');
select pg_temp.as_user('00000000-0000-0000-0000-0000000fd0a3'); select pg_temp.ops('Current unexpired Demo','42501:customer_operations_authority_required');
select pg_temp.as_user('00000000-0000-0000-0000-0000000fd0a5'); select pg_temp.ops('Missing customer-operations capability (expired Demo)','42501:not_authorized');

-- Unchanged boundaries for an operator whose expired history no longer blocks.
select pg_temp.as_user('00000000-0000-0000-0000-0000000fd0a2');
select is(pg_temp.attempt($$select platform_support_cafeteria_read('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000121')$$),'42501:customer_operations_scope_required','Cross-customer cafeteria read denied');
select is(pg_temp.attempt($$select platform_support_cafeteria_command('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000121',gen_random_uuid(),'register_save','{}')$$),'42501:customer_operations_scope_required','Cross-customer command denied');
select is(pg_temp.attempt($$select platform_customer_operations_overview('03e71159-69e9-4387-9b3b-65799d49faf0')$$),'42501:customer_operations_scope_required','Sandbox tenant is not a support customer');
select ok((select bool_and(pg_temp.attempt(format($sql$select platform_support_cafeteria_command('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000111',gen_random_uuid(),%L,'{}')$sql$,op))='42501:customer_operations_command_denied')
 from unnest(array['checkout_purchase','refund_purchase','wallet_replenish','wallet_adjust','wallet_reverse','register_close','register_exception','transaction_delete','staff_prepare','staff_status','student_create','tenant_lifecycle_update','identity_update']) op),
 'Financial, provisioning, roster, lifecycle and identity operations remain refused');
select alike(pg_temp.attempt($$select school_wallet_replenish('00000000-0000-0000-0000-000000000011',gen_random_uuid(),100,gen_random_uuid(),'manual_verified','x')$$),'42501:%','Wallet replenishment still refused for Platform');
reset role;
select ok(exists(select 1 from audit_events where actor_person_id='00000000-0000-0000-0000-0000000fd0b2' and actor_scope_kind='platform' and actor_role='platform_support'),'Allowed command keeps truthful Platform audit attribution');

select * from finish();
rollback;
