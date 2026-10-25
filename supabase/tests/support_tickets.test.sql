-- PIKAS Pilot Hardening: support tickets (202611240006). Fictional fixtures; rolls back.
-- Foundation fixtures: account 1 (customer), school 11, cafeterías 111/112; School Admin person 1002 (auth 2002);
-- cashier / supervisor person 1008 (auth 2008); sandbox Colegio Horizonte.
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
grant execute on all functions in schema pg_temp to authenticated;
reset role;
select set_config('t.sbx',(select id::text from accounts where tenant_kind='sandbox' limit 1),true);
select set_config('t.caf_sbx',(select c.id::text from cafeterias c where c.account_id=current_setting('t.sbx')::uuid limit 1),true);
select set_config('t.sch_sbx',(select school_id::text from cafeterias where id=current_setting('t.caf_sbx')::uuid),true);
insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at,raw_app_meta_data,raw_user_meta_data) values
 ('00000000-0000-0000-0000-00000000ee01','00000000-0000-0000-0000-000000000000','authenticated','authenticated','soporte.a@example.invalid','',now(),now(),now(),'{}','{}'),
 ('00000000-0000-0000-0000-00000000ee02','00000000-0000-0000-0000-000000000000','authenticated','authenticated','soporte.demo@example.invalid','',now(),now(),now(),'{}','{}'),
 ('00000000-0000-0000-0000-00000000ee03','00000000-0000-0000-0000-000000000000','authenticated','authenticated','sin.membresia@example.invalid','',now(),now(),now(),'{}','{}');
insert into persons(id,auth_user_id,display_name) values ('00000000-0000-0000-0000-00000000ef01','00000000-0000-0000-0000-00000000ee01','Agente Soporte Ficticio'),
 ('00000000-0000-0000-0000-00000000ef02','00000000-0000-0000-0000-00000000ee02','Operador Demo Ficticio'),('00000000-0000-0000-0000-00000000ef03','00000000-0000-0000-0000-00000000ee03','Persona Sin Membresía');
insert into pikas_private.platform_memberships(person_id,role_code) values ('00000000-0000-0000-0000-00000000ef01','platform_admin'),('00000000-0000-0000-0000-00000000ef02','platform_sandbox_operator');
create temp table k(name text primary key, v uuid default gen_random_uuid()); grant all on k to authenticated;
insert into k(name) values ('t1'),('t2'),('r1'),('a1'),('a2'),('a3'),('a4'),('a5'),('a6'),('a7'),('x');

-- ── Contract ───────────────────────────────────────────────────────────────────────────────────────
select is((select string_agg(capability,',' order by capability) from pikas_private.platform_role_capabilities where capability like 'platform:support:%'),
 'platform:support:manage,platform:support:read','Support capabilities exist and belong to platform_admin only');
select ok(not has_table_privilege('authenticated','pikas_private.support_tickets','select') and not has_table_privilege('authenticated','pikas_private.support_ticket_events','select')
 and not has_table_privilege('anon','pikas_private.support_tickets','select'),'Ticket tables are not client-readable');
select ok((select bool_and(has_function_privilege('authenticated',f,'execute') and not has_function_privilege('anon',f,'execute') and not has_function_privilege('service_role',f,'execute'))
 from unnest(array['public.support_reporter_context()','public.support_create_ticket(uuid,uuid,uuid,uuid,text,text,text,text,text,text)','public.support_reporter_reply(uuid,uuid,text)',
  'public.platform_support_list(text,text,text,boolean)','public.platform_support_ticket(uuid)','public.platform_support_act(uuid,uuid,text,text)']) f),'Public contracts are authenticated-only');
select ok(not has_function_privilege('authenticated','pikas_private.support_reporter_scopes(uuid)','execute') and not has_function_privilege('authenticated','pikas_private.support_text_ok(text)','execute'),'Helpers are private');

-- ── Reporter: School Admin ─────────────────────────────────────────────────────────────────────────
select pg_temp.as_user('00000000-0000-0000-0000-000000002002');
select is((select string_agg(s->>'role',',') from jsonb_array_elements(support_reporter_context()->'scopes') s),'school_admin','School Admin reports from their school');
select set_config('t.c1',(support_create_ticket((select v from k where name='t1'),'00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011',null,'pikas_cash',
 'Saldo no coincide','El saldo de un estudiante ficticio no coincide con su historial.','/admin/escuela/pikas-cash'))::text,true);
select is(current_setting('t.c1')::jsonb->>'status','received','A new report is «Recibido»');
select ok(current_setting('t.c1')::jsonb->>'reference' ~ '^SOP-[0-9]{6}$','A human reference (SOP-000000)');
select set_config('t.tid',current_setting('t.c1')::jsonb->>'id',true);
select is(support_create_ticket((select v from k where name='t1'),'00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011',null,'pikas_cash',
 'Saldo no coincide','El saldo de un estudiante ficticio no coincide con su historial.','/admin/escuela/pikas-cash')->>'id',current_setting('t.tid'),'Same key and payload replays the same ticket');
