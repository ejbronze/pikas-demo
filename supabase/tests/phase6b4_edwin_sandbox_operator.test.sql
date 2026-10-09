-- Phase 6B.4: local-only fixtures, rolled back. run_bootstrap executes an exact migration DO-block copy.
begin;
create extension if not exists pgtap with schema extensions;
set search_path=public,extensions;
select no_plan();

create function pg_temp.run_bootstrap() returns void language plpgsql as $runner$
begin
  execute $migration$
do $bootstrap$
declare
  person_value constant uuid := '82af93c4-730f-468c-9e4c-2c5238f226f1';
  auth_value constant uuid := 'ec08ad21-4020-4b0d-b041-ee4a1fe09471';
  migration_value constant text := '202610090004_edwin_sandbox_operator_bootstrap';
  admin_before jsonb;
  membership_value uuid;
  operator_count bigint;
  audit_count bigint;
begin
  if not exists(select 1 from public.persons where id=person_value) then
    if not exists(select 1 from public.accounts) and not exists(select 1 from public.persons)
      and not exists(select 1 from pikas_private.platform_memberships) then
      raise notice 'Pristine database: no Edwin operator bootstrap';
      return;
    end if;
    raise exception 'sandbox_operator_bootstrap_person_missing';
  end if;

  -- Serialize grants/replays and keep definitions stable throughout verification and grant.
  lock table pikas_private.platform_memberships, pikas_private.platform_audit_events in share row exclusive mode;
  lock table pikas_private.platform_roles, pikas_private.platform_capabilities,
    pikas_private.platform_role_capabilities in share mode;
  perform 1 from public.persons where id=person_value for update;
  if not exists(select 1 from public.persons where id=person_value
      and auth_user_id=auth_value and status='active') then
    raise exception 'sandbox_operator_bootstrap_person_state_mismatch';
  end if;
  perform 1 from auth.users where id=auth_value for share;
  if not exists(select 1 from auth.users where id=auth_value) then
    raise exception 'sandbox_operator_bootstrap_auth_state_mismatch';
  end if;

  if (select count(*) from pikas_private.platform_roles
      where role_code in ('platform_admin','platform_sandbox_operator') and status='active')<>2
    or (select array_agg(capability order by capability) from pikas_private.platform_role_capabilities
        where role_code='platform_admin') is distinct from array[
      'platform:audit:read','platform:customer_admin:provision','platform:identity:link',
      'platform:tenant:lifecycle:read','platform:tenant:provision']::text[]
    or (select array_agg(capability order by capability) from pikas_private.platform_role_capabilities
        where role_code='platform_sandbox_operator') is distinct from array['platform:sandbox:pov:enter']::text[] then
    raise exception 'sandbox_operator_bootstrap_capabilities_mismatch';
  end if;

  select to_jsonb(m) into admin_before from pikas_private.platform_memberships m
    where person_id=person_value and role_code='platform_admin' and status='active';
  if admin_before is null then
    raise exception 'sandbox_operator_bootstrap_admin_state_mismatch';
  end if;

  select count(*) into operator_count from pikas_private.platform_memberships
    where person_id=person_value and role_code='platform_sandbox_operator';
  select count(*) into audit_count from pikas_private.platform_audit_events
    where action='sandbox_operator_bootstrapped' and metadata->>'migration'=migration_value;
  if operator_count<>0 then
    select id into membership_value from pikas_private.platform_memberships
      where person_id=person_value and role_code='platform_sandbox_operator' and status='active'
        and granted_by_person_id is null and revoked_at is null;
    if operator_count<>1 or membership_value is null or audit_count<>1
      or not exists(select 1 from pikas_private.platform_audit_events
        where action='sandbox_operator_bootstrapped' and metadata->>'migration'=migration_value
          and actor_kind='owner_root_bootstrap' and actor_person_id is null and actor_auth_user_id is null
          and target_person_id=person_value and capability='platform:sandbox:pov:enter'
          and outcome='succeeded' and reason_code='owner_root_bootstrap'
          and metadata->>'membership_id'=membership_value::text
          and metadata->>'role_code'='platform_sandbox_operator') then
      raise exception 'sandbox_operator_bootstrap_existing_state_mismatch';
    end if;
    return;
  end if;
  if audit_count<>0 then
    raise exception 'sandbox_operator_bootstrap_existing_state_mismatch';
  end if;

  insert into pikas_private.platform_memberships(person_id,role_code,status)
    values (person_value,'platform_sandbox_operator','active') returning id into membership_value;
  insert into pikas_private.platform_audit_events(actor_kind,capability,action,target_person_id,
    outcome,reason_code,metadata)
    values ('owner_root_bootstrap','platform:sandbox:pov:enter','sandbox_operator_bootstrapped',
      person_value,'succeeded','owner_root_bootstrap',jsonb_build_object(
        'migration',migration_value,'role_code','platform_sandbox_operator','membership_id',membership_value));

  if (select to_jsonb(m) from pikas_private.platform_memberships m
        where id=(admin_before->>'id')::uuid) is distinct from admin_before
    or (select count(*) from pikas_private.platform_memberships
        where person_id=person_value and role_code='platform_sandbox_operator' and status='active')<>1 then
    raise exception 'sandbox_operator_bootstrap_grant_assertion_failed';
  end if;
