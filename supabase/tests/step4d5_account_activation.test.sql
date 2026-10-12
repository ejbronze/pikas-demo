begin;
create extension if not exists pgtap with schema extensions;
set search_path=public,extensions;
select no_plan();
create function pg_temp.id(n integer) returns uuid language sql immutable as $$select ('4d500000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
create temp table saved(k text primary key,v text);grant all on saved to authenticated,anon,service_role;
insert into auth.users(id,aud,role,email,email_confirmed_at,encrypted_password,raw_app_meta_data) values
(pg_temp.id(1),'authenticated','authenticated','activation-admin@example.invalid',now(),'synthetic','{}'),
(pg_temp.id(3),'authenticated','authenticated','activation-wrong@example.invalid',now(),'synthetic','{}'),
(pg_temp.id(4),'authenticated','authenticated','activation-unrelated@example.invalid',null,'','{}'),
(pg_temp.id(5),'authenticated','authenticated','activation-confirmed@example.invalid',now(),'synthetic','{}'),
(pg_temp.id(6),'authenticated','authenticated','activation-linked@example.invalid',null,'','{}');
insert into public.persons(id,auth_user_id,display_name) values(pg_temp.id(11),pg_temp.id(1),'Synthetic admin'),(pg_temp.id(16),pg_temp.id(6),'Synthetic linked');
insert into pikas_private.platform_memberships(person_id,role_code) values(pg_temp.id(11),'platform_admin');
insert into pikas_private.platform_team_handles(person_id) values(pg_temp.id(11));
insert into public.account_memberships(account_id,person_id,role_code) values('00000000-0000-0000-0000-000000000001',pg_temp.id(16),'account_admin');
select ok(not has_table_privilege('authenticated','pikas_private.account_activation_flows','select'),'Provenance private');
select ok(not has_table_privilege('anon','pikas_private.account_activation_invitations','select'),'Digests private');
select ok(not has_function_privilege('anon','public.platform_prepare_activation(text)','execute'),'Anonymous cannot issue');
select ok(not has_function_privilege('authenticated','public.activation_provider_context(text,text)','execute'),'Provider context never browser callable');
select ok(has_function_privilege('service_role','public.activation_provider_context(text,text)','execute'),'Narrow provider context server-only');
select ok(not has_function_privilege('service_role','public.platform_bind_activation(text,text)','execute'),'Service role cannot substitute issuer authorization');
select set_config('request.jwt.claim.sub',pg_temp.id(1)::text,true);set local role authenticated;
select lives_ok($$select platform_team_command(pg_temp.id(100),'prepare','{"name":"Synthetic","email":"activation-recipient@example.invalid","demo":true}')$$,'Prepare unchanged');
insert into saved select 'intent',item->>'handle' from jsonb_array_elements(platform_team_read()->'prepared') item where item->>'email'='activation-recipient@example.invalid';
insert into saved values('invitation',platform_prepare_activation((select v from saved where k='intent'))->>'handle');
reset role;
insert into auth.users(id,aud,role,email,email_confirmed_at,encrypted_password,raw_app_meta_data)
select pg_temp.id(2),'authenticated','authenticated',email_key,null,'',jsonb_build_object('pikas_activation_owner',owner_key)
from pikas_private.account_activation_flows where source_handle=(select v from saved where k='intent');
insert into saved values('digest',encode(digest(encode(gen_random_bytes(32),'hex'),'sha256'),'hex'));
select set_config('request.jwt.claim.sub',pg_temp.id(1)::text,true);set local role authenticated;
select lives_ok($$select platform_bind_activation((select v from saved where k='invitation'),(select v from saved where k='digest'))$$,'Lost identity-create response reconciles by owned marker');
select throws_ok($$select platform_bind_activation((select v from saved where k='invitation'),repeat('b',64))$$,'42501',null,'Digest immutable');
select throws_ok($$select activation_consume((select v from saved where k='digest'))$$,'42501',null,'Inviter cannot consume');
reset role;
select is((select auth_id from pikas_private.account_activation_flows where source_handle=(select v from saved where k='intent')),pg_temp.id(2),'Exact owned UUID recorded');
select is((select count(*) from public.persons where auth_user_id=pg_temp.id(2)),0::bigint,'Issue creates zero Person');
-- Every candidate from the complete six-digit native OTP space fails to derive this binding.
select ok(not exists(select 1 from generate_series(0,999999) n where
 encode(digest(encode(digest('activation-recipient@example.invalid'||lpad(n::text,6,'0'),'sha224'),'hex'),'sha256'),'hex')=(select v from saved where k='digest')),'All million native OTP candidates cannot derive independent app digest');
select set_config('request.jwt.claim.sub','',true);set local role anon;
select is(activation_preview((select v from saved where k='digest')),jsonb_build_object('handle',(select v from saved where k='invitation')),'Valid random bearer reveals only handle');
select is(activation_preview(repeat('f',64)),null::jsonb,'Random digest fails identically');
select is(activation_preview(encode(digest(encode(digest('activation-recipient@example.invalid000001','sha224'),'hex'),'sha256'),'hex')),null::jsonb,'Known email/native candidate cannot use anonymous oracle');
select is(activation_preview('bad'),null::jsonb,'Malformed digest fails identically');
reset role;select set_config('request.jwt.claim.sub',pg_temp.id(2)::text,true);set local role authenticated;
select throws_ok($$select activation_consume((select v from saved where k='digest'))$$,'42501',null,'Unconfirmed recipient cannot consume');
reset role;update auth.users set email_confirmed_at=now() where id=pg_temp.id(2);
select set_config('request.jwt.claim.sub',pg_temp.id(3)::text,true);set local role authenticated;
select throws_ok($$select activation_consume((select v from saved where k='digest'))$$,'42501',null,'Wrong Auth UUID/cross-intent fails');
select throws_ok($$select platform_prepare_activation((select v from saved where k='intent'))$$,'42501',null,'Ordinary user cannot issue');
reset role;select set_config('request.jwt.claim.sub',pg_temp.id(2)::text,true);set local role authenticated;
select lives_ok($$select activation_consume((select v from saved where k='digest'))$$,'Confirmed recipient consumes');
select lives_ok($$select activation_consume((select v from saved where k='digest'))$$,'Lost consume response safely resumes');
select ok(activation_preview((select v from saved where k='digest')) is not null,'Consumed-but-password-pending credential recovers');
select ok(activation_password_context((select v from saved where k='invitation')),'Recipient-only password pending');
select is(activation_password_status((select v from saved where k='invitation')),'pending','Reload resumes pending state');
select is(activation_claim_password((select v from saved where k='invitation'),repeat('a',64)),'pending','First password operation claimed');
select is(activation_claim_password((select v from saved where k='invitation'),repeat('a',64)),'pending','Same uncertain password safely retries');
select throws_ok($$select activation_claim_password((select v from saved where k='invitation'),repeat('b',64))$$,'42501',null,'Different concurrent password cannot overwrite operation');
select ok(not has_function_privilege('authenticated','public.activation_reject_password(text,text,uuid)','execute'),'Recipient cannot release an uncertain payload directly');
reset role;set local role service_role;
select lives_ok($$select activation_reject_password((select v from saved where k='invitation'),repeat('a',64),pg_temp.id(2))$$,'Definitive password rejection releases matching pending payload');
reset role;set local role authenticated;
select is(activation_claim_password((select v from saved where k='invitation'),repeat('b',64)),'pending','Stronger replacement permitted after definitive rejection');
select throws_ok($$select platform_team_command(pg_temp.id(101),'complete',jsonb_build_object('handle',(select v from saved where k='intent')))$$,'42501',null,'Recipient cannot grant platform role');
reset role;
select is((select count(*) from pikas_private.account_activation_events where invitation_handle=(select v from saved where k='invitation') and action='activated'),1::bigint,'Duplicate consume audit once');
select is((select count(*) from public.persons where auth_user_id=pg_temp.id(2)),0::bigint,'Recovery creates zero Person');
select set_config('request.jwt.claim.sub',pg_temp.id(1)::text,true);set local role authenticated;
select ok(not activation_password_context((select v from saved where k='invitation')),'Inviter cannot set recipient password');
select throws_ok($$select activation_password_status((select v from saved where k='invitation'))$$,'42501',null,'Inviter cannot finalize');
insert into saved values('reissue',platform_prepare_activation((select v from saved where k='intent'))->>'handle');
select lives_ok($$select platform_bind_activation((select v from saved where k='reissue'),repeat('c',64))$$,'Safe reissue uses same flow identity after interruption');
select is(activation_preview((select v from saved where k='digest')),null::jsonb,'Old application credential explicitly revoked');
reset role;
select is((select count(*) from auth.users where email='activation-recipient@example.invalid'),1::bigint,'No duplicate identity');
select set_config('request.jwt.claim.sub',pg_temp.id(2)::text,true);set local role authenticated;
select lives_ok($$select activation_consume(repeat('c',64))$$,'Recipient resumes new credential');
reset role;update auth.users set encrypted_password='synthetic-successful-provider-password' where id=pg_temp.id(2);
select set_config('request.jwt.claim.sub',pg_temp.id(2)::text,true);set local role authenticated;
select ok(not activation_password_context((select v from saved where k='reissue')),'Auth password closes setup before finalize response');
select is(activation_preview(repeat('c',64)),null::jsonb,'Finalized credential no longer recovers sessions');
select throws_ok($$select activation_consume(repeat('c',64))$$,'42501',null,'Finalized activation replay refused');
select is(activation_password_status((select v from saved where k='reissue')),'ready','Lost password-success response reconciled from Auth');
select is(activation_password_status((select v from saved where k='reissue')),'ready','Repeated finalize returns ready without password reset');
reset role;select set_config('request.jwt.claim.sub',pg_temp.id(1)::text,true);set local role authenticated;
select throws_ok($$select platform_prepare_activation((select v from saved where k='intent'))$$,'42501',null,'Ready flow cannot issue session-recovery credential');
select ok((select (item->>'identity_ready')::boolean from jsonb_array_elements(platform_team_activation_read()->'prepared') item where item->>'handle'=(select v from saved where k='intent')),'Password-ready identity shown to admin');
select lives_ok($$select platform_team_command(pg_temp.id(102),'complete',jsonb_build_object('handle',(select v from saved where k='intent')))$$,'Frozen completion mandatory');
select lives_ok($$select platform_team_command(pg_temp.id(102),'complete',jsonb_build_object('handle',(select v from saved where k='intent')))$$,'Frozen exact completion replay');
reset role;
select is((select count(*) from pikas_private.platform_audit_events where request_id=pg_temp.id(102)),1::bigint,'Completion audit once');
select is((select count(*) from pikas_private.platform_memberships m join public.persons p on p.id=m.person_id where p.auth_user_id=pg_temp.id(2)),2::bigint,'Separate platform admin and sandbox roles only after completion');
select is((select count(*) from public.account_memberships m join public.persons p on p.id=m.person_id where p.auth_user_id=pg_temp.id(2)),0::bigint,'Zero customer membership');
select is((select count(*) from public.school_memberships m join public.persons p on p.id=m.person_id where p.auth_user_id=pg_temp.id(2)),0::bigint,'Zero school membership');
select is((select count(*) from public.cafeteria_memberships m join public.persons p on p.id=m.person_id where p.auth_user_id=pg_temp.id(2)),0::bigint,'Zero cashier membership');
-- Foreign identities rejected before any native invitation/token replacement.
select set_config('request.jwt.claim.sub',pg_temp.id(1)::text,true);set local role authenticated;
select platform_team_command(pg_temp.id(104),'prepare','{"name":"Foreign","email":"activation-unrelated@example.invalid","demo":false}');
select throws_ok($$select platform_prepare_activation(item->>'handle') from jsonb_array_elements(platform_team_read()->'prepared') item where item->>'email'='activation-unrelated@example.invalid'$$,'42501',null,'Unrelated unconfirmed identity rejected');
select platform_team_command(pg_temp.id(105),'prepare','{"name":"Foreign","email":"activation-confirmed@example.invalid","demo":false}');
select throws_ok($$select platform_prepare_activation(item->>'handle') from jsonb_array_elements(platform_team_read()->'prepared') item where item->>'email'='activation-confirmed@example.invalid'$$,'42501',null,'Preexisting confirmed identity rejected');
select platform_team_command(pg_temp.id(106),'prepare','{"name":"Foreign","email":"activation-linked@example.invalid","demo":false}');
select throws_ok($$select platform_prepare_activation(item->>'handle') from jsonb_array_elements(platform_team_read()->'prepared') item where item->>'email'='activation-linked@example.invalid'$$,'42501',null,'Already-linked unconfirmed identity rejected');
reset role;
select is((select auth_user_id from public.persons where id=pg_temp.id(16)),pg_temp.id(6),'Linked identity never reassigned');
select is((select count(*) from pikas_private.account_activation_flows where email_key like 'activation-unrelated%' or email_key like 'activation-confirmed%' or email_key like 'activation-linked%'),0::bigint,'Foreign issuance rolled back');
-- Expiry and source validation stay authoritative, including generic unsupported sources.
update pikas_private.account_activation_invitations set expires_at=clock_timestamp()-interval '1 second' where handle=(select v from saved where k='reissue');
select is(activation_preview(repeat('c',64)),null::jsonb,'Expired credential unavailable');
select throws_ok($$select pikas_private.lock_activation_source('unsupported','public-id','activation-recipient@example.invalid')$$,'42501',null,'Unsupported source fails closed');
select * from finish();
rollback;