select is(pg_temp.attempt($$select support_create_ticket((select v from k where name='t1'),'00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011',null,'other','Otro asunto','Otra descripción distinta.',null)$$),
 '23505:request_key_conflict','Same key with another payload is a conflict');
select is(pg_temp.attempt($$select support_create_ticket(gen_random_uuid(),'00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000111','pos','Caja lenta','La caja tarda en cobrar.',null)$$),
 '42501:support_scope_required','A School Admin cannot report from a cafetería they do not belong to');
select is(pg_temp.attempt($$select support_create_ticket(gen_random_uuid(),'00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011',null,'access','No puedo entrar','Mi contraseña: Secreta123 no funciona.',null)$$),
 '22023:support_secret_detected','A password in the text is refused');
select is(pg_temp.attempt($$select support_create_ticket(gen_random_uuid(),'00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011',null,'technical','Error raro','Copio el token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijklmnop',null)$$),
 '22023:support_secret_detected','A token in the text is refused');
select is(pg_temp.attempt($$select support_create_ticket(gen_random_uuid(),'00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011',null,'technical','Error raro','Algo falló en la página.','/admin/escuela?token=abc')$$),
 '22023:invalid_page_path','Only a bare page path is kept (no query string)');
select is(pg_temp.attempt($$select support_create_ticket(gen_random_uuid(),'00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011',null,'billing','Error raro','Algo falló en la página.',null)$$),
 '22023:invalid_category','Unknown category refused');
select is(pg_temp.attempt(format($$select support_reporter_reply(gen_random_uuid(),%L,'Adjunto más detalle.')$$,current_setting('t.tid'))),'ok','The reporter can add detail');

-- ── Reporter: POS staff, outsider ──────────────────────────────────────────────────────────────────
select pg_temp.as_user('00000000-0000-0000-0000-000000002008');
select is((select string_agg(s->>'role',',' order by s->>'cafeteria_id') from jsonb_array_elements(support_reporter_context()->'scopes') s),'pos_cashier,pos_supervisor','POS staff report from their cafeterías');
select is(jsonb_array_length(support_reporter_context()->'tickets'),0,'A reporter never sees another person''s tickets');
select is(pg_temp.attempt(format($$select support_reporter_reply(gen_random_uuid(),%L,'Hola')$$,current_setting('t.tid'))),'42501:support_ticket_not_found','…nor answers them');
select ok((support_create_ticket((select v from k where name='t2'),'00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000111','pos',
 'Impresora','La impresora de recibos no imprime.','/pos/caja')->>'status')='received','A cashier reports a POS problem');
select pg_temp.as_user('00000000-0000-0000-0000-00000000ee03');
select is(jsonb_array_length(support_reporter_context()->'scopes'),0,'A person with no membership has no reporting scope');
select is(pg_temp.attempt($$select support_create_ticket(gen_random_uuid(),'00000000-0000-0000-0000-000000000001',null,null,'other','Hola mundo','Necesito ayuda con algo.',null)$$),'42501:support_scope_required','…and cannot report');

-- ── Demo POV never reports, never manages ─────────────────────────────────────────────────────────
select pg_temp.as_user('00000000-0000-0000-0000-00000000ee02');
select ok((platform_enter_sandbox_pov(gen_random_uuid(),current_setting('t.sbx')::uuid,current_setting('t.caf_sbx')::uuid,'cafeteria_admin')->>'session_id') is not null,'(operator enters a Demo)');
select is(pg_temp.attempt($$select support_reporter_context()$$),'42501:demo_mode_active','A Demo POV cannot open the reporter view');
select is(pg_temp.attempt(format($$select support_create_ticket(gen_random_uuid(),%L,null,null,'other','Hola mundo','Necesito ayuda con algo.',null)$$,current_setting('t.sbx'))),'42501:demo_mode_active','A Demo POV cannot file a ticket');
select is(pg_temp.attempt($$select platform_support_list()$$),'42501:not_authorized','A sandbox operator has no support authority');

