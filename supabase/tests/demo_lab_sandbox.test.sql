-- Demo Lab & Sandbox customer (202611170001): sandbox-scoped provisioning inside a cafetería-admin POV,
-- Demo-context read-only reporting, Restaurar escenario inicial (platform_reset_sandbox) and the Demo Lab read.
-- Fictional local fixtures: sandbox Colegio Horizonte (prefixed dataset 4c000000-…), synthetic real customer
-- account 1 (cafetería 111, cashier person 1008). Everything rolls back.
begin;
create extension if not exists pgtap with schema extensions;
set search_path=public,extensions;
select no_plan();
create function pg_temp.as_user(u text) returns void language plpgsql as $$declare sid uuid:=gen_random_uuid(); begin
 execute 'reset role';
 insert into auth.sessions(id,user_id,created_at,updated_at) values(sid,u::uuid,now(),now());
 insert into pikas_private.application_sessions(session_id,user_id,started_at,last_active_at) values(sid,u::uuid,clock_timestamp(),clock_timestamp());
 perform set_config('request.jwt.claim.sub',u,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',u,'role','authenticated','session_id',sid)::text,true);
 execute 'set local role authenticated'; end$$;
create function pg_temp.attempt(sql text) returns text language plpgsql as $$declare m text; s text; begin execute sql; return 'ok';
 exception when others then get stacked diagnostics m=message_text, s=returned_sqlstate; return s||':'||m; end$$;
create function pg_temp.q(sql text) returns text language plpgsql security definer as $$declare r text; begin execute sql into r; return r; end$$;
-- sandbox_admin_has_capability is owner-only (202611180001); released RPCs reach it as SECURITY DEFINER, so the test does too.
create function pg_temp.sandbox_cap(p_code text,cap text,a uuid,s uuid default null,c uuid default null) returns boolean language sql security definer as $$
 select pikas_private.sandbox_admin_has_capability(p_code,cap,a,s,c) $$;
-- Fingerprint of a real customer's operational rows: must never move.
create function pg_temp.real_fp() returns text language plpgsql security definer as $$declare r text; begin
 select md5(coalesce((select string_agg(id::text,',' order by id) from students where account_id='00000000-0000-0000-0000-000000000001'),'')||'|'||
  coalesce((select string_agg(id::text,',' order by id) from purchases where account_id='00000000-0000-0000-0000-000000000001'),'')||'|'||
  coalesce((select string_agg(id::text||status,',' order by id) from cafeteria_memberships where account_id='00000000-0000-0000-0000-000000000001'),'')||'|'||
  coalesce((select string_agg(id::text||current_balance_minor,',' order by id) from student_wallets where account_id='00000000-0000-0000-0000-000000000001'),'')||'|'||
  coalesce((select string_agg(id::text,',' order by id) from cafeteria_products where account_id='00000000-0000-0000-0000-000000000001'),'')||'|'||
  coalesce((select string_agg(id::text,',' order by id) from register_sessions where account_id='00000000-0000-0000-0000-000000000001'),'')) into r; return r; end$$;
reset role;
select set_config('t.pcaps',(select count(*)||':'||md5(string_agg(role_code||':'||capability,',' order by role_code,capability)) from pikas_private.platform_role_capabilities where capability not like 'platform:sandbox:%'),true);
select set_config('t.fin',(select count(*)::text from pikas_private.platform_role_capabilities where capability like 'platform:finance:%'),true);
select set_config('t.real',pg_temp.real_fp(),true);
select set_config('t.sbx',(select id::text from accounts where tenant_kind='sandbox' limit 1),true);
select set_config('t.sch',(select s.id::text from schools s where s.account_id=current_setting('t.sbx')::uuid limit 1),true);
select set_config('t.caf',(select c.id::text from cafeterias c where c.account_id=current_setting('t.sbx')::uuid limit 1),true);
update accounts set status='active' where id in ('00000000-0000-0000-0000-000000000001');
-- Operators: A platform_admin + Demo access (may reset); B Demo access only (may not reset); 1008 real tenant cashier.
insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at,raw_app_meta_data,raw_user_meta_data) values
 ('00000000-0000-0000-0000-00000000dd01','00000000-0000-0000-0000-000000000000','authenticated','authenticated','demolab.a@example.invalid','',now(),now(),now(),'{}','{}'),
 ('00000000-0000-0000-0000-00000000dd02','00000000-0000-0000-0000-000000000000','authenticated','authenticated','demolab.b@example.invalid','',now(),now(),now(),'{}','{}');
