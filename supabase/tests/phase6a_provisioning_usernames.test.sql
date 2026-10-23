-- Phase 6A completion: username reserved at provisioning (202610270001). Fictional local fixtures; rolled back.
-- 2003/1003 Cafeteria Admin 111; 2004 Cafeteria Admin 112; 2008 cashier 111; 2002 School Admin 11; 2001 Account Admin 1.
begin;
-- Transactional Platform Admin fixture (fictional; rolled back with the test). The canonical local DB has no platform_admin.
insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at,raw_app_meta_data,raw_user_meta_data)
 values('7a000000-0000-4000-8000-00000000ad01','00000000-0000-0000-0000-000000000000','authenticated','authenticated','tx-platform-admin@example.invalid','',now(),now(),now(),'{}','{}');
insert into public.persons(id,auth_user_id,display_name) values('7a000000-0000-4000-8000-00000000ad02','7a000000-0000-4000-8000-00000000ad01','Platform Admin de prueba');
insert into pikas_private.platform_memberships(person_id,role_code) values('7a000000-0000-4000-8000-00000000ad02','platform_admin');

create extension if not exists pgtap with schema extensions;
set search_path=public,extensions;
select no_plan();
create function pg_temp.as_user(u text) returns void language plpgsql as $$begin
 execute 'reset role'; perform set_config('request.jwt.claim.sub',u,true); execute 'set local role authenticated'; end$$;
create function pg_temp.attempt(sql text) returns text language plpgsql as $$declare m text; begin execute sql; return 'ok';
 exception when others then get stacked diagnostics m=message_text; return sqlstate||':'||m; end$$;
create function pg_temp.staff(k text,email text,username text) returns jsonb language sql as $$
 select public.provisioning_prepare_with_username('cafeteria_staff',k::uuid,null,'00000000-0000-0000-0000-000000000111',jsonb_build_object('email',email,'role','pos_cashier'),username)$$;
create function pg_temp.reserved(email text) returns text language sql security definer set search_path=public as $$
 select string_agg(intended_username,',') from public.invitations where email_key=email and status='pending'$$;
