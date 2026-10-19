-- Platform "Agregar sede" exposure of the EXISTING platform_add_school_location (no schema change).
-- Fictional local fixtures (account 1 / school 11); everything is rolled back.
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
create function pg_temp.add(k text,lc text,ln text,cc text,cn text) returns jsonb language sql as $$
 select public.platform_add_school_location(k::uuid,'00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011',lc,ln,cc,cn)$$;
create function pg_temp.counts() returns text language sql security definer set search_path=public as $$ select concat_ws('|',
 (select count(*) from accounts),(select count(*) from schools),(select count(*) from school_locations),(select count(*) from cafeterias),
 (select count(*) from cafeteria_registers),(select count(*) from persons),(select count(*) from auth.users),
 (select count(*) from account_memberships)+(select count(*) from school_memberships)+(select count(*) from cafeteria_memberships)) $$;
reset role;
select set_config('t.platform','8f6f4cb4-de08-41bf-a062-156f636873b2',true);
select set_config('t.before',pg_temp.counts(),true);

-- Authority: the existing narrow provisioning capability; nobody tenant-side
select ok(exists(select 1 from pikas_private.platform_role_capabilities where role_code='platform_admin' and capability='platform:tenant:provision')
 and not exists(select 1 from pikas_private.platform_role_capabilities where role_code<>'platform_admin' and capability='platform:tenant:provision'),'platform:tenant:provision is Platform-admin only');
select pg_temp.as_user('ec08ad21-4020-4b0d-b041-ee4a1fe09471');
select alike(pg_temp.attempt($$select pg_temp.add('6d000000-0000-4000-8000-000000000001','SEDE-X','Sede X','CAF-X','Cafetería X')$$),'42501:%','Platform role without the capability denied');
select pg_temp.as_user('00000000-0000-0000-0000-000000002001');
select alike(pg_temp.attempt($$select pg_temp.add('6d000000-0000-4000-8000-000000000002','SEDE-X','Sede X','CAF-X','Cafetería X')$$),'42501:%','Account Admin denied');
select pg_temp.as_user('00000000-0000-0000-0000-000000002002');
select alike(pg_temp.attempt($$select pg_temp.add('6d000000-0000-4000-8000-000000000003','SEDE-X','Sede X','CAF-X','Cafetería X')$$),'42501:%','School Admin denied');
select pg_temp.as_user('00000000-0000-0000-0000-000000002003');
select alike(pg_temp.attempt($$select pg_temp.add('6d000000-0000-4000-8000-000000000004','SEDE-X','Sede X','CAF-X','Cafetería X')$$),'42501:%','Cafeteria Admin denied');
select pg_temp.as_user('00000000-0000-0000-0000-000000002008');
select alike(pg_temp.attempt($$select pg_temp.add('6d000000-0000-4000-8000-000000000005','SEDE-X','Sede X','CAF-X','Cafetería X')$$),'42501:%','Cashier denied');
reset role; select is(pg_temp.counts(),current_setting('t.before'),'Denied calls created nothing');

-- Success: exactly one location + its cafeteria under the targeted school
select pg_temp.as_user(current_setting('t.platform'));
select set_config('t.result',pg_temp.add('6d000000-0000-4000-8000-000000000010',' SEDE-NORTE ','Sede Norte Ficticia','CAF-NORTE','Cafetería Norte Ficticia')::text,true);
reset role;
select is((select concat_ws('|',l.account_id,l.school_id,l.code,l.name,c.code,c.name,c.status,c.school_location_id=l.id) from school_locations l join cafeterias c on c.school_location_id=l.id
 where l.id=(current_setting('t.result')::jsonb->>'location_id')::uuid and c.id=(current_setting('t.result')::jsonb->>'cafeteria_id')::uuid),
 '00000000-0000-0000-0000-000000000001|00000000-0000-0000-0000-000000000011|SEDE-NORTE|Sede Norte Ficticia|CAF-NORTE|Cafetería Norte Ficticia|active|t','Location + its cafeteria created under the targeted customer school (input trimmed)');
select is(pg_temp.counts(),(select concat_ws('|',split_part(v,'|',1),split_part(v,'|',2),split_part(v,'|',3)::int+1,split_part(v,'|',4)::int+1,split_part(v,'|',5),split_part(v,'|',6),split_part(v,'|',7),split_part(v,'|',8)) from (select current_setting('t.before') v) x),
 'Exactly +1 location and +1 cafeteria; no account, school, register, person, Auth user or membership');
select is((select count(*) from cafeteria_operation_settings where cafeteria_id=(current_setting('t.result')::jsonb->>'cafeteria_id')::uuid),1::bigint,'Cafeteria gets its standard catalog settings (existing trigger)');