end
$bootstrap$;
$migration$;
end $runner$;

-- Snapshot full rows in all application and Auth tables, including definitions and operational state.
create function pg_temp.snapshot() returns jsonb language plpgsql as $$
declare r record; rows_value jsonb; result_value jsonb := '{}'::jsonb;
begin
  for r in select schemaname,tablename from pg_tables
    where schemaname in ('public','pikas_private','auth') order by schemaname,tablename loop
    execute format('select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),''[]''::jsonb) from %I.%I t',r.schemaname,r.tablename) into rows_value;
    result_value := result_value || jsonb_build_object(r.schemaname||'.'||r.tablename,rows_value);
  end loop;
  return result_value;
end $$;

-- Every attempted case rolls back its fixture edits and any grant, including on unexpected success.
create function pg_temp.attempt(setup_sql text) returns text language plpgsql as $$
declare message_value text;
begin
  begin
    execute setup_sql;
    perform pg_temp.run_bootstrap();
    raise exception using errcode='Z0001',message='bootstrap_succeeded';
  exception when others then
    get stacked diagnostics message_value=message_text;
  end;
  return message_value;
end $$;

-- Test-only removal bypasses truncate guards; all normal guards run during the bootstrap.
create function pg_temp.pristine() returns bigint[] language plpgsql as $$
declare before_count bigint; after_count bigint;
begin
  begin
    set local session_replication_role=replica;
    truncate public.accounts,public.persons,pikas_private.platform_memberships cascade;
    set local session_replication_role=origin;
    select (select count(*) from public.accounts)+(select count(*) from public.persons)
      +(select count(*) from pikas_private.platform_memberships) into before_count;
    perform pg_temp.run_bootstrap();
    select (select count(*) from public.accounts)+(select count(*) from public.persons)
      +(select count(*) from pikas_private.platform_memberships) into after_count;
    raise exception using errcode='Z0001',message='rollback_pristine_fixture';
  exception when sqlstate 'Z0001' then null;
  end;
  return array[before_count,after_count];
end $$;
create temp table pristine_result as select pg_temp.pristine() as counts;
select is((select counts[1] from pristine_result),0::bigint,'Pristine reset contains no accounts, persons or platform memberships');
select is((select counts[2] from pristine_result),0::bigint,'Pristine bootstrap succeeds without creating identities or memberships');

create temp table before_missing as select pg_temp.snapshot() as data;
select throws_ok($$select pg_temp.run_bootstrap()$$,'P0001','sandbox_operator_bootstrap_person_missing','Initialized DB missing Edwin fails closed');
select is(pg_temp.snapshot(),(select data from before_missing),'Missing-person failure changes no existing row');

-- Synthetic Edwin and another administrator; neither identity is created by the migration.
insert into auth.users(id,aud,role,email,confirmed_at) values
 ('ec08ad21-4020-4b0d-b041-ee4a1fe09471','authenticated','authenticated','p6b4-edwin@example.invalid',now()),
 ('00000000-0000-0000-0000-000000002701','authenticated','authenticated','p6b4-other@example.invalid',now()),
 ('00000000-0000-0000-0000-000000002702','authenticated','authenticated','p6b4-unlinked@example.invalid',now());
