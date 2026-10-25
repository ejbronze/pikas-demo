-- PIKAS Reporting Consolidation: Platform network reads (202611230001). Fictional local fixtures only; rolls back.
-- Foundation fixtures: SYNTHETIC-A (account 1: cafeterías 111, 113 and 112), SYNTHETIC-B (account 2: cafetería 121),
-- sandbox Colegio Horizonte. Cashier 2008 sells at 111 through register 9401 (assignment 9501) to customer 6901.
begin;
create extension if not exists pgtap with schema extensions;
set search_path=public,extensions;
select no_plan();

create function pg_temp.attempt(sql text) returns text language plpgsql as $$declare m text; s text; begin execute sql; return 'ok';
 exception when others then get stacked diagnostics m=message_text, s=returned_sqlstate; return s||':'||m; end$$;
create function pg_temp.as_user(u text) returns void language plpgsql as $$begin
 execute 'reset role'; perform set_config('request.jwt.claim.sub',u,true); execute 'set local role authenticated'; end$$;
create function pg_temp.as_operator(u text) returns void language plpgsql as $$declare sid uuid:=gen_random_uuid(); begin
 execute 'reset role';
 insert into auth.sessions(id,user_id,created_at,updated_at) values(sid,u::uuid,now(),now());
 insert into pikas_private.application_sessions(session_id,user_id,started_at,last_active_at) values(sid,u::uuid,clock_timestamp(),clock_timestamp());
 perform set_config('request.jwt.claim.sub',u,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',u,'role','authenticated','session_id',sid)::text,true);
 execute 'set local role authenticated'; end$$;
create function pg_temp.caf(r jsonb, id text) returns jsonb language sql as $$
 select c from jsonb_array_elements(r->'customers') a, jsonb_array_elements(a->'cafeterias') c where c->>'cafeteria_id'=id$$;
create function pg_temp.cust(r jsonb, code text) returns jsonb language sql as $$ select a from jsonb_array_elements(r->'customers') a where a->>'code'=code$$;
grant execute on all functions in schema pg_temp to authenticated;

-- Fictional Platform operators: OPS (customer operations read), FIN (finance read only), NONE (team only).
insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at,raw_app_meta_data,raw_user_meta_data)
 select ('00000000-0000-0000-0000-0000000f9d0'||n)::uuid,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','reports.test.'||n||'@example.invalid','',now(),now(),now(),'{}','{}' from generate_series(1,3) n;
insert into persons(id,auth_user_id,display_name) select ('00000000-0000-0000-0000-0000000f9e0'||n)::uuid,('00000000-0000-0000-0000-0000000f9d0'||n)::uuid,'Reportes ficticio '||n from generate_series(1,3) n;
insert into pikas_private.platform_roles(role_code) values('reports_test_ops'),('reports_test_fin'),('reports_test_none');
insert into pikas_private.platform_role_capabilities(role_code,capability) values('reports_test_ops','platform:customer:operations:read'),('reports_test_fin','platform:finance:read'),('reports_test_none','platform:team:manage');
insert into pikas_private.platform_memberships(person_id,role_code) values('00000000-0000-0000-0000-0000000f9e01','reports_test_ops'),('00000000-0000-0000-0000-0000000f9e02','reports_test_fin'),('00000000-0000-0000-0000-0000000f9e03','reports_test_none');

-- ── ACLs ───────────────────────────────────────────────────────────────────────────────────────
select ok(has_function_privilege('authenticated','platform_network_report(text,date,date,boolean)','execute') and has_function_privilege('authenticated','platform_finance_report(text,date,date)','execute')
 and not has_function_privilege('anon','platform_network_report(text,date,date,boolean)','execute') and not has_function_privilege('anon','platform_finance_report(text,date,date)','execute')
 and not has_function_privilege('service_role','platform_network_report(text,date,date,boolean)','execute'),'Report reads: authenticated only (no anon, no service role)');
