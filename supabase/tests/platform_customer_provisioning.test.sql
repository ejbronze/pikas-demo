-- Platform customer provisioning: cafeteria-admin grant, POS staff provisioning, names and invariants.
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
create function pg_temp.q(sql text) returns text language plpgsql security definer set search_path=public as $$declare r text; begin execute sql into r; return r; end$$;
create function pg_temp.operator(n int,role text,demo text) returns void language plpgsql as $$
declare u uuid:=('00000000-0000-0000-0000-0000000bd0a'||n)::uuid; p uuid:=('00000000-0000-0000-0000-0000000bd0b'||n)::uuid; pr pikas_private.sandbox_pov_personas%rowtype; begin
 insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at,raw_app_meta_data,raw_user_meta_data)
  values(u,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','prov.caso.'||n||'@example.invalid','',now(),now(),now(),'{}','{}');
 insert into persons(id,auth_user_id,display_name) values(p,u,'Operador aprovisionamiento '||n);
 insert into pikas_private.platform_memberships(person_id,role_code) values(p,role);
 if demo='none' then return; end if;
 select * into pr from pikas_private.sandbox_pov_personas where pov_code='cashier' order by id limit 1;
 insert into pikas_private.sandbox_pov_sessions(request_id,initiator_person_id,initiator_auth_user_id,account_id,school_id,cafeteria_id,pov_code,persona_id,persona_person_id,persona_membership_id,status,started_at,expires_at)
 values(gen_random_uuid(),p,u,pr.account_id,pr.school_id,pr.cafeteria_id,'cashier',pr.id,pr.person_id,pr.cafeteria_membership_id,'active',
  case when demo='current' then now()-interval '5 minutes' else now()-interval '3 days' end, case when demo='current' then now()+interval '1 hour' else now()-interval '3 days'+interval '1 hour' end);
end$$;

reset role;
set local session_replication_role=replica;
insert into pikas_private.platform_roles(role_code) values('test_prov_ops_only');
insert into pikas_private.platform_role_capabilities(role_code,capability) values
 ('test_prov_ops_only','platform:customer:operations:manage'),('test_prov_ops_only','platform:customer:access:read'),('test_prov_ops_only','platform:identity:support'),('test_prov_ops_only','platform:customer_admin:provision');
set local session_replication_role=origin;
select pg_temp.operator(1,'platform_admin','expired');      -- legitimate operator with only expired Demo history
select pg_temp.operator(2,'test_prov_ops_only','none');
select pg_temp.operator(3,'platform_sandbox_operator','none');
select pg_temp.operator(4,'platform_admin','current');
-- Fictional customer people with confirmed logins (Manuel-like school admin; an existing cafeteria admin).
update auth.users set email_confirmed_at=now() where id in (select auth_user_id from persons where id in ('00000000-0000-0000-0000-000000001001','00000000-0000-0000-0000-000000001003','00000000-0000-0000-0000-000000001006'));
select set_config('t.tenant',(select auth_user_id::text from persons where id='00000000-0000-0000-0000-000000001001'),true);
select set_config('t.counts',pg_temp.q($s$select concat_ws('|',(select count(*) from purchases),(select count(*) from wallet_ledger_entries),(select count(*) from students),(select count(*) from family_guardians),(select count(*) from cafeteria_products),(select count(*) from cafeteria_registers))$s$),true);
select set_config('t.persons',pg_temp.q('select count(*)::text from persons'),true);

select ok(exists(select 1 from pikas_private.platform_role_capabilities where role_code='platform_admin' and capability='platform:customer:access:provision')
 and not exists(select 1 from pikas_private.platform_role_capabilities where role_code='platform_sandbox_operator' and capability='platform:customer:access:provision'),'Provision capability: platform_admin only');
select ok(not has_function_privilege('authenticated','pikas_private.require_staff_activation_admin(uuid)','execute')
 and not has_function_privilege('anon','platform_grant_cafeteria_admin(uuid,uuid,uuid,uuid)','execute'),'Private guards and anonymous access closed');

-- 1-3. Grant Administrador de cafetería to the existing school admin for two cafeterías.
select pg_temp.as_user('00000000-0000-0000-0000-0000000bd0a1');
select is(platform_grant_cafeteria_admin('00000000-0000-4000-8000-0000000bd001','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000001001','00000000-0000-0000-0000-000000000111')->>'already_granted','false','1. Platform grants cafeteria admin to an existing customer Person');
select is(platform_grant_cafeteria_admin('00000000-0000-4000-8000-0000000bd002','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000001001','00000000-0000-0000-0000-000000000113')->>'already_granted','false','2. Same Person receives a second cafetería');
select is(platform_grant_cafeteria_admin('00000000-0000-4000-8000-0000000bd001','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000001001','00000000-0000-0000-0000-000000000111')->>'already_granted','false','3. Exact retry replays the original result');
select is(platform_grant_cafeteria_admin(gen_random_uuid(),'00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000001001','00000000-0000-0000-0000-000000000111')->>'already_granted','true','3. A new duplicate grant is a safe no-op');
select is(pg_temp.q($s$select count(*)::text from cafeteria_memberships where person_id='00000000-0000-0000-0000-000000001001' and role_code='cafeteria_admin'$s$),'2','3. Exactly two cafeteria-admin memberships, no duplicates');
select is(pg_temp.q('select count(*)::text from persons'),current_setting('t.persons'),'3. No Person created by grants');
-- 4. Cross-customer refusals; unconfirmed login refused.
select is(pg_temp.attempt($$select platform_grant_cafeteria_admin(gen_random_uuid(),'00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000001001','00000000-0000-0000-0000-000000000121')$$),'42501:customer_access_scope_required','4. Cafetería of another customer refused');
select is(pg_temp.attempt($$select platform_grant_cafeteria_admin(gen_random_uuid(),'00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000001006','00000000-0000-0000-0000-000000000111')$$),'42501:customer_person_required','4. Person of another customer refused');
select is(pg_temp.attempt($$select platform_grant_cafeteria_admin(gen_random_uuid(),'00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000bd0b1','00000000-0000-0000-0000-000000000111')$$),'42501:customer_person_required','PIKAS staff cannot receive customer roles');
select is(pg_temp.attempt($$select platform_grant_cafeteria_admin(gen_random_uuid(),'00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000001002','00000000-0000-0000-0000-000000000111')$$),'23514:active_confirmed_pos_identity_required','Person without a confirmed login refused');
-- 5-8. Authority and lifecycle.
select pg_temp.as_user('00000000-0000-0000-0000-0000000bd0a2');
select is(pg_temp.attempt($$select platform_grant_cafeteria_admin(gen_random_uuid(),'00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000001001','00000000-0000-0000-0000-000000000112')$$),'42501:not_authorized','5. Operations/identity/admin-provision capabilities are not enough');
select is(pg_temp.attempt($$select platform_customer_staff_command('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000111',gen_random_uuid(),'staff_prepare','{"email":"x@example.invalid","role":"pos_cashier"}','cajero.x','X')$$),'42501:not_authorized','5. Unauthorized operator cannot provision staff');
select pg_temp.as_user('00000000-0000-0000-0000-0000000bd0a3');
select is(pg_temp.attempt($$select platform_grant_cafeteria_admin(gen_random_uuid(),'00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000001001','00000000-0000-0000-0000-000000000112')$$),'42501:not_authorized','6. Sandbox operator refused');
select pg_temp.as_user(current_setting('t.tenant'));
select alike(pg_temp.attempt($$select platform_grant_cafeteria_admin(gen_random_uuid(),'00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000001001','00000000-0000-0000-0000-000000000112')$$),'42501:%','7. Tenant admin cannot call Platform provisioning');
select alike(pg_temp.attempt($$select platform_customer_staff_command('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000111',gen_random_uuid(),'staff_prepare','{"email":"x@example.invalid","role":"pos_cashier"}','cajero.x','X')$$),'42501:%','7. Tenant admin cannot call Platform staff provisioning');
select pg_temp.as_user('00000000-0000-0000-0000-0000000bd0a4');
select is(pg_temp.attempt($$select platform_grant_cafeteria_admin(gen_random_uuid(),'00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000001001','00000000-0000-0000-0000-000000000112')$$),'42501:customer_access_authority_required','Current Demo POV refused');
reset role; update accounts set status='closed' where id='00000000-0000-0000-0000-000000000002';
select pg_temp.as_user('00000000-0000-0000-0000-0000000bd0a1');
select is(pg_temp.attempt($$select platform_grant_cafeteria_admin(gen_random_uuid(),'00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000001006','00000000-0000-0000-0000-000000000121')$$),'23514:customer_provisioning_inactive','8. Closed customer refused for new provisioning');
select alike(pg_temp.attempt($$select platform_customer_staff_command('00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000121',gen_random_uuid(),'staff_prepare','{"email":"y@example.invalid","role":"pos_cashier"}','cajero.y','Y')$$),'42501:%','8. Closed customer refused for staff provisioning');
reset role; update accounts set status='active' where id='00000000-0000-0000-0000-000000000002';

-- 9. Prepare Personal de caja (pos_cashier) with intended name and username.
select pg_temp.as_user('00000000-0000-0000-0000-0000000bd0a1');
select set_config('t.prep',platform_customer_staff_command('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000111','00000000-0000-4000-8000-0000000bd101','staff_prepare',
 '{"email":"cajera.ficticia@example.invalid","role":"pos_cashier"}','cajera.ficticia','Jeanne Ficticia Pantaleón')::text,true);
select is(current_setting('t.prep')::jsonb->>'intended_display_name','Jeanne Ficticia Pantaleón','9. Prepared with its intended Person name');
select is(pg_temp.q(format($s$select concat_ws('|',role_code,status,intended_username,email_key) from invitations where id=%L$s$,current_setting('t.prep')::jsonb->>'target_id')),'pos_cashier|pending|cajera.ficticia|cajera.ficticia@example.invalid','9. Pending pos_cashier invitation with reserved username');
select is(platform_customer_staff_command('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000111','00000000-0000-4000-8000-0000000bd101','staff_prepare',
 '{"email":"cajera.ficticia@example.invalid","role":"pos_cashier"}','cajera.ficticia','Jeanne Ficticia Pantaleón')->>'target_id',current_setting('t.prep')::jsonb->>'target_id','9. Exact retry returns the same invitation');
select is(pg_temp.attempt($$select platform_customer_staff_command('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000111',gen_random_uuid(),'staff_prepare','{"email":"sup@example.invalid","role":"pos_supervisor"}','sup.x','X')$$),'22023:invalid_customer_staff_input','Platform prepares Personal de caja only');
select is(pg_temp.attempt($$select platform_customer_staff_command('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000111',gen_random_uuid(),'staff_status','{}')$$),'42501:customer_access_command_denied','Staff status and other commands are outside the Platform allow-list');
select ok(current_setting('t.prep') !~* '(token|digest|handle|password)','16. Prepare returns no secret');
select is((platform_staff_activation_prepare('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000111',(current_setting('t.prep')::jsonb->>'target_id')::uuid))->>'status','prepared','Platform can prepare the existing staff activation');
select is(pg_temp.attempt(format($$select platform_staff_activation_prepare('00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000121',%L)$$,current_setting('t.prep')::jsonb->>'target_id')),'42501:real_cafeteria_admin_required','Activation for an invitation outside the context is refused');
-- 12. Duplicate username / email protections.
select alike(pg_temp.attempt($$select platform_customer_staff_command('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000111',gen_random_uuid(),'staff_prepare','{"email":"otra@example.invalid","role":"pos_cashier"}','cajera.ficticia','Otra')$$),'%username%','12. A taken username is refused');
select is(pg_temp.q($s$select count(*)::text from invitations where email_key='cajera.ficticia@example.invalid' and status='pending'$s$),'1','12. One pending invitation per email and role');

-- 10. Completion with an independent confirmed login → one Person, one membership.
reset role;
insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at,raw_app_meta_data,raw_user_meta_data)
 values('00000000-0000-0000-0000-0000000bdc01','00000000-0000-0000-0000-000000000000','authenticated','authenticated','cajera.ficticia@example.invalid','',now(),now(),now(),'{}','{}');