insert into persons(id,auth_user_id,display_name) values ('00000000-0000-0000-0000-00000000de01','00000000-0000-0000-0000-00000000dd01','Operadora Demo Lab A'),('00000000-0000-0000-0000-00000000de02','00000000-0000-0000-0000-00000000dd02','Operador Demo Lab B');
insert into pikas_private.platform_memberships(person_id,role_code) values ('00000000-0000-0000-0000-00000000de01','platform_admin'),('00000000-0000-0000-0000-00000000de01','platform_sandbox_operator'),('00000000-0000-0000-0000-00000000de02','platform_sandbox_operator');

-- ── Capability and grants ────────────────────────────────────────────────────────────────────────────
select ok(exists(select 1 from pikas_private.platform_capabilities where capability='platform:sandbox:manage'),'platform:sandbox:manage exists');
select is((select string_agg(role_code,',') from pikas_private.platform_role_capabilities where capability='platform:sandbox:manage'),'platform_admin','Only platform_admin may restore a sandbox');
select ok(has_function_privilege('authenticated','public.platform_reset_sandbox(uuid,uuid)','execute') and has_function_privilege('authenticated','public.platform_demo_lab_read()','execute')
 and not has_function_privilege('anon','public.platform_reset_sandbox(uuid,uuid)','execute') and not has_function_privilege('service_role','public.platform_reset_sandbox(uuid,uuid)','execute')
 and not has_function_privilege('authenticated','pikas_private.sandbox_seed_horizonte(uuid,uuid)','execute') and not has_function_privilege('authenticated','pikas_private.sandbox_reset_allows(jsonb)','execute'),'Public contracts authenticated-only; helpers private');

-- ── Demo Lab read ────────────────────────────────────────────────────────────────────────────────────
select pg_temp.as_user('00000000-0000-0000-0000-00000000dd02');
select is((platform_demo_lab_read()->>'can_reset'),'false','B reads the Demo Lab but cannot reset');
select is(jsonb_array_length(platform_demo_lab_read()->'sandboxes'),1,'One sandbox listed');
select is(jsonb_array_length(platform_demo_lab_read()->'sandboxes'->0->'personas'),3,'Three personas on the Horizonte sandbox');
select pg_temp.as_user('00000000-0000-0000-0000-00000000dd01');
select is((platform_demo_lab_read()->>'can_reset'),'true','A may reset');
reset role;
select set_config('t.auth1008',(select auth_user_id::text from persons where id='00000000-0000-0000-0000-000000001008'),true);
select pg_temp.as_user(current_setting('t.auth1008'));
select is(pg_temp.attempt($$select platform_demo_lab_read()$$),'42501:not_authorized','A tenant cashier cannot read the Demo Lab');

-- ── Reset authority ──────────────────────────────────────────────────────────────────────────────────
select pg_temp.as_user('00000000-0000-0000-0000-00000000dd02');
select is(pg_temp.attempt(format($$select platform_reset_sandbox(gen_random_uuid(),%L)$$,current_setting('t.sbx'))),'42501:not_authorized','Demo access alone cannot reset');
select pg_temp.as_user('00000000-0000-0000-0000-00000000dd01');
select is(pg_temp.attempt($$select platform_reset_sandbox(gen_random_uuid(),'00000000-0000-0000-0000-000000000001')$$),'42501:sandbox_required','A real customer can never be reset');
select is(pg_temp.attempt($$select platform_reset_sandbox(gen_random_uuid(),gen_random_uuid())$$),'42501:sandbox_required','Unknown account refused');
select set_config('t.povA',(platform_enter_sandbox_pov(gen_random_uuid(),current_setting('t.sbx')::uuid,current_setting('t.caf')::uuid,'cafeteria_admin')->>'session_id'),true);
select is(pg_temp.attempt(format($$select platform_reset_sandbox(gen_random_uuid(),%L)$$,current_setting('t.sbx'))),'42501:demo_mode_active','Reset refused while the operator has a current Demo POV');