create function pg_temp.confirmed_user(id text,email text) returns void language sql as $$
 insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at,raw_app_meta_data,raw_user_meta_data)
 values(id::uuid,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',email,extensions.crypt('clave-ficticia-6b',extensions.gen_salt('bf')),now(),now(),now(),'{}','{}')$$;
create function pg_temp.with_session(u text) returns void language plpgsql as $$declare sid uuid:=gen_random_uuid(); begin
 execute 'reset role';
 insert into auth.sessions(id,user_id,created_at,updated_at) values(sid,u::uuid,now(),now());
 insert into pikas_private.application_sessions(session_id,user_id,started_at,last_active_at) values(sid,u::uuid,clock_timestamp(),clock_timestamp());
 perform set_config('request.jwt.claim.sub',u,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',u,'role','authenticated','session_id',sid)::text,true);
 execute 'set local role authenticated'; end$$;
reset role;
select set_config('t.platform','7a000000-0000-4000-8000-00000000ad01',true);
select set_config('t.persons',(select count(*)::text from persons),true);
select set_config('t.members',(select (select count(*) from cafeteria_memberships)+(select count(*) from school_memberships)+(select count(*) from account_memberships))::text,true);
insert into pikas_private.reserved_usernames(username) values('soporte');

-- 1/2/8/17: provisioning reserves a normalized username without creating a Person or authority
select pg_temp.as_user('00000000-0000-0000-0000-000000002003');
select is(pg_temp.staff('6b000000-0000-4000-8000-000000000001','jeanne.6b@example.invalid','  Jeanne.Prueba ')->>'username','jeanne.prueba','Staff provisioning accepts username + email; normalized');
reset role;
select is(pikas_private.normalize_username('  Jeanne.Prueba '),'jeanne.prueba','Same normalization as active identities');
select is(pg_temp.reserved('jeanne.6b@example.invalid'),'jeanne.prueba','Reservation lives on the existing pending invitation');
select is((select count(*)::text from persons),current_setting('t.persons'),'No Person created by reservation');
select is((select ((select count(*) from cafeteria_memberships)+(select count(*) from school_memberships)+(select count(*) from account_memberships))::text),current_setting('t.members'),'No membership created by reservation');
select is((select count(*) from pikas_private.login_identities where username='jeanne.prueba'),0::bigint,'No login identity before completion');

-- 3/4/5/6: availability
update pikas_private.login_identities set username=null where username='ocupado.6b';
insert into pikas_private.login_identities(person_id,username) values('00000000-0000-0000-0000-000000001008','ocupado.6b')
 on conflict(person_id) do update set username='ocupado.6b';
select pg_temp.as_user('00000000-0000-0000-0000-000000002003');
select is(pg_temp.attempt($$select pg_temp.staff('6b000000-0000-4000-8000-000000000002','otra.6b@example.invalid','ocupado.6b')$$),'23505:username_unavailable','Active Person username cannot be reserved');
select is(pg_temp.attempt($$select pg_temp.staff('6b000000-0000-4000-8000-000000000003','otra.6b@example.invalid','jeanne.prueba')$$),'23505:username_unavailable','Pending reservation cannot be claimed by another invitation');
select is(pg_temp.attempt($$select pg_temp.staff('6b000000-0000-4000-8000-000000000004','otra.6b@example.invalid','JEANNE.PRUEBA')$$),'23505:username_unavailable','Case variant cannot bypass the reservation');
select is(pg_temp.attempt($$select pg_temp.staff('6b000000-0000-4000-8000-000000000005','otra.6b@example.invalid','soporte')$$),'22023:username_reserved','Reserved/system username cannot be provisioned');
select is(pg_temp.attempt($$select pg_temp.staff('6b000000-0000-4000-8000-000000000006','otra.6b@example.invalid','a..b')$$),'22023:invalid_username','Malformed username rejected');
select is(pg_temp.attempt($$select pg_temp.staff('6b000000-0000-4000-8000-000000000007','otra.6b@example.invalid','x@y.com')$$),'22023:invalid_username','Email-shaped username rejected');
select is(pg_temp.attempt($$select pg_temp.staff('6b000000-0000-4000-8000-000000000001','jeanne.6b@example.invalid','otro.nombre')$$),'23505:request_key_reused','Same request key with another username is a reused key');
select is(pg_temp.staff('6b000000-0000-4000-8000-000000000001','jeanne.6b@example.invalid','jeanne.prueba')->>'username','jeanne.prueba','Exact retry replays');
reset role;
select is((select count(*) from public.invitations where email_key in ('otra.6b@example.invalid')),0::bigint,'Rejected reservations rolled back their invitation');
-- Platform/tenant identity support cannot take a live reservation either.
select pg_temp.as_user(current_setting('t.platform'));
select is(pg_temp.attempt($$select identity_set_username('00000000-0000-0000-0000-000000001011','jeanne.prueba',(select 1))$$),'23505:username_unavailable','Support username changes respect live reservations');

-- 16: provisioning authority unchanged
select pg_temp.as_user('00000000-0000-0000-0000-000000002004');
select alike(pg_temp.attempt($$select pg_temp.staff('6b000000-0000-4000-8000-000000000010','x.6b@example.invalid','x.seis')$$),'42501:%','Cafeteria Admin of 112 cannot provision in 111');
select pg_temp.as_user('00000000-0000-0000-0000-000000002008');
select alike(pg_temp.attempt($$select pg_temp.staff('6b000000-0000-4000-8000-000000000011','x.6b@example.invalid','x.seis')$$),'42501:%','Cashier cannot provision');
reset role; select is((select count(*) from public.invitations where email_key='x.6b@example.invalid'),0::bigint,'Denied provisioning leaves nothing');

-- 13: reissue / pending change
select pg_temp.as_user('00000000-0000-0000-0000-000000002003');
select set_config('t.inv',(pg_temp.staff('6b000000-0000-4000-8000-000000000012','jeanne.6b@example.invalid','jeanne.prueba')->>'target_id'),true);
reset role;
select is((select count(*) from public.invitations where email_key='jeanne.6b@example.invalid' and status='pending'),1::bigint,'Re-preparing the same access reuses the pending invitation');
select pg_temp.as_user('00000000-0000-0000-0000-000000002003');
select is((cafeteria_admin_command('00000000-0000-0000-0000-000000000111','6b000000-0000-4000-8000-000000000013','staff_prepare','{"email":"jeanne.6b@example.invalid","role":"pos_cashier"}')->>'target_id'),current_setting('t.inv'),'Legacy re-prepare without username keeps the same invitation');
reset role; select is(pg_temp.reserved('jeanne.6b@example.invalid'),'jeanne.prueba','… and preserves the intended username');
select pg_temp.as_user('00000000-0000-0000-0000-000000002003');
select is(pg_temp.staff('6b000000-0000-4000-8000-000000000014','jeanne.6b@example.invalid','jeanne.santiago')->>'username','jeanne.santiago','Pending change by the authorized admin replaces the reservation');
select is(pg_temp.staff('6b000000-0000-4000-8000-000000000015','libera.6b@example.invalid','jeanne.prueba')->>'username','jeanne.prueba','The previous username is released at once');
reset role; select is(pg_temp.reserved('jeanne.6b@example.invalid'),'jeanne.santiago','Exactly one reservation for the intended user');

-- 14: terminal states release
update public.invitations set status='revoked' where email_key='libera.6b@example.invalid';
select pg_temp.as_user('00000000-0000-0000-0000-000000002003');
select is(pg_temp.staff('6b000000-0000-4000-8000-000000000016','tercera.6b@example.invalid','jeanne.prueba')->>'username','jeanne.prueba','Revoked provisioning releases its username');
reset role; update public.invitations set status='expired' where email_key='tercera.6b@example.invalid';
select pg_temp.as_user('00000000-0000-0000-0000-000000002003');
select is(pg_temp.staff('6b000000-0000-4000-8000-000000000017','cuarta.6b@example.invalid','jeanne.prueba')->>'username','jeanne.prueba','Expired-status provisioning releases its username');
reset role;
insert into public.invitations(account_id,school_id,cafeteria_id,scope_kind,role_code,intended_email,token_hash,invited_by,expires_at,created_at,intended_username)
 values('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000111','cafeteria','pos_cashier','vieja.6b@example.invalid',
  encode(extensions.digest('6b-vieja','sha256'),'hex'),'00000000-0000-0000-0000-000000001003',now()-interval '1 day',now()-interval '9 days','vencido.6b');
select pg_temp.as_user('00000000-0000-0000-0000-000000002003');
select is(pg_temp.staff('6b000000-0000-4000-8000-000000000018','quinta.6b@example.invalid','vencido.6b')->>'username','vencido.6b','Time-expired pending provisioning never traps a username');
reset role;

-- 9/10/11/12: completion attaches the username to the SAME new Person; immediate login by username or email
select pg_temp.confirmed_user('00000000-0000-0000-0000-00000000b001','jeanne.6b@example.invalid');
select is((select pikas_private.current_person_id() from (select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000b001',true)) x),null,'Before completion the invitee holds no PIKAS identity');
select pg_temp.as_user('00000000-0000-0000-0000-000000002003');
select is(cafeteria_admin_command('00000000-0000-0000-0000-000000000111','6b000000-0000-4000-8000-000000000020','staff_complete',jsonb_build_object('invitation_id',current_setting('t.inv'),'display_name','Jeanne Ficticia 6B'))->>'operation','staff_complete','Existing completion flow unchanged');
reset role;
select set_config('t.jeanne',(select id::text from persons where auth_user_id='00000000-0000-0000-0000-00000000b001'),true);
select is((select count(*) from persons where auth_user_id='00000000-0000-0000-0000-00000000b001'),1::bigint,'Exactly one Person for the Auth user');
select is((select count(*) from auth.users where lower(email)='jeanne.6b@example.invalid'),1::bigint,'No second Auth user');
select is((select username from pikas_private.login_identities where person_id=current_setting('t.jeanne')::uuid),'jeanne.santiago','Reserved username attached to the completed Person');
select is((select concat_ws('|',actor_scope,actor_person_id,metadata->>'to',metadata->>'source') from pikas_private.identity_audit_events where target_person_id=current_setting('t.jeanne')::uuid),
 'tenant|00000000-0000-0000-0000-000000001003|jeanne.santiago|provisioning','Attachment audited with the provisioning operator');
set local role service_role;
select is(login_identifier_email('JEANNE.SANTIAGO'),'jeanne.6b@example.invalid','Username resolves immediately after completion');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-00000000b001');
select is(pikas_private.current_person_id()::text,current_setting('t.jeanne'),'The same Person signs in (username or email reach this Auth user)');
reset role;
select is((select status from public.invitations where id=current_setting('t.inv')::uuid),'accepted','Invitation accepted; reservation no longer live');
select pg_temp.as_user('00000000-0000-0000-0000-000000002003');
select is(pg_temp.attempt($$select pg_temp.staff('6b000000-0000-4000-8000-000000000021','otra.6b@example.invalid','jeanne.santiago')$$),'23505:username_unavailable','Completed username stays protected as a Person username');
-- Same human provisioned into another access with the same username is allowed; a different one is not.
select is(public.provisioning_prepare_with_username('cafeteria_staff','6b000000-0000-4000-8000-000000000022',null,'00000000-0000-0000-0000-000000000111','{"email":"jeanne.6b@example.invalid","role":"pos_supervisor"}','jeanne.santiago')->>'username','jeanne.santiago','Existing identity keeps its username for a further access');
select is(pg_temp.attempt($$select public.provisioning_prepare_with_username('cafeteria_staff','6b000000-0000-4000-8000-000000000023',null,'00000000-0000-0000-0000-000000000113','{"email":"jeanne.6b@example.invalid","role":"pos_cashier"}','jeanne.otra')$$),'42501:cafeteria_authority_required','(Out-of-scope cafeteria still denied)');
reset role;

-- 15: legacy invitations without usernames keep working
select pg_temp.confirmed_user('00000000-0000-0000-0000-00000000b002','legado.6b@example.invalid');
select pg_temp.as_user('00000000-0000-0000-0000-000000002003');
select set_config('t.legacy',cafeteria_admin_command('00000000-0000-0000-0000-000000000111','6b000000-0000-4000-8000-000000000030','staff_prepare','{"email":"legado.6b@example.invalid","role":"pos_cashier"}')->>'target_id',true);
select is(cafeteria_admin_command('00000000-0000-0000-0000-000000000111','6b000000-0000-4000-8000-000000000031','staff_complete',jsonb_build_object('invitation_id',current_setting('t.legacy'),'display_name','Legado Ficticio'))->>'operation','staff_complete','Legacy provisioning completes without a username');
reset role;
select is((select count(*) from pikas_private.login_identities li join persons p on p.id=li.person_id where p.auth_user_id='00000000-0000-0000-0000-00000000b002' and li.username is not null),0::bigint,'Legacy identity has no username (optional)');

-- School admin and cafeteria-admin delegation paths
select pg_temp.as_user('00000000-0000-0000-0000-000000002002');
select is(public.provisioning_prepare_with_username('school_admin','6b000000-0000-4000-8000-000000000040','00000000-0000-0000-0000-000000000011',null,'{"email":"escuela.6b@example.invalid"}','escuela.seis')->>'username','escuela.seis','School admin provisioning reserves');
select pg_temp.with_session('00000000-0000-0000-0000-000000002001');
select is(public.provisioning_prepare_with_username('cafeteria_admin','6b000000-0000-4000-8000-000000000041','00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000113','{"cafeteria_id":"00000000-0000-0000-0000-000000000113","email":"manuel.6b@example.invalid"}','manuel.seis')->>'username','manuel.seis','Cafeteria admin delegation reserves');
select set_config('request.jwt.claims','',true); select pg_temp.as_user('00000000-0000-0000-0000-000000002003');
select alike(pg_temp.attempt($$select public.provisioning_prepare_with_username('school_admin','6b000000-0000-4000-8000-000000000042','00000000-0000-0000-0000-000000000011',null,'{"email":"nope.6b@example.invalid"}','nope.seis')$$),'42501:%','Cafeteria Admin cannot provision school admins');
reset role;

-- Platform initial customer admin intent: reserved, attached when the identity is linked
select pg_temp.with_session(current_setting('t.platform'));
select set_config('t.intent',platform_prepare_customer_admin_with_username('6b000000-0000-4000-8000-000000000050','00000000-0000-0000-0000-000000000001','account',null,null,'account_admin','inicial.6b@example.invalid',now()+interval '7 days',' Inicial.Seis ')->>'intent_id',true);
select set_config('request.jwt.claims','',true); select pg_temp.as_user('00000000-0000-0000-0000-000000002003');
select is(pg_temp.attempt($$select pg_temp.staff('6b000000-0000-4000-8000-000000000051','otra2.6b@example.invalid','inicial.seis')$$),'23505:username_unavailable','Intent reservation blocks other provisioning');
select pg_temp.with_session('00000000-0000-0000-0000-000000002003');
select alike(pg_temp.attempt($$select platform_prepare_customer_admin_with_username('6b000000-0000-4000-8000-000000000052','00000000-0000-0000-0000-000000000001','account',null,null,'account_admin','z.6b@example.invalid',now()+interval '7 days','zeta.seis')$$),'42501:%','Tenant admins cannot use the Platform intent path');
reset role;
select pg_temp.confirmed_user('00000000-0000-0000-0000-00000000b003','inicial.6b@example.invalid');
select pg_temp.with_session(current_setting('t.platform'));
select platform_link_customer_admin_identity('6b000000-0000-4000-8000-000000000053',current_setting('t.intent')::uuid,'00000000-0000-0000-0000-00000000b003','Inicial Ficticia 6B');
reset role;
select is((select li.username from pikas_private.login_identities li join persons p on p.id=li.person_id where p.auth_user_id='00000000-0000-0000-0000-00000000b003'),'inicial.seis','Intent username attached to the linked Person');
select is((select count(*) from persons where auth_user_id='00000000-0000-0000-0000-00000000b003'),1::bigint,'One Person for the linked identity');

select * from finish();
rollback;