select is((select count(*) from pg_proc p, aclexplode(p.proacl) a where p.proname in ('platform_network_report','platform_finance_report') and a.grantee=0),0::bigint,'No PUBLIC EXECUTE');
select ok(not has_function_privilege('authenticated','pikas_private.network_report_period(text,date,date)','execute'),'The period helper is private');
select ok((select bool_and(prosecdef and proconfig=array['search_path=""'] and prosrc like '%sandbox_pov_current_attempt%') from pg_proc where proname in ('platform_network_report','platform_finance_report')),
 'SECURITY DEFINER, empty search path, Demo POV refused');
select is((select count(*) from pikas_private.role_capabilities where capability like 'platform:%'),0::bigint,'No tenant role gains a Platform reporting capability');

-- ── Authority ──────────────────────────────────────────────────────────────────────────────────
select pg_temp.as_operator('00000000-0000-0000-0000-0000000f9d03');
select is(pg_temp.attempt($$select platform_network_report('last_30_days')$$),'42501:not_authorized','Platform operator without customer-operations read: refused');
select pg_temp.as_operator('00000000-0000-0000-0000-0000000f9d01');
select is(pg_temp.attempt($$select platform_finance_report('last_30_days')$$),'42501:not_authorized','Customer-operations read does not grant finance reporting');
select pg_temp.as_operator('00000000-0000-0000-0000-0000000f9d02');
select is(pg_temp.attempt($$select platform_network_report('last_30_days')$$),'42501:not_authorized','Finance read does not grant network reporting');
select pg_temp.as_user('00000000-0000-0000-0000-000000002002');
select is(pg_temp.attempt($$select platform_network_report('last_30_days')$$),'42501:not_authorized','School Admin: refused');
select pg_temp.as_user('00000000-0000-0000-0000-000000002003');
select is(pg_temp.attempt($$select platform_finance_report('last_30_days')$$),'42501:not_authorized','Cafetería Admin: refused');
reset role;

-- ── Sandbox exclusion ──────────────────────────────────────────────────────────────────────────
select pg_temp.as_operator('00000000-0000-0000-0000-0000000f9d01');
select set_config('t.r',platform_network_report('last_30_days')::text,true);
select is((select string_agg(a->>'code',',' order by a->>'code') from jsonb_array_elements(current_setting('t.r')::jsonb->'customers') a),'SYNTHETIC-A,SYNTHETIC-B','Default: real customers only (Colegio Horizonte excluded)');
select is((current_setting('t.r')::jsonb->>'include_demo')::boolean,false,'…and says Demo is not included');
select set_config('t.d',platform_network_report('last_30_days',null,null,true)::text,true);
select is((select string_agg((a->>'code')||':'||(a->>'demo'),',' order by a->>'code') from jsonb_array_elements(current_setting('t.d')::jsonb->'customers') a),
 'COLEGIO-HORIZONTE:true,SYNTHETIC-A:false,SYNTHETIC-B:false','Incluir Demo: Horizonte appears, flagged as Demo');
reset role;

-- ── Readiness facts (released definitions) ─────────────────────────────────────────────────────
select is((select concat_ws('/',c->>'operating',c->>'registers_staffed',c->>'products_available',c->>'operationally_ready',c->>'student_service',c->>'enabled_students')
 from pg_temp.caf(current_setting('t.r')::jsonb,'00000000-0000-0000-0000-000000000111') c),'true/2/2/true/ready/1','Cafetería 111: operationally ready (staffed caja + products) and student service ready');
select is((select concat_ws('/',c->>'operationally_ready',c->>'student_service') from pg_temp.caf(current_setting('t.r')::jsonb,'00000000-0000-0000-0000-000000000113') c),'false/not_shared',
 'Cafetería 113: no products → not operationally ready; no sharing → not_shared (readiness and student service are separate)');
