-- PIKAS Pilot Hardening: School sharing rows read through one POV-aware authority (202611240005).
-- Resumen's «Cafetería compartida» step and each cafetería's sharing label now read the same authority, so a Demo School
-- Admin POV never sees «Sin compartir todavía» beside COMPLETO. Fictional fixtures; rolls back.
-- Foundation fixtures: account 1, school 11, School Admin 2002, cashier 1008; sandbox Colegio Horizonte.
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
create function pg_temp.wallet_fp() returns text language sql security definer as $$
 select md5(string_agg(id::text||status||current_balance_minor,',' order by id)) from public.student_wallets $$;
grant execute on all functions in schema pg_temp to authenticated;
reset role;
select set_config('t.sbx',(select id::text from accounts where tenant_kind='sandbox' limit 1),true);
select set_config('t.sch',(select s.id::text from schools s where s.account_id=current_setting('t.sbx')::uuid limit 1),true);
select set_config('t.caf',(select c.id::text from cafeterias c where c.account_id=current_setting('t.sbx')::uuid limit 1),true);
select set_config('t.sids',(select jsonb_agg(student_id order by student_id)::text from student_wallets where school_id=current_setting('t.sch')::uuid),true);
select set_config('t.real_sid',(select student_id::text from student_wallets where school_id='00000000-0000-0000-0000-000000000011' limit 1),true);
select set_config('t.auth1008',(select auth_user_id::text from persons where id='00000000-0000-0000-0000-000000001008'),true);
select set_config('t.fp',pg_temp.wallet_fp(),true);
insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at,raw_app_meta_data,raw_user_meta_data) values
 ('00000000-0000-0000-0000-00000000dd11','00000000-0000-0000-0000-000000000000','authenticated','authenticated','sharingrows.demo@example.invalid','',now(),now(),now(),'{}','{}');
insert into persons(id,auth_user_id,display_name) values ('00000000-0000-0000-0000-00000000de11','00000000-0000-0000-0000-00000000dd11','Operadora Demo Compartición');
insert into pikas_private.platform_memberships(person_id,role_code) values ('00000000-0000-0000-0000-00000000de11','platform_sandbox_operator');

-- ── Contract ───────────────────────────────────────────────────────────────────────────────────────
select ok(has_function_privilege('authenticated','public.school_sharing_rows(uuid)','execute')
 and not has_function_privilege('anon','public.school_sharing_rows(uuid)','execute')
 and not has_function_privilege('service_role','public.school_sharing_rows(uuid)','execute'),'Authenticated-only contract');
select is((select provolatile::text||prosecdef::text from pg_proc where oid='public.school_sharing_rows(uuid)'::regprocedure),'strue','Stable (read-only) and security definer');
select set_config('t.real_rows',(select coalesce(jsonb_agg(jsonb_build_object('cafeteria_id',cafeteria_id,'status',status) order by cafeteria_id),'[]')::text
 from school_cafeteria_shares where school_id='00000000-0000-0000-0000-000000000011'),true);
select set_config('t.sbx_rows',(select coalesce(jsonb_agg(jsonb_build_object('cafeteria_id',cafeteria_id,'status',status) order by cafeteria_id),'[]')::text
 from school_cafeteria_shares where school_id=current_setting('t.sch')::uuid),true);
select ok(jsonb_array_length(current_setting('t.sbx_rows')::jsonb)>0,'(the sandbox school shares at least one cafetería)');

-- ── Real School Admin ──────────────────────────────────────────────────────────────────────────────
select pg_temp.as_user('00000000-0000-0000-0000-000000002002');
select is(school_sharing_rows('00000000-0000-0000-0000-000000000011'),current_setting('t.real_rows')::jsonb,'School Admin reads exactly its school''s share rows');
select is(pg_temp.attempt(format($$select school_sharing_rows(%L)$$,current_setting('t.sch'))),'42501:school_authority_required','A real School Admin cannot read the sandbox school');
select pg_temp.as_user(current_setting('t.auth1008'));
select is(pg_temp.attempt($$select school_sharing_rows('00000000-0000-0000-0000-000000000011')$$),'42501:school_authority_required','A cashier cannot read School sharing');
reset role;

-- ── Demo POV ───────────────────────────────────────────────────────────────────────────────────────
select pg_temp.as_user('00000000-0000-0000-0000-00000000dd11');
select ok((platform_enter_sandbox_pov(gen_random_uuid(),current_setting('t.sbx')::uuid,current_setting('t.caf')::uuid,'school_admin')->>'session_id') is not null,'(operator enters the School Admin Demo)');
select is((select count(*)::int from school_cafeteria_shares where school_id=current_setting('t.sch')::uuid),0,'(the row policy alone shows the Demo operator nothing — the defect this read fixes)');
select is(school_sharing_rows(current_setting('t.sch')::uuid),current_setting('t.sbx_rows')::jsonb,'Demo POV reads the fictional school''s share rows');
select is((select string_agg(r->>'sharing_status',',' order by r->>'id') from jsonb_array_elements(school_admin_read(current_setting('t.sch')::uuid,'cafeterias','','',null,50)->'rows') r
  where r->>'sharing_status'='active'),
 (select string_agg(e->>'status',',' order by e->>'cafeteria_id') from jsonb_array_elements(school_sharing_rows(current_setting('t.sch')::uuid)) e where e->>'status'='active'),
 'The cafeterías read and the sharing rows agree on which shares are active');
select is(pg_temp.attempt($$select school_sharing_rows('00000000-0000-0000-0000-000000000011')$$),'42501:school_authority_required','The Demo POV cannot read a real customer''s school');
reset role;
select * from finish();
rollback;