-- Idempotency (existing journal): exact retry replays; same key + other input conflicts
select pg_temp.as_user(current_setting('t.platform'));
select is(pg_temp.add('6d000000-0000-4000-8000-000000000010','SEDE-NORTE','Sede Norte Ficticia','CAF-NORTE','Cafetería Norte Ficticia')::text,current_setting('t.result'),'Exact retry returns the original result');
select is(pg_temp.attempt($$select pg_temp.add('6d000000-0000-4000-8000-000000000010','SEDE-OTRA','Otra','CAF-OTRA','Otra')$$),'23505:platform_request_conflict','Same request key with different input is rejected');
-- Conflicts
select is(pg_temp.attempt($$select pg_temp.add('6d000000-0000-4000-8000-000000000011','sede-norte','Repetida','CAF-Z','Z')$$),'23505:platform_tenant_code_conflict','Duplicate location code (case-insensitive) rejected');
select is(pg_temp.add('6d000000-0000-4000-8000-000000000012','SEDE-SUR','Sede Sur Ficticia','CAF-NORTE','Cafetería Sur Ficticia')->>'school_id','00000000-0000-0000-0000-000000000011','A cafeteria code is unique per sede: reusing it in a NEW sede is allowed by the existing model');
select is(pg_temp.attempt($$select pg_temp.add('6d000000-0000-4000-8000-000000000013','','Sin código','CAF-Q','Q')$$),'22023:invalid_school_location_input','Missing code rejected');
select is(pg_temp.attempt($$select pg_temp.add('6d000000-0000-4000-8000-000000000014',repeat('x',65),'Largo','CAF-Q','Q')$$),'22023:invalid_school_location_input','Over-long code rejected');
select is(pg_temp.attempt($$select public.platform_add_school_location('6d000000-0000-4000-8000-000000000015','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000021','S','S','C','C')$$),'23503:active_account_school_required','A school of another customer cannot be targeted');
reset role;

-- Atomicity: if the cafeteria cannot be created, no orphan location remains
select set_config('t.mid',pg_temp.counts(),true);
create function pg_temp.fail_cafeteria() returns trigger language plpgsql as $$begin raise exception 'forced_cafeteria_failure'; end$$;
create trigger zz_fail_cafeteria before insert on public.cafeterias for each row execute function pg_temp.fail_cafeteria();
select pg_temp.as_user(current_setting('t.platform'));
select is(pg_temp.attempt($$select pg_temp.add('6d000000-0000-4000-8000-000000000020','SEDE-ATOM','Atómica','CAF-ATOM','Atómica')$$),'P0001:forced_cafeteria_failure','Forced cafeteria failure aborts the command');
reset role; drop trigger zz_fail_cafeteria on public.cafeterias;
select is(pg_temp.counts(),current_setting('t.mid'),'No partial location without its cafeteria');
select is((select count(*) from school_locations where code='SEDE-ATOM'),0::bigint,'The location from the failed attempt does not exist');

-- Lifecycle: suspended and closed customers cannot receive another sede
update accounts set status='suspended' where id='00000000-0000-0000-0000-000000000001';
select pg_temp.as_user(current_setting('t.platform'));
select is(pg_temp.attempt($$select pg_temp.add('6d000000-0000-4000-8000-000000000030','SEDE-S','S','CAF-S','S')$$),'23503:active_account_school_required','Suspended customer refused');
reset role; update accounts set status='closed' where id='00000000-0000-0000-0000-000000000001';
select pg_temp.as_user(current_setting('t.platform'));
select is(pg_temp.attempt($$select pg_temp.add('6d000000-0000-4000-8000-000000000031','SEDE-C','C','CAF-C','C')$$),'23503:active_account_school_required','Closed customer refused');
reset role;
select is((select status from accounts where id='00000000-0000-0000-0000-000000000001'),'closed','The command never changes customer lifecycle');
update accounts set status='active' where id='00000000-0000-0000-0000-000000000001';

-- Audit + journal: the real Platform operator
select is((select concat_ws('|',e.actor_kind,e.actor_auth_user_id,p.auth_user_id,e.capability,e.target_location_id::text=(current_setting('t.result')::jsonb->>'location_id'),e.target_cafeteria_id::text=(current_setting('t.result')::jsonb->>'cafeteria_id'))
 from pikas_private.platform_audit_events e join persons p on p.id=e.actor_person_id where e.request_id='6d000000-0000-4000-8000-000000000010'),
 'platform_operator|8f6f4cb4-de08-41bf-a062-156f636873b2|8f6f4cb4-de08-41bf-a062-156f636873b2|platform:tenant:provision|t|t','Audited once with the real operator and the created ids');
select is((select count(*) from pikas_private.platform_audit_events where request_id='6d000000-0000-4000-8000-000000000010'),1::bigint,'Exact retry did not audit twice');
select is((select actor_auth_user_id::text from pikas_private.platform_requests where request_id='6d000000-0000-4000-8000-000000000010'),current_setting('t.platform'),'Request journal bound to the real operator');

select * from finish();
rollback;