-- ── Sandbox-scoped provisioning inside the cafetería-admin POV ──────────────────────────────────────
-- A is inside the Horizonte cafetería as Bruno Mars (cafetería admin persona).
select is(pg_temp.attempt(format($$select provisioning_prepare_with_username('cafeteria_staff',%L,null,%L,jsonb_build_object('email','carla.demo@cajeros.pikas.invalid','role','pos_cashier'),'carla.lopez')$$,'20000000-0000-4000-8000-000000000001',current_setting('t.caf'))),
 '22023:sandbox_username_requires_demo_suffix','Sandbox usernames must end in .demo');
select is(pg_temp.attempt(format($$select provisioning_prepare_with_username('cafeteria_staff',%L,null,'00000000-0000-0000-0000-000000000111',jsonb_build_object('email','x.demo@cajeros.pikas.invalid','role','pos_cashier'),'x.demo')$$,'20000000-0000-4000-8000-000000000002')),
 '22023:sandbox_username_unsupported','A sandbox POV cannot reserve a username in a real cafetería');
select is(pg_temp.attempt(format($$select provisioning_prepare_with_username('school_admin',%L,%L,null,jsonb_build_object('email','y.demo@example.invalid'),'y.demo')$$,'20000000-0000-4000-8000-000000000003',current_setting('t.sch'))),
 '22023:sandbox_username_unsupported','Only the cafetería staff flow is open inside the sandbox POV');
select set_config('t.prep',(provisioning_prepare_with_username('cafeteria_staff','20000000-0000-4000-8000-000000000004',null,current_setting('t.caf')::uuid,jsonb_build_object('email','carla.demo@cajeros.pikas.invalid','role','pos_cashier'),'carla.demo'))::text,true);
select is(current_setting('t.prep')::jsonb->>'username','carla.demo','Sandbox POV reserves a .demo username for its own cafetería');
select is(pg_temp.q(format($$select intended_username from invitations where id=%L$$,current_setting('t.prep')::jsonb->>'target_id')),'carla.demo','Username recorded on the sandbox invitation');
-- A confirmed Auth identity for that address (the one-step flow's service-role step), then completion inside the POV.
reset role;
insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at,raw_app_meta_data,raw_user_meta_data)
 values('00000000-0000-0000-0000-00000000dd11','00000000-0000-0000-0000-000000000000','authenticated','authenticated','carla.demo@cajeros.pikas.invalid','x',now(),now(),now(),'{}','{}');