select pg_temp.as_user('00000000-0000-0000-0000-0000000bd0a1');
select ok(platform_customer_staff_command('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000111',gen_random_uuid(),'staff_complete',
 jsonb_build_object('invitation_id',current_setting('t.prep')::jsonb->>'target_id','display_name','Jeanne Ficticia Pantaleón'))->>'operation'='staff_complete','10. Platform completes the staff access');
select is(pg_temp.q($s$select concat_ws('|',(select count(*) from persons where auth_user_id='00000000-0000-0000-0000-0000000bdc01'),p.display_name,m.role_code,m.cafeteria_id,m.status)
 from persons p join cafeteria_memberships m on m.person_id=p.id where p.auth_user_id='00000000-0000-0000-0000-0000000bdc01'$s$),
 '1|Jeanne Ficticia Pantaleón|pos_cashier|00000000-0000-0000-0000-000000000111|active','10. One Person for the one login, named as intended, with the cafetería membership');
-- 11/15. Existing Person reuse: no new Person, existing name kept.
select set_config('t.prep2',platform_customer_staff_command('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000111',gen_random_uuid(),'staff_prepare',
 '{"email":"foundation-3@example.invalid","role":"pos_cashier"}','existente.tres','Nombre Distinto')::text,true);
select ok(platform_customer_staff_command('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000111',gen_random_uuid(),'staff_complete',
 jsonb_build_object('invitation_id',current_setting('t.prep2')::jsonb->>'target_id','display_name','Nombre Distinto'))->>'operation'='staff_complete','11. Existing identity completes into the same Person');