insert into public.persons(id,auth_user_id,display_name,status) values
 ('82af93c4-730f-468c-9e4c-2c5238f226f1','ec08ad21-4020-4b0d-b041-ee4a1fe09471','Edwin test fixture','active'),
 ('00000000-0000-0000-0000-000000001701','00000000-0000-0000-0000-000000002701','Unrelated administrator','active');
insert into pikas_private.platform_memberships(person_id,role_code,status) values
 ('82af93c4-730f-468c-9e4c-2c5238f226f1','platform_admin','active'),
 ('00000000-0000-0000-0000-000000001701','platform_admin','active');
create temp table before_failures as select pg_temp.snapshot() as data;
select is(pg_temp.attempt($case$update public.persons set auth_user_id=null where id='82af93c4-730f-468c-9e4c-2c5238f226f1'$case$),'sandbox_operator_bootstrap_person_state_mismatch','Auth-less Edwin fails closed');
select is(pg_temp.attempt($case$update public.persons set auth_user_id='00000000-0000-0000-0000-000000002702' where id='82af93c4-730f-468c-9e4c-2c5238f226f1'$case$),'sandbox_operator_bootstrap_person_state_mismatch','Wrong Auth link fails closed');
select is(pg_temp.attempt($case$update public.persons set status='suspended' where id='82af93c4-730f-468c-9e4c-2c5238f226f1'$case$),'sandbox_operator_bootstrap_person_state_mismatch','Suspended Person fails closed');
select is(pg_temp.attempt($case$update public.persons set status='inactive' where id='82af93c4-730f-468c-9e4c-2c5238f226f1'$case$),'sandbox_operator_bootstrap_person_state_mismatch','Inactive Person fails closed');
select is(pg_temp.attempt($case$set local session_replication_role=replica; delete from auth.users where id='ec08ad21-4020-4b0d-b041-ee4a1fe09471'; set local session_replication_role=origin$case$),'sandbox_operator_bootstrap_auth_state_mismatch','Missing expected Auth row fails closed');
select is(pg_temp.attempt($case$set local session_replication_role=replica; delete from pikas_private.platform_memberships where person_id='82af93c4-730f-468c-9e4c-2c5238f226f1'; set local session_replication_role=origin$case$),'sandbox_operator_bootstrap_admin_state_mismatch','Missing admin membership fails closed');
select is(pg_temp.attempt($case$update pikas_private.platform_memberships set status='suspended' where person_id='82af93c4-730f-468c-9e4c-2c5238f226f1'$case$),'sandbox_operator_bootstrap_admin_state_mismatch','Suspended admin membership fails closed');
select is(pg_temp.attempt($case$update pikas_private.platform_memberships set status='inactive' where person_id='82af93c4-730f-468c-9e4c-2c5238f226f1'$case$),'sandbox_operator_bootstrap_admin_state_mismatch','Inactive admin membership fails closed');
select is(pg_temp.attempt($case$set local session_replication_role=replica; update pikas_private.platform_roles set status='inactive' where role_code='platform_admin'; set local session_replication_role=origin$case$),'sandbox_operator_bootstrap_capabilities_mismatch','platform_admin must remain active');
select is(pg_temp.attempt($case$set local session_replication_role=replica; update pikas_private.platform_roles set status='inactive' where role_code='platform_sandbox_operator'; set local session_replication_role=origin$case$),'sandbox_operator_bootstrap_capabilities_mismatch','platform_sandbox_operator must remain active');
select is(pg_temp.attempt($case$insert into pikas_private.platform_role_capabilities(role_code,capability) values ('platform_admin','platform:sandbox:pov:enter')$case$),'sandbox_operator_bootstrap_capabilities_mismatch','Admin must not gain sandbox capability');
select is(pg_temp.attempt($case$set local session_replication_role=replica; delete from pikas_private.platform_role_capabilities where role_code='platform_admin' and capability='platform:audit:read'; set local session_replication_role=origin$case$),'sandbox_operator_bootstrap_capabilities_mismatch','Admin must retain all five existing capabilities');
select is(pg_temp.attempt($case$insert into pikas_private.platform_role_capabilities(role_code,capability) values ('platform_sandbox_operator','platform:audit:read')$case$),'sandbox_operator_bootstrap_capabilities_mismatch','Operator must have no extra capabilities');
select is(pg_temp.attempt($case$set local session_replication_role=replica; delete from pikas_private.platform_role_capabilities where role_code='platform_sandbox_operator'; set local session_replication_role=origin$case$),'sandbox_operator_bootstrap_capabilities_mismatch','Operator must have sandbox entry capability');
select is(pg_temp.attempt($case$insert into pikas_private.platform_memberships(person_id,role_code,status,revoked_at) values ('82af93c4-730f-468c-9e4c-2c5238f226f1','platform_sandbox_operator','active',null)$case$),'sandbox_operator_bootstrap_existing_state_mismatch','Unexplained active operator membership fails closed');
select is(pg_temp.attempt($case$insert into pikas_private.platform_memberships(person_id,role_code,status,revoked_at) values ('82af93c4-730f-468c-9e4c-2c5238f226f1','platform_sandbox_operator','suspended',null)$case$),'sandbox_operator_bootstrap_existing_state_mismatch','Unexplained suspended operator membership fails closed');
select is(pg_temp.attempt($case$insert into pikas_private.platform_memberships(person_id,role_code,status,revoked_at) values ('82af93c4-730f-468c-9e4c-2c5238f226f1','platform_sandbox_operator','inactive',now())$case$),'sandbox_operator_bootstrap_existing_state_mismatch','Unexplained inactive operator membership fails closed');
select is(pg_temp.attempt($case$insert into pikas_private.platform_audit_events(actor_kind,capability,action,target_person_id,outcome,reason_code,metadata) values ('owner_root_bootstrap','platform:sandbox:pov:enter','sandbox_operator_bootstrapped','82af93c4-730f-468c-9e4c-2c5238f226f1','succeeded','owner_root_bootstrap',jsonb_build_object('migration','202610090004_edwin_sandbox_operator_bootstrap'))$case$),'sandbox_operator_bootstrap_existing_state_mismatch','Audit without operator membership fails closed');
create function pg_temp.reject_audit() returns trigger language plpgsql as $$
begin raise exception 'test_audit_insert_failure'; end $$;
select is(pg_temp.attempt($case$create trigger test_reject_bootstrap_audit before insert on pikas_private.platform_audit_events for each row execute function pg_temp.reject_audit()$case$),'test_audit_insert_failure','Audit failure aborts the grant atomically');
select is(pg_temp.snapshot(),(select data from before_failures),'All rejected cases preserve every existing row');
create temp table before_grant as select pg_temp.snapshot() as data;
select lives_ok($$select pg_temp.run_bootstrap()$$,'Expected Edwin state grants the operator membership');
select is(pg_temp.snapshot()-array['pikas_private.platform_memberships','pikas_private.platform_audit_events'],
 (select data-array['pikas_private.platform_memberships','pikas_private.platform_audit_events'] from before_grant),
 'Grant leaves all identity, capability, tenant, cashier, persona, POV session and POS tables unchanged');