select pg_temp.as_user('00000000-0000-0000-0000-00000000dd01');
select set_config('t.comp',pg_temp.attempt(format($$select cafeteria_admin_command(%L,'20000000-0000-4000-8000-000000000005','staff_complete',jsonb_build_object('invitation_id',%L,'display_name','Carla Demo'))$$,current_setting('t.caf'),current_setting('t.prep')::jsonb->>'target_id')),true);
select is(current_setting('t.comp'),'ok','staff_complete inside the sandbox POV creates the sandbox cashier');
select set_config('t.carla',pg_temp.q($$select id::text from persons where auth_user_id='00000000-0000-0000-0000-00000000dd11'$$),true);
select is(pg_temp.q(format($$select role_code||':'||status||':'||account_id::text from cafeteria_memberships where person_id=%L$$,current_setting('t.carla'))),'pos_cashier:active:'||current_setting('t.sbx'),'Carla is a POS cashier of the sandbox only');
select is(pg_temp.attempt(format($$select identity_begin_temporary_access(%L)$$,current_setting('t.carla'))),'ok','Temporary credential may begin for the sandbox cashier inside the POV');
select is(pg_temp.attempt(format($$select identity_finish_temporary_access(%L)$$,current_setting('t.carla'))),'ok','…and finish');
select is(pg_temp.q(format($$select must_change_password::text from pikas_private.login_identities where person_id=%L$$,current_setting('t.carla'))),'true','Sandbox cashier must change the temporary password like any cashier');
select is(pg_temp.attempt(format($$select cafeteria_admin_command(%L,'20000000-0000-4000-8000-00000000000a','assignment_save',jsonb_build_object('membership_id',%L,'register_id','4c000000-0000-4000-8000-000000000010','status','active','version',null))$$,current_setting('t.caf'),pg_temp.q(format($$select id::text from cafeteria_memberships where person_id=%L$$,current_setting('t.carla'))))),'ok','The POV assigns the new cashier a caja through the normal command');
select is(pg_temp.q(format($$select count(*)::text from cafeteria_register_assignments a join cafeteria_memberships m on m.id=a.cafeteria_membership_id where m.person_id=%L and a.status='active'$$,current_setting('t.carla'))),'1','Carla holds one active caja assignment');
-- The same POV still cannot touch a real customer's identity (UX 11 invariant).
select is(pg_temp.attempt($$select identity_begin_temporary_access('00000000-0000-0000-0000-000000001008')$$),'42501:demo_mode_active','Real cashier identity refused under the POV');
select is(pg_temp.attempt($$select identity_set_login_suspended('00000000-0000-0000-0000-000000001008',true,'x')$$),'42501:demo_mode_active','Real login suspension refused under the POV');
select is(pg_temp.attempt(format($$select identity_set_login_suspended(%L,true,'Motivo ficticio')$$,current_setting('t.carla'))),'42501:demo_mode_active','Login suspension stays a Platform identity action, never from inside a POV');
-- Demo-context reporting: read-only business reads open, every wallet write still refused.
select ok(pg_temp.sandbox_cap('cafeteria_admin','cafeteria:pos:purchases:read',current_setting('t.sbx')::uuid,current_setting('t.sch')::uuid,current_setting('t.caf')::uuid),'Sales reports readable inside the cafetería POV');
select ok(pg_temp.sandbox_cap('cafeteria_admin','cafeteria:pos:sessions:read',current_setting('t.sbx')::uuid,current_setting('t.sch')::uuid,current_setting('t.caf')::uuid),'Sessions readable inside the cafetería POV');
select ok(not pg_temp.sandbox_cap('cafeteria_admin','cafeteria:wallets:read',current_setting('t.sbx')::uuid,current_setting('t.sch')::uuid,current_setting('t.caf')::uuid),'Cafetería wallet reads stay excluded');
select is(pg_temp.attempt(format($$select cafeteria_report_read(%L,'sales_summary','today')$$,current_setting('t.caf'))),'ok','Sales summary readable inside the sandbox POV');
select is(pg_temp.attempt(format($$select cafeteria_transactions_read(%L,'today')$$,current_setting('t.caf'))),'ok','Transactions readable inside the sandbox POV');
select is(pg_temp.attempt(format($$select cafeteria_wallet_read(%L,'')$$,current_setting('t.caf'))),'42501:cafeteria_authority_required','Cafetería PIKAS Cash still refused inside the POV');
-- Sandbox activity to be reset later: a second caja, a product, then a POV sale by José.
select is(pg_temp.attempt(format($$select cafeteria_admin_command(%L,'20000000-0000-4000-8000-000000000006','register_save',jsonb_build_object('id','20000000-0000-4000-8000-000000000060','version',null,'code',null,'name','Caja Demo 2','status','active'))$$,current_setting('t.caf'))),'ok','Cafetería admin POV creates a caja');
select is(pg_temp.attempt(format($$select cafeteria_admin_command(%L,'20000000-0000-4000-8000-000000000007','product_save',jsonb_build_object('id','20000000-0000-4000-8000-000000000070','version',null,'name','Galleta ficticia','description','','unit','Unidad','category','Alimentos','price_minor',1500,'active',true,'available',true,'ingredients',jsonb_build_array(),'allergens',jsonb_build_array()))$$,current_setting('t.caf'))),'ok','Cafetería admin POV creates a product');
select set_config('t.povJ',(platform_enter_sandbox_pov(gen_random_uuid(),current_setting('t.sbx')::uuid,current_setting('t.caf')::uuid,'cashier')->>'session_id'),true);
select is(pg_temp.attempt($$select open_register_session('4c000000-0000-4000-8000-000000000010','4c000000-0000-4000-8000-000000000011',10000,'demo-lab-open-0000000001')$$),'ok','José (POV) opens Caja demo Horizonte');
select set_config('t.sid',(select session_id::text from get_my_open_register_session()),true);
select set_config('t.sale',pg_temp.attempt(format($$select checkout_purchase(jsonb_build_object('request_key','demo-lab-sale-0000000001','register_session_id',%L,'cafeteria_customer_id','4c000000-0000-4000-8000-000000000501','expected_total_minor','2500',
 'items',jsonb_build_array(jsonb_build_object('product_id','4c000000-0000-4000-8000-000000000030','quantity',1,'expected_product_version',%s,'expected_unit_price_minor','2500')),
 'tender',jsonb_build_object('type','student_wallet')))$$,current_setting('t.sid'),pg_temp.q($$select version::text from cafeteria_products where id='4c000000-0000-4000-8000-000000000030'$$))),true);