select is(pg_temp.q($s$select display_name from persons where id='00000000-0000-0000-0000-000000001003'$s$),'Synthetic person 3','15. Existing Person name is not overwritten');
select is(pg_temp.q('select count(*)::text from persons'),(current_setting('t.persons')::int+1)::text,'11. Only the brand-new login created a Person');

-- Audit: staff provisioning attributed to the real Platform operator.
reset role;
select ok(exists(select 1 from audit_events where actor_person_id='00000000-0000-0000-0000-0000000bd0b1' and actor_scope_kind='platform' and actor_role='platform_support'),'Staff provisioning audited to the real Platform operator');
select is((select count(*)::int from pikas_private.platform_audit_events where actor_person_id='00000000-0000-0000-0000-0000000bd0b1' and reason_code='cafeteria_admin_granted'),3,'Cafeteria-admin grants audited (2 grants + 1 no-op)');
select is(pg_temp.q($s$select concat_ws('|',(select count(*) from account_memberships where person_id='00000000-0000-0000-0000-0000000bd0b1'),(select count(*) from school_memberships where person_id='00000000-0000-0000-0000-0000000bd0b1'),(select count(*) from cafeteria_memberships where person_id='00000000-0000-0000-0000-0000000bd0b1'))$s$),'0|0|0','Platform operator gains no tenant membership');