-- Scheduling enabled without an enabled shift: not operationally ready.
update cafeteria_operation_settings set scheduling_enabled=true where cafeteria_id='00000000-0000-0000-0000-000000000111';
update cafeteria_service_shifts set enabled=false where cafeteria_id='00000000-0000-0000-0000-000000000111';
select pg_temp.as_operator('00000000-0000-0000-0000-0000000f9d01');
select is((select c->>'operationally_ready' from pg_temp.caf(platform_network_report('last_30_days'),'00000000-0000-0000-0000-000000000111') c),'false','Scheduling on with no enabled turno: not operationally ready');
reset role;
update cafeteria_service_shifts set enabled=true where cafeteria_id='00000000-0000-0000-0000-000000000111';
update cafeteria_operation_settings set scheduling_enabled=false where cafeteria_id='00000000-0000-0000-0000-000000000111';
-- Revoked sharing changes student service, not operational readiness.
update school_cafeteria_shares set status='revoked' where cafeteria_id='00000000-0000-0000-0000-000000000111';
select pg_temp.as_operator('00000000-0000-0000-0000-0000000f9d01');
select is((select concat_ws('/',c->>'operationally_ready',c->>'student_service') from pg_temp.caf(platform_network_report('last_30_days'),'00000000-0000-0000-0000-000000000111') c),'true/sharing_revoked',
 'Sharing revoked: student service changes; operational readiness does not');
reset role;
update school_cafeteria_shares set status='active' where cafeteria_id='00000000-0000-0000-0000-000000000111';

-- ── Lifecycle footprint ────────────────────────────────────────────────────────────────────────
update accounts set status='suspended' where id='00000000-0000-0000-0000-000000000002';
update cafeterias set status='inactive' where id='00000000-0000-0000-0000-000000000113';
update cafeteria_registers set status='inactive', version=version+1 where id=(select id from cafeteria_registers where cafeteria_id='00000000-0000-0000-0000-000000000111' order by id limit 1);
select pg_temp.as_operator('00000000-0000-0000-0000-0000000f9d01');
select set_config('t.l',platform_network_report('last_30_days')::text,true);
reset role;
select is((pg_temp.cust(current_setting('t.l')::jsonb,'SYNTHETIC-B'))->>'status','suspended','Suspended customer keeps its lifecycle (still reported, never hidden)');
select is((select concat_ws('/',c->>'status',c->>'operating',c->>'operationally_ready') from pg_temp.caf(current_setting('t.l')::jsonb,'00000000-0000-0000-0000-000000000113') c),'inactive/false/false',
 'Inactive cafetería: reported as inactive, not operating, not ready (never "deleted")');
select is((select concat_ws('/',c->>'registers_active',c->>'registers_inactive') from pg_temp.caf(current_setting('t.l')::jsonb,'00000000-0000-0000-0000-000000000111') c),'1/1','Cajas split active / inactive');

-- ── Activity in the period (business_date) ─────────────────────────────────────────────────────
select pg_temp.as_user('00000000-0000-0000-0000-000000002008');
select set_config('t.sid',(select session_id::text from open_register_session((select r.id from cafeteria_registers r where r.cafeteria_id='00000000-0000-0000-0000-000000000111' and r.status='active' order by r.id limit 1),
 (select ra.id from cafeteria_register_assignments ra join cafeteria_registers r on r.id=ra.register_id where r.cafeteria_id='00000000-0000-0000-0000-000000000111' and r.status='active' and ra.status='active'
  and ra.operator_person_id=(select id from persons where auth_user_id='00000000-0000-0000-0000-000000002008') order by ra.id limit 1),0,'reports-open-cashier-01')),true);
reset role;
select ok(current_setting('t.sid') <> '','Cashier opened a caja');
select pg_temp.as_user('00000000-0000-0000-0000-000000002008');
select ok((checkout_purchase(jsonb_build_object('request_key','reports-sale-key-00001','register_session_id',current_setting('t.sid'),'cafeteria_customer_id','00000000-0000-0000-0000-000000006901',
 'items',jsonb_build_array(jsonb_build_object('product_id','00000000-0000-0000-0000-000000008101','quantity',1,'expected_product_version',1,'expected_unit_price_minor','5000')),
 'expected_total_minor','5000','tender',jsonb_build_object('type','cash','cash_received_minor','5000')))->>'purchase_id') is not null,'A real sale today at 111');
select pg_temp.as_operator('00000000-0000-0000-0000-0000000f9d01');
select is((select concat_ws('/',c->>'sales',c->>'students_served',(c->>'last_sale_at') is not null) from pg_temp.caf(platform_network_report('today'),'00000000-0000-0000-0000-000000000111') c),'1/1/t',
 'Hoy: one sale, one student served, last sale known');
reset role;