-- ── Platform ───────────────────────────────────────────────────────────────────────────────────────
select pg_temp.as_user('00000000-0000-0000-0000-000000002002');
select is(pg_temp.attempt($$select platform_support_list()$$),'42501:not_authorized','A customer cannot read the support queue');
select pg_temp.as_user('00000000-0000-0000-0000-00000000ee01');
select is(jsonb_array_length(platform_support_list()->'rows'),2,'Platform lists open tickets');
select is(jsonb_array_length(platform_support_list('open','pos')->'rows'),1,'Category filter');
select is(platform_support_list('all',null,'Impresora')->'rows'->0->>'reporter_name','Synthetic person 8','Search by subject; shows the reporter');
select is(platform_support_ticket(current_setting('t.tid')::uuid)->>'page_path','/admin/escuela/pikas-cash','Detail keeps the page path');
select is(platform_support_act((select v from k where name='a1'),current_setting('t.tid')::uuid,'note','Revisar ledger del monedero ficticio.')->>'status','received','An internal note does not change status');
select is(platform_support_act((select v from k where name='a2'),current_setting('t.tid')::uuid,'request_info','¿Qué estudiante y qué fecha?')->>'status','info_requested','«Necesitamos información»');
select is(platform_support_act((select v from k where name='a2'),current_setting('t.tid')::uuid,'request_info','¿Qué estudiante y qué fecha?')->>'replayed','true','Same key and payload replays');
select is(pg_temp.attempt(format($$select platform_support_act((select v from k where name='a2'),%L,'request_info','Otra pregunta')$$,current_setting('t.tid'))),'23505:request_key_conflict','Same key, other payload: conflict');
select is(pg_temp.attempt(format($$select platform_support_act(gen_random_uuid(),%L,'reopen','x')$$,current_setting('t.tid'))),'55000:invalid_transition','An open ticket cannot be reopened');
select is(pg_temp.attempt(format($$select platform_support_act(gen_random_uuid(),%L,'resolve',null)$$,current_setting('t.tid'))),'22023:body_required','A resolution needs a message');

select pg_temp.as_user('00000000-0000-0000-0000-000000002002');
select is((select e->>'body' from jsonb_array_elements((support_reporter_context()->'tickets'->0)->'events') e where e->>'kind'='info_requested'),'¿Qué estudiante y qué fecha?','The reporter sees the information request');
select is((select count(*)::int from jsonb_array_elements((support_reporter_context()->'tickets'->0)->'events') e where e->>'kind'='internal_note' or e->>'body' ~ 'ledger'),0,'…never the internal note');
select is((select string_agg(distinct e->>'author',',') from jsonb_array_elements((support_reporter_context()->'tickets'->0)->'events') e where e->>'side'='platform'),'Soporte PIKAS','Platform staff appear as «Soporte PIKAS»');
select is(support_reporter_reply((select v from k where name='r1'),current_setting('t.tid')::uuid,'Estudiante EST-1, ayer.')->>'status','in_review','Answering moves it back to «En revisión»');

select pg_temp.as_user('00000000-0000-0000-0000-00000000ee01');
select is(platform_support_act((select v from k where name='a3'),current_setting('t.tid')::uuid,'resolve','Corregimos el saldo ficticio.')->>'status','resolved','Resolve');
select is(platform_support_act((select v from k where name='a4'),current_setting('t.tid')::uuid,'close',null)->>'status','closed','Close');
select pg_temp.as_user('00000000-0000-0000-0000-000000002002');
select is(pg_temp.attempt(format($$select support_reporter_reply(gen_random_uuid(),%L,'Otra vez falla')$$,current_setting('t.tid'))),'55000:support_ticket_closed','A closed ticket takes no answers');
select pg_temp.as_user('00000000-0000-0000-0000-00000000ee01');
select is(platform_support_act((select v from k where name='a5'),current_setting('t.tid')::uuid,'reopen','El cliente volvió a escribir por correo.')->>'status','in_review','Reopen');
select is(pg_temp.attempt(format($$select platform_support_act(gen_random_uuid(),%L,'reply','Mi clave: hunter2')$$,current_setting('t.tid'))),'22023:support_secret_detected','Platform text is screened too');
select is((select string_agg(e->>'kind',',' order by ord) from jsonb_array_elements(platform_support_ticket(current_setting('t.tid')::uuid)->'events') with ordinality x(e,ord)),
 'created,reporter_reply,internal_note,info_requested,reporter_reply,resolved,closed,reopened','The full timeline, in order');
reset role;
select is(pg_temp.attempt($$update pikas_private.support_ticket_events set body='x'$$),'55000:support_events_append_only','Events are append-only');
select is(pg_temp.attempt($$delete from pikas_private.support_ticket_events$$),'55000:support_events_append_only','…and cannot be deleted');
-- ── Context (202611240007): sede and caja derived on the server, version and browser recorded ─────
select pg_temp.as_user('00000000-0000-0000-0000-000000002008');
select ok((select session_id from open_register_session('00000000-0000-0000-0000-000000009401','00000000-0000-0000-0000-000000009501',0,'support-ctx-open-0001')) is not null,'(cashier opens Caja 1)');
select set_config('t.ctx',(support_create_ticket(gen_random_uuid(),'00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000111','pos',
 'Cobro lento','La caja tarda en cobrar con PIKAS Cash.','/pos/caja','abc123def456','Navegador Ficticio/1.0')->>'id'),true);