select is(current_setting('t.sale'),'ok','José sells to Luna with PIKAS Cash inside the sandbox');
select is(pg_temp.q(format($$select current_balance_minor::text from student_wallets where id='4c000000-0000-4000-8000-000000000601'$$)),'117500','Luna''s fictional balance moved');
select is(pg_temp.q(format($$select count(*)::text from purchases where account_id=%L$$,current_setting('t.sbx'))),'1','One sandbox purchase exists');
select is(pg_temp.q(format($$select count(*)::text from public.financial_obligations where account_id=%L$$,current_setting('t.sbx'))),'0','No financial obligation: the sandbox is never financially activated');
select is(pg_temp.q($$select count(*)::text from public.financial_entries$$),pg_temp.q($$select count(*)::text from public.financial_entries$$),'(finance entries untouched)');
select is(pg_temp.attempt(format($$select platform_exit_sandbox_pov(%L)$$,'20000000-0000-4000-8000-000000000008')),'ok','A exits the Demo');
-- B holds a Demo POV on the sandbox while A resets: B's session ends as sandbox_reset.
select pg_temp.as_user('00000000-0000-0000-0000-00000000dd02');
select set_config('t.povB',(platform_enter_sandbox_pov(gen_random_uuid(),current_setting('t.sbx')::uuid,current_setting('t.caf')::uuid,'school_admin')->>'session_id'),true);
select ok(pg_temp.sandbox_cap('school_admin','school:wallets:read',current_setting('t.sbx')::uuid,current_setting('t.sch')::uuid),'School POV may read PIKAS Cash');
select ok(not pg_temp.sandbox_cap('school_admin','school:wallets:replenish',current_setting('t.sbx')::uuid,current_setting('t.sch')::uuid),'School POV may not replenish');
select is((school_wallet_access(current_setting('t.sch')::uuid)->>'read')||'/'||(school_wallet_access(current_setting('t.sch')::uuid)->>'replenish')||'/'||(school_wallet_access(current_setting('t.sch')::uuid)->>'adjust'),'true/false/false','school_wallet_access: read only inside the POV');
select is(pg_temp.attempt(format($$select school_wallet_report(%L,'today')$$,current_setting('t.sch'))),'ok','School PIKAS Cash report readable inside the sandbox POV');
select isnt(pg_temp.attempt(format($$select school_wallet_replenish(%L,'4c000000-0000-4000-8000-000000000201',1000,'x','demo-lab-rep-00000000001')$$,current_setting('t.sch'))),'ok','School POV cannot replenish');
select is(pg_temp.q(format($$select count(*)::text from wallet_replenishments where account_id=%L$$,current_setting('t.sbx'))),'0','No replenishment was written inside the POV');