-- F. Person name correction.
select pg_temp.as_user('00000000-0000-0000-0000-0000000bd0a1');
select is(platform_rename_customer_person(gen_random_uuid(),'00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000001001','Synthetic person 1','Manuel Ficticio Polanco')->>'display_name','Manuel Ficticio Polanco','F. Customer Person name corrected');
select is(pg_temp.q($s$select concat_ws('|',id,auth_user_id is not null,(select count(*) from account_memberships where person_id=p.id),(select count(*) from cafeteria_memberships where person_id=p.id)) from persons p where id='00000000-0000-0000-0000-000000001001'$s$),
 '00000000-0000-0000-0000-000000001001|t|1|2','F. Same Person, login and memberships');
reset role;
select ok(exists(select 1 from pikas_private.platform_audit_events where reason_code='customer_person_renamed' and metadata->>'previous_name'='Synthetic person 1' and metadata->>'new_name'='Manuel Ficticio Polanco'),'F. Old and new name audited');
select pg_temp.as_user('00000000-0000-0000-0000-0000000bd0a1');
select is(pg_temp.attempt($$select platform_rename_customer_person(gen_random_uuid(),'00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000001001','Synthetic person 1','Tarde')$$),'23514:customer_person_changed','F. Stale name correction refused');
select is(pg_temp.attempt($$select platform_rename_customer_person(gen_random_uuid(),'00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000001006','Synthetic person 6','X')$$),'42501:customer_person_required','F. Another customer''s Person refused');