select is(pg_temp.attempt($$select support_create_ticket(gen_random_uuid(),'00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000111','pos',
 'Otra cosa','Otro detalle para probar la versión.',null,'bad version!',null)$$),'ok','A malformed version is dropped, never stored');
select pg_temp.as_user('00000000-0000-0000-0000-00000000ee01');
select is((select x->>'register_name'||'|'||(x->>'location_name' is not null)::text||'|'||(x->>'app_version')||'|'||(x->>'user_agent')||'|'||(x->>'is_demo')
 from (select platform_support_ticket(current_setting('t.ctx')::uuid) x) y),'Caja 1|true|abc123def456|Navegador Ficticio/1.0|false','Ticket carries caja (from the open session), sede, version, browser; not Demo');
reset role;
select is(pg_temp.q($$select count(*)::text from pikas_private.support_tickets where app_version is not null and app_version !~ '^[A-Za-z0-9._+-]{1,40}$'$$),'0','(no malformed version stored)');

-- ── Sandbox tenant staff (not a POV): Demo-flagged, hidden from the queue unless asked ────────────
insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at,raw_app_meta_data,raw_user_meta_data) values
 ('00000000-0000-0000-0000-00000000ee04','00000000-0000-0000-0000-000000000000','authenticated','authenticated','cajero.horizonte@example.invalid','',now(),now(),now(),'{}','{}');
insert into persons(id,auth_user_id,display_name) values ('00000000-0000-0000-0000-00000000ef04','00000000-0000-0000-0000-00000000ee04','Cajero Horizonte Ficticio');
insert into cafeteria_memberships(account_id,school_id,cafeteria_id,person_id,role_code)
 select c.account_id,c.school_id,c.id,'00000000-0000-0000-0000-00000000ef04','pos_cashier' from cafeterias c where c.id=current_setting('t.caf_sbx')::uuid;
select pg_temp.as_user('00000000-0000-0000-0000-00000000ee04');
select is((support_create_ticket(gen_random_uuid(),current_setting('t.sbx')::uuid,current_setting('t.sch_sbx')::uuid,current_setting('t.caf_sbx')::uuid,
 'technical','Prueba Demo','Ensayo de soporte en el Demo.',null)->>'status'),'received','Sandbox staff can report (rehearsal)');
select pg_temp.as_user('00000000-0000-0000-0000-00000000ee01');
select is((select count(*)::int from jsonb_array_elements(platform_support_list('all')->'rows') r where (r->>'is_demo')::boolean),0,'Demo tickets are excluded from Soporte by default');
select is((select count(*)::int from jsonb_array_elements(platform_support_list('all',null,null,true)->'rows') r where (r->>'is_demo')::boolean),1,'…and listed, marked Demo, with «Incluir Demo»');
reset role;
select is(pg_temp.q($$select count(*)::text from pikas_private.support_tickets t join accounts a on a.id=t.account_id where (a.tenant_kind='sandbox') <> t.is_demo$$),'0','Demo flag equals «sandbox tenant» for every ticket');
select ok((select bool_and(prosrc ~ 'require_no_current_demo') from pg_proc where proname in ('support_create_ticket','support_reporter_reply','platform_support_act')),'Every support mutation carries the shared Demo guard');

-- ── Customer lifecycle (202611240008): a suspended or closed customer's staff neither report nor answer ──
update accounts set status='suspended' where id='00000000-0000-0000-0000-000000000001';
select pg_temp.as_user('00000000-0000-0000-0000-000000002002');
select is(jsonb_array_length(support_reporter_context()->'scopes'),0,'A suspended customer gives its staff no reporting scope');
select is(jsonb_array_length(support_reporter_context()->'tickets'),0,'…and «Mis reportes» shows nothing, like every tenant surface');
select is(pg_temp.attempt($$select support_create_ticket(gen_random_uuid(),'00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011',null,'access','No puedo operar','Nos aparece suspendido el acceso.',null)$$),
 '42501:support_scope_required','A suspended customer''s staff cannot report (they use the contact channel)');
select is(pg_temp.attempt(format($$select support_reporter_reply(gen_random_uuid(),%L,'Seguimos sin acceso')$$,current_setting('t.tid'))),'42501:support_scope_required','…nor answer an existing ticket');
select pg_temp.as_user('00000000-0000-0000-0000-00000000ee01');
select is(platform_support_act(gen_random_uuid(),current_setting('t.tid')::uuid,'reply','Te escribimos por correo.')->>'status','in_review','Platform still reads and answers the suspended customer''s ticket');
reset role;
update accounts set status='closed' where id='00000000-0000-0000-0000-000000000001';
select pg_temp.as_user('00000000-0000-0000-0000-000000002008');
select is(jsonb_array_length(support_reporter_context()->'scopes'),0,'A closed customer gives its staff no reporting scope');
reset role;
select * from finish();
rollback;