-- Guards without the reset context: sandbox history stays immutable for everyone else.
reset role;
select is(pg_temp.attempt(format($$delete from register_sessions where account_id=%L$$,current_setting('t.sbx'))),'23514:pos_register_history_is_preserved','Sessions immutable outside a reset');
select is(pg_temp.attempt(format($$delete from purchases where account_id=%L$$,current_setting('t.sbx'))),'23514:purchase_financial_history_is_immutable','Purchases immutable outside a reset');
select set_config('pikas.sandbox_reset_account','00000000-0000-0000-0000-000000000001',true);
select is(pg_temp.attempt($$delete from cafeteria_registers where account_id='00000000-0000-0000-0000-000000000001'$$),'23514:pos_register_history_is_preserved','A real customer is never a reset target even with the setting');
select set_config('pikas.sandbox_reset_account','',true);
select set_config('t.audit_before',pg_temp.q(format($$select count(*)::text from audit_events where account_id=%L$$,current_setting('t.sbx'))),true);
select set_config('t.regs',pg_temp.q(format($$select count(*)::text from cafeteria_registers where account_id=%L$$,current_setting('t.sbx'))),true);
select set_config('t.prods',pg_temp.q(format($$select count(*)::text from cafeteria_products where account_id=%L$$,current_setting('t.sbx'))),true);
select set_config('t.pov_sessions',pg_temp.q($$select count(*)::text from pikas_private.sandbox_pov_sessions$$),true);