select is((select jsonb_agg(to_jsonb(m) order by to_jsonb(m)::text) from pikas_private.platform_memberships m where role_code<>'platform_sandbox_operator'),
 (select data->'pikas_private.platform_memberships' from before_grant),'Every pre-existing admin membership is byte-for-byte unchanged');
select is((select count(*) from pikas_private.platform_memberships where person_id='82af93c4-730f-468c-9e4c-2c5238f226f1' and role_code='platform_sandbox_operator'),1::bigint,'Exactly one Edwin operator membership exists');
select is((select count(*) from pikas_private.platform_memberships where person_id='82af93c4-730f-468c-9e4c-2c5238f226f1' and role_code='platform_sandbox_operator' and status='active' and granted_by_person_id is null and revoked_at is null),1::bigint,'Operator grant is active and owner managed');
select is((select array_agg(capability order by capability) from pikas_private.platform_role_capabilities where role_code='platform_admin'),
 array['platform:audit:read','platform:customer_admin:provision','platform:identity:link','platform:tenant:lifecycle:read','platform:tenant:provision']::text[],'Admin retains precisely its existing five capabilities');
select is((select array_agg(capability order by capability) from pikas_private.platform_role_capabilities where role_code='platform_sandbox_operator'),array['platform:sandbox:pov:enter']::text[],'Operator grants only sandbox POV entry');
select is((select count(*) from pikas_private.platform_audit_events where action='sandbox_operator_bootstrapped' and target_person_id='82af93c4-730f-468c-9e4c-2c5238f226f1'
 and actor_kind='owner_root_bootstrap' and actor_person_id is null and actor_auth_user_id is null
 and outcome='succeeded' and reason_code='owner_root_bootstrap' and capability='platform:sandbox:pov:enter'
 and metadata->>'migration'='202610090004_edwin_sandbox_operator_bootstrap'
 and metadata->>'role_code'='platform_sandbox_operator'
 and metadata->>'membership_id'=(select id::text from pikas_private.platform_memberships where person_id='82af93c4-730f-468c-9e4c-2c5238f226f1' and role_code='platform_sandbox_operator')),
 1::bigint,'Exactly one owner-bootstrap audit identifies the grant and membership');