-- 13. Customer-name invariant on a plain profile save.
reset role; update accounts set name='Persona Ficticia Legada' where id='00000000-0000-0000-0000-000000000002';
select pg_temp.as_user('00000000-0000-0000-0000-0000000bd0a1');
select is(platform_update_colegio_profile(gen_random_uuid(),'00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000021',
 jsonb_build_object('name','Synthetic school B1','rnc',null,'address',null,'province',null),'Synthetic school B1','','','DO','')->>'account_renamed','true','13. Unchanged save corrects a mismatched customer name');
select is(pg_temp.q($s$select name from accounts where id='00000000-0000-0000-0000-000000000002'$s$),'Synthetic school B1','13. Customer follows its only colegio');
select is(platform_update_colegio_profile(gen_random_uuid(),'00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011',
 pg_temp.q($s$select jsonb_build_object('name',name,'rnc',tax_id,'address',address_line,'province',subdivision_code)::text from schools where id='00000000-0000-0000-0000-000000000011'$s$)::jsonb,
 'Synthetic school A1','','','DO','')->>'account_renamed','false','13. Multi-colegio customer keeps its own name');

-- 14. Intended administrator name survives preparation into the overview.
select is(platform_prepare_customer_admin_named(gen_random_uuid(),'00000000-0000-0000-0000-000000000002','account',null,null,'account_admin','director.b@example.invalid',now()+interval '7 days','director.b','Director Ficticio B')->>'status','pending','14. Named initial-admin request prepared');
select is((select i->>'intended_display_name' from jsonb_array_elements(platform_get_customer_overview('00000000-0000-0000-0000-000000000002')->'administrator_intents') i where i->>'email'='director.b@example.invalid'),'Director Ficticio B','14. Intended name available at completion');

-- 17. Usuarios y accesos reflects the results; 16. no secrets.
select set_config('t.access',platform_customer_access_read('00000000-0000-0000-0000-000000000001')::text,true);
select is((select string_agg(g->>'cafeteria_name',' + ' order by g->>'cafeteria_name') from jsonb_array_elements(current_setting('t.access')::jsonb->'people') p, jsonb_array_elements(p->'grants') g
 where p->>'person_id'='00000000-0000-0000-0000-000000001001' and g->>'role_code'='cafeteria_admin'),'Synthetic cafeteria A1-C1 + Synthetic cafeteria A1-C2','17. One Person shows both cafetería-admin grants');
select ok(exists(select 1 from jsonb_array_elements(current_setting('t.access')::jsonb->'people') p where p->>'display_name'='Jeanne Ficticia Pantaleón'),'17. Completed staff appears as a Person');
select ok(current_setting('t.access') !~* '"[a-z_]*(token|digest|baseline|hash|handle|secret|owner_key|raw_|session|url|encrypted)[a-z_]*":','16. Access read exposes no secret key');
reset role;
select is(pg_temp.q($s$select concat_ws('|',(select count(*) from purchases),(select count(*) from wallet_ledger_entries),(select count(*) from students),(select count(*) from family_guardians),(select count(*) from cafeteria_products),(select count(*) from cafeteria_registers))$s$),current_setting('t.counts'),'18. No financial, student, guardian, catalog or register change');

select * from finish();
rollback;