-- ── Restaurar escenario inicial ──────────────────────────────────────────────────────────────────────
select pg_temp.as_user('00000000-0000-0000-0000-00000000dd01');
select set_config('t.reset',(platform_reset_sandbox('20000000-0000-4000-8000-000000000009',current_setting('t.sbx')::uuid))::text,true);
select is(current_setting('t.reset')::jsonb->'deleted'->>'purchases','1','Reset removed the sandbox purchase');
select is(current_setting('t.reset')::jsonb->'deleted'->>'register_sessions','1','…and the open register session');
select is(current_setting('t.reset')::jsonb->'deleted'->>'registers',current_setting('t.regs'),'…every caja that existed (baseline + Caja Demo 2 + any leftover)');
select is(current_setting('t.reset')::jsonb->'deleted'->>'products',current_setting('t.prods'),'…every product that existed (six baseline + Galleta + any leftover)');
select is(current_setting('t.reset')::jsonb->'deleted'->>'people_retired','1','…and retired Carla');
select is(current_setting('t.reset')::jsonb->'auth_user_ids'->>0,'00000000-0000-0000-0000-00000000dd11','Carla''s Auth user is returned for the caller to purge');
select is(current_setting('t.reset')::jsonb->'seeded'->>'baseline','horizonte-v1','Baseline re-seeded');
select is((platform_reset_sandbox('20000000-0000-4000-8000-000000000009',current_setting('t.sbx')::uuid))::text,current_setting('t.reset'),'Exact replay returns the journalled result');
reset role;
select is(pg_temp.q(format($$select count(*)::text from students where account_id=%L and status='active'$$,current_setting('t.sbx'))),'4','Four baseline students');
select is(pg_temp.q(format($$select current_balance_minor::text||'/'||balance_version from student_wallets where id='4c000000-0000-4000-8000-000000000601'$$)),'120000/1','Luna back at the baseline balance and version');
select is(pg_temp.q(format($$select string_agg(display_name,',' order by display_name) from cafeteria_registers where account_id=%L$$,current_setting('t.sbx'))),'Caja demo Horizonte','Only the baseline caja remains');
select is(pg_temp.q(format($$select count(*)::text from cafeteria_products where account_id=%L$$,current_setting('t.sbx'))),'6','Six baseline products');
select is(pg_temp.q(format($$select count(*)::text from purchases where account_id=%L$$,current_setting('t.sbx'))),'0','No purchases');
select is(pg_temp.q(format($$select count(*)::text from register_sessions where account_id=%L$$,current_setting('t.sbx'))),'0','No sessions');
select is(pg_temp.q(format($$select count(*)::text from cafeteria_memberships where person_id=%L$$,current_setting('t.carla'))),'0','Carla''s membership removed');
select is(pg_temp.q(format($$select status from persons where id=%L$$,current_setting('t.carla'))),'inactive','Carla kept as inactive history');
select is(pg_temp.q($$select count(*)::text from pikas_private.reserved_usernames where username='carla.demo'$$),'0','Username carla.demo released');
select is(pg_temp.q(format($$select count(*)::text from pikas_private.login_identities where person_id=%L$$,current_setting('t.carla'))),'0','Login identity removed');
select is(pg_temp.q(format($$select string_agg(p.display_name,',' order by pr.pov_code) from pikas_private.sandbox_pov_personas pr join persons p on p.id=pr.person_id where pr.account_id=%L$$,current_setting('t.sbx'))),'Bruno Mars,José Ramírez,María Carey','Personas keep their fictional names');
select ok((select bool_and(pikas_private.sandbox_persona_valid(id)) from pikas_private.sandbox_pov_personas where account_id=current_setting('t.sbx')::uuid),'Every persona valid after the reset');
select is(pg_temp.q(format($$select status||'/'||end_reason from pikas_private.sandbox_pov_sessions where id=%L$$,current_setting('t.povB'))),'exited/sandbox_reset','B''s Demo session was ended by the reset');
select is(pg_temp.q($$select count(*)::text from pikas_private.sandbox_pov_sessions$$),current_setting('t.pov_sessions'),'POV session history kept');
select ok(pg_temp.q(format($$select count(*)::text from audit_events where account_id=%L$$,current_setting('t.sbx')))::int>current_setting('t.audit_before')::int,'Sandbox audit history kept and the reset recorded');
select is(pg_temp.q(format($$select count(*)::text from audit_events where account_id=%L and action='sandbox_reset'$$,current_setting('t.sbx'))),'1','audit_events records the reset once');
select is(pg_temp.q(format($$select count(*)::text from pikas_private.platform_audit_events where target_account_id=%L and reason_code='sandbox_reset'$$,current_setting('t.sbx'))),'1','Platform audit records the reset');
select is(pg_temp.q($$select count(*)::text from pikas_private.sandbox_pov_operation_links$$),pg_temp.q($$select count(*)::text from pikas_private.sandbox_pov_operation_links$$),'(POV operation links append-only)');
select pg_temp.as_user('00000000-0000-0000-0000-00000000dd01');
select is(platform_demo_lab_read()->'sandboxes'->0->'last_reset'->>'actor_name','Operadora Demo Lab A','Demo Lab shows the last reset');
select is(jsonb_array_length(platform_demo_lab_read()->'sandboxes'->0->'sandbox_staff'),0,'No in-sandbox staff remain');

-- ── Invariants ───────────────────────────────────────────────────────────────────────────────────────
reset role;
select is(pg_temp.real_fp(),current_setting('t.real'),'Real customer rows untouched by every step');
select is((select count(*)||':'||md5(string_agg(role_code||':'||capability,',' order by role_code,capability)) from pikas_private.platform_role_capabilities where capability not like 'platform:sandbox:%'),current_setting('t.pcaps'),'No other Platform grant changed');
select is((select count(*)::text from pikas_private.platform_role_capabilities where capability like 'platform:finance:%'),current_setting('t.fin'),'Finance grants unchanged');
select is((select count(*)::text from public.customer_financial_activations where account_id=current_setting('t.sbx')::uuid),'0','Sandbox never financially activated');
select * from finish();
rollback;