select is((select count(*) from pikas_private.platform_audit_events),
 (select jsonb_array_length(data->'pikas_private.platform_audit_events')::bigint+1 from before_grant),'Grant adds exactly one audit event');
select is((select count(*) from public.cafeteria_memberships where person_id='82af93c4-730f-468c-9e4c-2c5238f226f1'),0::bigint,'Edwin gains no cashier membership');
select is((select count(*) from pikas_private.sandbox_pov_personas where person_id='82af93c4-730f-468c-9e4c-2c5238f226f1'),0::bigint,'Edwin is not registered as a persona');
select is((select count(*) from pikas_private.sandbox_pov_sessions),0::bigint,'Grant creates no POV session');
select set_config('request.jwt.claim.sub','ec08ad21-4020-4b0d-b041-ee4a1fe09471',true);
select ok(pikas_private.platform_has_capability('platform:sandbox:pov:enter'),'Edwin can resolve the new operator capability');
select is((select count(*) from pikas_private.platform_capabilities c where pikas_private.platform_has_capability(c.capability)),6::bigint,'Edwin resolves the five admin capabilities plus operator entry');
create temp table before_replay as select pg_temp.snapshot() as data;
select lives_ok($$select pg_temp.run_bootstrap()$$,'Replay accepts the original audited active grant');
select lives_ok($$select pg_temp.run_bootstrap()$$,'Repeated replay is safe');
select is(pg_temp.snapshot(),(select data from before_replay),'Replay adds no audit or membership and changes no row');
select is(pg_temp.attempt($case$update pikas_private.platform_memberships set status='suspended' where person_id='82af93c4-730f-468c-9e4c-2c5238f226f1' and role_code='platform_sandbox_operator'$case$),'sandbox_operator_bootstrap_existing_state_mismatch','Replay never restores a suspended operator');
select is(pg_temp.attempt($case$update pikas_private.platform_memberships set status='inactive' where person_id='82af93c4-730f-468c-9e4c-2c5238f226f1' and role_code='platform_sandbox_operator'$case$),'sandbox_operator_bootstrap_existing_state_mismatch','Replay never restores a revoked operator');
select is(pg_temp.attempt($case$set local session_replication_role=replica; delete from pikas_private.platform_audit_events where action='sandbox_operator_bootstrapped'; set local session_replication_role=origin$case$),'sandbox_operator_bootstrap_existing_state_mismatch','Replay requires original audit evidence');
select is(pg_temp.attempt($case$set local session_replication_role=replica; update pikas_private.platform_audit_events set metadata=metadata||jsonb_build_object('membership_id','00000000-0000-0000-0000-000000000000') where action='sandbox_operator_bootstrapped'; set local session_replication_role=origin$case$),'sandbox_operator_bootstrap_existing_state_mismatch','Replay rejects audit pointing to a different membership');
select is(pg_temp.attempt($case$update public.persons set status='inactive' where id='82af93c4-730f-468c-9e4c-2c5238f226f1'$case$),'sandbox_operator_bootstrap_person_state_mismatch','Replay rechecks active Person status');
select is(pg_temp.attempt($case$update pikas_private.platform_memberships set status='suspended' where person_id='82af93c4-730f-468c-9e4c-2c5238f226f1' and role_code='platform_admin'$case$),'sandbox_operator_bootstrap_admin_state_mismatch','Replay rechecks active admin authority');
select is(pg_temp.snapshot(),(select data from before_replay),'Rejected replays leave the original grant and all data unchanged');
select * from finish();
rollback;