-- ── Santo Domingo dates at the AST/UTC boundary (private report clock) ────────────────────────
create or replace function pikas_private.report_clock() returns timestamptz language sql volatile set search_path='' as $$select '2026-10-25 01:30:00+00'::timestamptz$$;
select pg_temp.as_operator('00000000-0000-0000-0000-0000000f9d01');
select is((select concat_ws('/',x->>'today',x->>'from',x->>'to') from (select platform_network_report('today')->'period' x) y),'2026-10-24/2026-10-24/2026-10-24',
 '21:30 AST (01:30 UTC next day): «Hoy» is still the Santo Domingo date');
select is((select concat_ws('/',x->>'from',x->>'to') from (select platform_network_report('last_7_days')->'period' x) y),'2026-10-18/2026-10-24','Últimos 7 días end on the Santo Domingo date');
select is(pg_temp.attempt($$select platform_network_report('custom','2026-10-24','2026-10-25')$$),'22023:invalid_report_range','A range ending on the UTC date (tomorrow in Santo Domingo) is refused');
select is(pg_temp.attempt($$select platform_network_report('custom','2026-07-01','2026-10-24')$$),'22023:invalid_report_range','More than 92 days is refused');
select is(pg_temp.attempt($$select platform_network_report('custom','2026-10-20','2026-10-10')$$),'22023:invalid_report_range','Inverted range is refused');
select is(pg_temp.attempt($$select platform_network_report('this_year')$$),'22023:invalid_report_period','Unknown period is refused (never widened)');
select is((select x->>'today' from (select platform_network_report('today')->'period' x) y),'2026-10-24','(clock seam honoured)');
reset role;
create or replace function pikas_private.report_clock() returns timestamptz language sql volatile set search_path='' as $$select '2026-10-25 04:00:00+00'::timestamptz$$;
select pg_temp.as_operator('00000000-0000-0000-0000-0000000f9d01');
select is((platform_network_report('today')->'period'->>'today'),'2026-10-25','At 00:00 AST the report day turns');
reset role;
create or replace function pikas_private.report_clock() returns timestamptz language sql volatile set search_path='' as $$select pg_catalog.clock_timestamp()$$;

-- ── Finance report: finance read only, real customers only ─────────────────────────────────────
select pg_temp.as_operator('00000000-0000-0000-0000-0000000f9d02');
select is((select concat_ws('/',jsonb_array_length(x->'activations'),jsonb_array_length(x->'replenishments'),x->'settlements'->>'due',x->'unsettled_obligations'->>'count') from (select platform_finance_report('last_30_days') x) y),
 '0/0/0/0','Dormant finance: no activation, replenishment, settlement or obligation');
reset role;
select ok((pikas_private.finance_activate_customer('00000000-0000-0000-0000-000000000001',1,'Piloto ficticio','reports-activation-key-01')->>'activation_id') is not null,'Fictional account 1 activated');
select pg_temp.as_user('00000000-0000-0000-0000-000000002003');
select ok((cafeteria_wallet_collect_cash('00000000-0000-0000-0000-000000000111','00000000-0000-0000-0000-000000005201',200000,null,'5e300000-0000-4000-8000-000000000001')->>'reference') is not null,'Cash RD$ 2,000 collected');
select pg_temp.as_operator('00000000-0000-0000-0000-0000000f9d02');
select set_config('t.f',platform_finance_report('today')::text,true);
reset role;
select is((select concat_ws('/',a->>'customer',a->>'status',a->>'fee_bps') from jsonb_array_elements(current_setting('t.f')::jsonb->'activations') a),'SYNTHETIC-A/active/300','Activation listed with its policy');
select is((select concat_ws('/',r->>'method',r->>'count',r->>'gross_minor',r->>'fee_minor',r->>'net_minor') from jsonb_array_elements(current_setting('t.f')::jsonb->'replenishments') r),
 'cafeteria_cash/1/200000/6000/194000','Replenishment activity: gross, fee and net as recorded (no recalculation)');
select is((current_setting('t.f')::jsonb->'unsettled_obligations'->>'cafeterias_owe_minor'),'200000','Open obligations: the Cafetería owes the gross');
select ok(current_setting('t.f')::jsonb::text !~* 'horizonte','No sandbox in finance reporting');

select * from finish();
rollback;
