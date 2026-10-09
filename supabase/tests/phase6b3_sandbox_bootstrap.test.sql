-- Phase 6B.3 tests. Every executable DO block is a verbatim copy of the executable block in
-- migrations/202610090003_colegio_horizonte_sandbox_bootstrap.sql (pgTAP cannot include migration files).
begin;
create extension if not exists pgtap with schema extensions;
set search_path=public,extensions;
select no_plan();

create function pg_temp.reclassify(a uuid,k text) returns void language plpgsql as $$
begin
  alter table public.accounts disable trigger accounts_tenant_kind_immutable;
  update public.accounts set tenant_kind=k where id=a;
  alter table public.accounts enable trigger accounts_tenant_kind_immutable;
end $$;

create function pg_temp.application_snapshot() returns jsonb language plpgsql as $$
declare r record; rows_value jsonb; result_value jsonb := '{}'::jsonb;
begin
  for r in select schemaname,tablename from pg_tables
    where schemaname in ('public','pikas_private') order by schemaname,tablename loop
    execute format('select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),''[]''::jsonb) from %I.%I t',r.schemaname,r.tablename) into rows_value;
    result_value := result_value || jsonb_build_object(r.schemaname||'.'||r.tablename,rows_value);
  end loop;
  return result_value;
end $$;

-- Simulate the pre-seed reset in a subtransaction; retain observations, roll back fixture removal.
create function pg_temp.pristine_bootstrap() returns bigint[] language plpgsql as $test$
declare before_count bigint; after_count bigint;
begin
  begin
    -- Test-only fixture removal bypasses truncate guards inside this rolled-back subtransaction.
    -- Restore normal trigger execution before running the unmodified migration block.
    set local session_replication_role = replica;
    truncate public.accounts,public.persons,pikas_private.platform_memberships cascade;
    set local session_replication_role = origin;
    select (select count(*) from public.accounts)+(select count(*) from public.persons)
      +(select count(*) from pikas_private.platform_memberships) into before_count;
    execute $t$
do $bootstrap$
declare
  acc constant uuid := '03e71159-69e9-4387-9b3b-65799d49faf0';
  sch constant uuid := 'df8fcd98-6ece-4f87-b4e9-2f5f3ec8e488';
  loc constant uuid := 'cc7ca5f3-d27e-43ea-b3c9-8a6ef4e327d4';
  caf constant uuid := 'b9496342-5079-46ae-83b8-05c39bcbd7fe';
  original_src text;
  person_value uuid;
  membership_value uuid;
  persona_value uuid;
begin
  if not exists(select 1 from public.accounts where id=acc) then
    if not exists(select 1 from public.accounts) and not exists(select 1 from public.persons)
      and not exists(select 1 from pikas_private.platform_memberships) then
      raise notice 'Pristine database: nothing to bootstrap';
      return;
    end if;
    raise exception 'sandbox_bootstrap_account_missing';
  end if;

  -- 1-2. Exact hierarchy and state; any drift aborts the whole migration.
  if not exists(select 1 from public.accounts where id=acc and status='active' and tenant_kind='customer') then
    raise exception 'sandbox_bootstrap_account_state_mismatch';
  end if;
  if not exists(select 1 from public.schools where id=sch and account_id=acc and status='active')
    or not exists(select 1 from public.school_locations where id=loc and account_id=acc and school_id=sch and status='active')
    or not exists(select 1 from public.cafeterias where id=caf and account_id=acc and school_id=sch
                  and school_location_id=loc and status='active') then
    raise exception 'sandbox_bootstrap_hierarchy_mismatch';
  end if;
  if (select count(*) from public.accounts where tenant_kind='sandbox')<>0
    or exists(select 1 from pikas_private.sandbox_pov_personas where cafeteria_id=caf) then
    raise exception 'sandbox_bootstrap_unexpected_existing_sandbox_state';
  end if;
  if not pikas_private.scope_active(acc,sch,caf) then
    raise exception 'sandbox_bootstrap_scope_inactive';
  end if;

  -- 3. Controlled transition. The trigger stays enabled. A transaction-local signal plus the exact account and
  -- transition are required by the temporary guard; the strict guard is then restored and compared to the original.
  select p.prosrc into strict original_src from pg_proc p
    where p.oid='pikas_private.guard_account_tenant_kind()'::regprocedure;
  create or replace function pikas_private.guard_account_tenant_kind() returns trigger
  language plpgsql set search_path = '' as $fn$
  begin
    if new.tenant_kind is distinct from old.tenant_kind
      and not (coalesce(current_setting('pikas.bootstrap_horizonte_sandbox',true),'')='202610090003'
               and old.id='03e71159-69e9-4387-9b3b-65799d49faf0'::uuid
               and old.tenant_kind='customer' and new.tenant_kind='sandbox') then
      raise exception using errcode='23514',message='account_tenant_kind_is_immutable';
    end if;
    return new;
  end $fn$;

  perform set_config('pikas.bootstrap_horizonte_sandbox','202610090003',true);
  update public.accounts set tenant_kind='sandbox' where id=acc and tenant_kind='customer';
  if not found then raise exception 'sandbox_bootstrap_conversion_failed'; end if;
  perform set_config('pikas.bootstrap_horizonte_sandbox','',true);

  -- Permanent strict guard, identical to migration 202610090001.
  create or replace function pikas_private.guard_account_tenant_kind() returns trigger
  language plpgsql set search_path = '' as $strict$
begin
  if new.tenant_kind is distinct from old.tenant_kind then
    raise exception using errcode='23514',message='account_tenant_kind_is_immutable';
  end if;
  return new;
end $strict$;

  -- 4-6. Auth-less persona through the normal tables so every existing guard validates it.
  insert into public.persons(display_name,status,auth_user_id) values ('José Ramírez','active',null)
    returning id into person_value;
  insert into public.cafeteria_memberships(account_id,school_id,cafeteria_id,person_id,role_code,status)
    values (acc,sch,caf,person_value,'pos_cashier','active') returning id into membership_value;
  insert into pikas_private.sandbox_pov_personas(account_id,school_id,cafeteria_id,pov_code,person_id,
    cafeteria_membership_id,status)
    values (acc,sch,caf,'cashier',person_value,membership_value,'active') returning id into persona_value;

  -- 7. Explicit audit evidence (row-level audit triggers additionally record the account, person and membership).
  insert into public.audit_events(actor_person_id,authenticated_user_id,actor_role,actor_scope_kind,account_id,
    school_id,cafeteria_id,action,target_type,target_id,outcome,before_metadata,after_metadata)
  values
   (null,null,'database_maintenance','system',acc,sch,caf,'sandbox_tenant_classified','accounts',acc,'succeeded',
    jsonb_build_object('tenant_kind','customer'),
    jsonb_build_object('tenant_kind','sandbox','migration','202610090003_colegio_horizonte_sandbox_bootstrap')),
   (null,null,'database_maintenance','system',acc,sch,caf,'sandbox_persona_registered','sandbox_pov_personas',
    persona_value,'succeeded','{}'::jsonb,
    jsonb_build_object('pov_code','cashier','role_code','pos_cashier','migration','202610090003_colegio_horizonte_sandbox_bootstrap'));

  -- 8. Final assertions.
  if (select prosrc from pg_proc where oid='pikas_private.guard_account_tenant_kind()'::regprocedure) is distinct from original_src
    or coalesce(current_setting('pikas.bootstrap_horizonte_sandbox',true),'')<>'' then
    raise exception 'sandbox_bootstrap_guard_not_restored';
  end if;
  if not exists(select 1 from pg_trigger where tgrelid='public.accounts'::regclass
      and tgname='accounts_tenant_kind_immutable' and tgenabled='O') then
    raise exception 'sandbox_bootstrap_guard_trigger_not_enabled';
  end if;
  if (select count(*) from public.accounts where tenant_kind='sandbox')<>1
    or not exists(select 1 from public.accounts where id=acc and tenant_kind='sandbox') then
    raise exception 'sandbox_bootstrap_classification_mismatch';
  end if;
  if not exists(select 1 from public.persons where id=person_value and display_name='José Ramírez'
      and status='active' and auth_user_id is null)
    or (select count(*) from public.cafeteria_memberships where person_id=person_value)<>1
    or not exists(select 1 from public.cafeteria_memberships where id=membership_value and person_id=person_value
      and account_id=acc and school_id=sch and cafeteria_id=caf and role_code='pos_cashier' and status='active')
    or exists(select 1 from public.account_memberships where person_id=person_value)
    or exists(select 1 from public.school_memberships where person_id=person_value)
    or exists(select 1 from pikas_private.platform_memberships where person_id=person_value)
    or (select count(*) from pikas_private.sandbox_pov_personas where cafeteria_id=caf and status='active')<>1
    or not exists(select 1 from pikas_private.sandbox_pov_personas where id=persona_value and person_id=person_value
      and cafeteria_membership_id=membership_value and pov_code='cashier' and status='active')
    or exists(select 1 from pikas_private.sandbox_pov_sessions) then
    raise exception 'sandbox_bootstrap_persona_assertion_failed';
  end if;
end
$bootstrap$;
$t$;
    select (select count(*) from public.accounts)+(select count(*) from public.persons)
      +(select count(*) from pikas_private.platform_memberships) into after_count;
    raise exception using errcode='Z0001',message='rollback_pristine_fixture';
  exception when sqlstate 'Z0001' then null;
  end;
  return array[before_count,after_count];
end $test$;
create temp table pristine_result as select pg_temp.pristine_bootstrap() as counts;
select is((select counts[1] from pristine_result),0::bigint,'Pre-seed reset is genuinely pristine');
select is((select counts[2] from pristine_result),0::bigint,'Pristine bootstrap succeeds without creating identities or tenants');

-- Edwin-like platform_admin fixture whose authority must be unaffected.
insert into auth.users(id,aud,role,email,confirmed_at) values
 ('00000000-0000-0000-0000-000000002601','authenticated','authenticated','p6b3-admin@example.invalid',now());
insert into public.persons(id,auth_user_id,display_name,status) values
 ('00000000-0000-0000-0000-000000001601','00000000-0000-0000-0000-000000002601','Bootstrap admin','active');
insert into pikas_private.platform_memberships(person_id,role_code,status) values
 ('00000000-0000-0000-0000-000000001601','platform_admin','active');
create temp table before_admin as select person_id,role_code,status from pikas_private.platform_memberships;

-- Missing legacy account on an initialized DB must fail and leave every existing row untouched.
create temp table before_missing as select pg_temp.application_snapshot() as data;
select throws_ok($t$
do $bootstrap$
declare
  acc constant uuid := '03e71159-69e9-4387-9b3b-65799d49faf0';
  sch constant uuid := 'df8fcd98-6ece-4f87-b4e9-2f5f3ec8e488';
  loc constant uuid := 'cc7ca5f3-d27e-43ea-b3c9-8a6ef4e327d4';
  caf constant uuid := 'b9496342-5079-46ae-83b8-05c39bcbd7fe';
  original_src text;
  person_value uuid;
  membership_value uuid;
  persona_value uuid;
begin
  if not exists(select 1 from public.accounts where id=acc) then
    if not exists(select 1 from public.accounts) and not exists(select 1 from public.persons)
      and not exists(select 1 from pikas_private.platform_memberships) then
      raise notice 'Pristine database: nothing to bootstrap';
      return;
    end if;
    raise exception 'sandbox_bootstrap_account_missing';
  end if;

  -- 1-2. Exact hierarchy and state; any drift aborts the whole migration.
  if not exists(select 1 from public.accounts where id=acc and status='active' and tenant_kind='customer') then
    raise exception 'sandbox_bootstrap_account_state_mismatch';
  end if;
  if not exists(select 1 from public.schools where id=sch and account_id=acc and status='active')
    or not exists(select 1 from public.school_locations where id=loc and account_id=acc and school_id=sch and status='active')
    or not exists(select 1 from public.cafeterias where id=caf and account_id=acc and school_id=sch
                  and school_location_id=loc and status='active') then
    raise exception 'sandbox_bootstrap_hierarchy_mismatch';
  end if;
  if (select count(*) from public.accounts where tenant_kind='sandbox')<>0
    or exists(select 1 from pikas_private.sandbox_pov_personas where cafeteria_id=caf) then
    raise exception 'sandbox_bootstrap_unexpected_existing_sandbox_state';
  end if;
  if not pikas_private.scope_active(acc,sch,caf) then
    raise exception 'sandbox_bootstrap_scope_inactive';
  end if;

  -- 3. Controlled transition. The trigger stays enabled. A transaction-local signal plus the exact account and
  -- transition are required by the temporary guard; the strict guard is then restored and compared to the original.
  select p.prosrc into strict original_src from pg_proc p
    where p.oid='pikas_private.guard_account_tenant_kind()'::regprocedure;
  create or replace function pikas_private.guard_account_tenant_kind() returns trigger
  language plpgsql set search_path = '' as $fn$
  begin
    if new.tenant_kind is distinct from old.tenant_kind
      and not (coalesce(current_setting('pikas.bootstrap_horizonte_sandbox',true),'')='202610090003'
               and old.id='03e71159-69e9-4387-9b3b-65799d49faf0'::uuid
               and old.tenant_kind='customer' and new.tenant_kind='sandbox') then
      raise exception using errcode='23514',message='account_tenant_kind_is_immutable';
    end if;
    return new;
  end $fn$;

  perform set_config('pikas.bootstrap_horizonte_sandbox','202610090003',true);
  update public.accounts set tenant_kind='sandbox' where id=acc and tenant_kind='customer';
  if not found then raise exception 'sandbox_bootstrap_conversion_failed'; end if;
  perform set_config('pikas.bootstrap_horizonte_sandbox','',true);

  -- Permanent strict guard, identical to migration 202610090001.
  create or replace function pikas_private.guard_account_tenant_kind() returns trigger
  language plpgsql set search_path = '' as $strict$
begin
  if new.tenant_kind is distinct from old.tenant_kind then
    raise exception using errcode='23514',message='account_tenant_kind_is_immutable';
  end if;
  return new;
end $strict$;

  -- 4-6. Auth-less persona through the normal tables so every existing guard validates it.
  insert into public.persons(display_name,status,auth_user_id) values ('José Ramírez','active',null)
    returning id into person_value;
  insert into public.cafeteria_memberships(account_id,school_id,cafeteria_id,person_id,role_code,status)
    values (acc,sch,caf,person_value,'pos_cashier','active') returning id into membership_value;
  insert into pikas_private.sandbox_pov_personas(account_id,school_id,cafeteria_id,pov_code,person_id,
    cafeteria_membership_id,status)
    values (acc,sch,caf,'cashier',person_value,membership_value,'active') returning id into persona_value;

  -- 7. Explicit audit evidence (row-level audit triggers additionally record the account, person and membership).
  insert into public.audit_events(actor_person_id,authenticated_user_id,actor_role,actor_scope_kind,account_id,
    school_id,cafeteria_id,action,target_type,target_id,outcome,before_metadata,after_metadata)
  values
   (null,null,'database_maintenance','system',acc,sch,caf,'sandbox_tenant_classified','accounts',acc,'succeeded',
    jsonb_build_object('tenant_kind','customer'),
    jsonb_build_object('tenant_kind','sandbox','migration','202610090003_colegio_horizonte_sandbox_bootstrap')),
   (null,null,'database_maintenance','system',acc,sch,caf,'sandbox_persona_registered','sandbox_pov_personas',
    persona_value,'succeeded','{}'::jsonb,
    jsonb_build_object('pov_code','cashier','role_code','pos_cashier','migration','202610090003_colegio_horizonte_sandbox_bootstrap'));

  -- 8. Final assertions.
  if (select prosrc from pg_proc where oid='pikas_private.guard_account_tenant_kind()'::regprocedure) is distinct from original_src
    or coalesce(current_setting('pikas.bootstrap_horizonte_sandbox',true),'')<>'' then
    raise exception 'sandbox_bootstrap_guard_not_restored';
  end if;
  if not exists(select 1 from pg_trigger where tgrelid='public.accounts'::regclass
      and tgname='accounts_tenant_kind_immutable' and tgenabled='O') then
    raise exception 'sandbox_bootstrap_guard_trigger_not_enabled';
  end if;
  if (select count(*) from public.accounts where tenant_kind='sandbox')<>1
    or not exists(select 1 from public.accounts where id=acc and tenant_kind='sandbox') then
    raise exception 'sandbox_bootstrap_classification_mismatch';
  end if;
  if not exists(select 1 from public.persons where id=person_value and display_name='José Ramírez'
      and status='active' and auth_user_id is null)
    or (select count(*) from public.cafeteria_memberships where person_id=person_value)<>1
    or not exists(select 1 from public.cafeteria_memberships where id=membership_value and person_id=person_value
      and account_id=acc and school_id=sch and cafeteria_id=caf and role_code='pos_cashier' and status='active')
    or exists(select 1 from public.account_memberships where person_id=person_value)
    or exists(select 1 from public.school_memberships where person_id=person_value)
    or exists(select 1 from pikas_private.platform_memberships where person_id=person_value)
    or (select count(*) from pikas_private.sandbox_pov_personas where cafeteria_id=caf and status='active')<>1
    or not exists(select 1 from pikas_private.sandbox_pov_personas where id=persona_value and person_id=person_value
      and cafeteria_membership_id=membership_value and pov_code='cashier' and status='active')
    or exists(select 1 from pikas_private.sandbox_pov_sessions) then
    raise exception 'sandbox_bootstrap_persona_assertion_failed';
  end if;
end
$bootstrap$;
$t$,'P0001','sandbox_bootstrap_account_missing','Initialized DB missing Horizonte fails closed');
select is(pg_temp.application_snapshot(),(select data from before_missing),'Missing-account failure preserves all existing application data');
select is((select count(*) from public.accounts where tenant_kind='sandbox'),0::bigint,'Missing-account failure classifies nothing');
select is((select count(*) from public.persons where display_name='José Ramírez'),0::bigint,'Missing-account failure creates no persona');

-- Fixture: exact legacy hierarchy plus an unrelated customer tenant.
insert into public.accounts(id,code,name) values ('03e71159-69e9-4387-9b3b-65799d49faf0','HORIZONTE','Colegio Horizonte'),
 ('00000000-0000-0000-0000-000000006001','P6B3-OTHER','Other customer');
insert into public.schools(id,account_id,code,name) values ('df8fcd98-6ece-4f87-b4e9-2f5f3ec8e488','03e71159-69e9-4387-9b3b-65799d49faf0','H1','Colegio Horizonte'),
 ('00000000-0000-0000-0000-000000006011','00000000-0000-0000-0000-000000006001','O1','Other school');
insert into public.school_locations(id,account_id,school_id,code,name) values ('cc7ca5f3-d27e-43ea-b3c9-8a6ef4e327d4','03e71159-69e9-4387-9b3b-65799d49faf0','df8fcd98-6ece-4f87-b4e9-2f5f3ec8e488','MAIN','Principal'),
 ('00000000-0000-0000-0000-000000006021','00000000-0000-0000-0000-000000006001','00000000-0000-0000-0000-000000006011','MAIN','Principal');
insert into public.cafeterias(id,account_id,school_id,school_location_id,code,name) values ('b9496342-5079-46ae-83b8-05c39bcbd7fe','03e71159-69e9-4387-9b3b-65799d49faf0','df8fcd98-6ece-4f87-b4e9-2f5f3ec8e488','cc7ca5f3-d27e-43ea-b3c9-8a6ef4e327d4','CAF','Cafetería Escolar'),
 ('00000000-0000-0000-0000-000000006031','00000000-0000-0000-0000-000000006001','00000000-0000-0000-0000-000000006011','00000000-0000-0000-0000-000000006021','CAF','Other cafeteria');

-- Defensive assertions protect against wrong state.
update public.accounts set status='suspended' where id='03e71159-69e9-4387-9b3b-65799d49faf0';
select throws_ok($t$
do $bootstrap$
declare
  acc constant uuid := '03e71159-69e9-4387-9b3b-65799d49faf0';
  sch constant uuid := 'df8fcd98-6ece-4f87-b4e9-2f5f3ec8e488';
  loc constant uuid := 'cc7ca5f3-d27e-43ea-b3c9-8a6ef4e327d4';
  caf constant uuid := 'b9496342-5079-46ae-83b8-05c39bcbd7fe';
  original_src text;
  person_value uuid;
  membership_value uuid;
  persona_value uuid;
begin
  if not exists(select 1 from public.accounts where id=acc) then
    if not exists(select 1 from public.accounts) and not exists(select 1 from public.persons)
      and not exists(select 1 from pikas_private.platform_memberships) then
      raise notice 'Pristine database: nothing to bootstrap';
      return;
    end if;
    raise exception 'sandbox_bootstrap_account_missing';
  end if;

  -- 1-2. Exact hierarchy and state; any drift aborts the whole migration.
  if not exists(select 1 from public.accounts where id=acc and status='active' and tenant_kind='customer') then
    raise exception 'sandbox_bootstrap_account_state_mismatch';
  end if;
  if not exists(select 1 from public.schools where id=sch and account_id=acc and status='active')
    or not exists(select 1 from public.school_locations where id=loc and account_id=acc and school_id=sch and status='active')
    or not exists(select 1 from public.cafeterias where id=caf and account_id=acc and school_id=sch
                  and school_location_id=loc and status='active') then
    raise exception 'sandbox_bootstrap_hierarchy_mismatch';
  end if;
  if (select count(*) from public.accounts where tenant_kind='sandbox')<>0
    or exists(select 1 from pikas_private.sandbox_pov_personas where cafeteria_id=caf) then
    raise exception 'sandbox_bootstrap_unexpected_existing_sandbox_state';
  end if;
  if not pikas_private.scope_active(acc,sch,caf) then
    raise exception 'sandbox_bootstrap_scope_inactive';
  end if;

  -- 3. Controlled transition. The trigger stays enabled. A transaction-local signal plus the exact account and
  -- transition are required by the temporary guard; the strict guard is then restored and compared to the original.
  select p.prosrc into strict original_src from pg_proc p
    where p.oid='pikas_private.guard_account_tenant_kind()'::regprocedure;
  create or replace function pikas_private.guard_account_tenant_kind() returns trigger
  language plpgsql set search_path = '' as $fn$
  begin
    if new.tenant_kind is distinct from old.tenant_kind
      and not (coalesce(current_setting('pikas.bootstrap_horizonte_sandbox',true),'')='202610090003'
               and old.id='03e71159-69e9-4387-9b3b-65799d49faf0'::uuid
               and old.tenant_kind='customer' and new.tenant_kind='sandbox') then
      raise exception using errcode='23514',message='account_tenant_kind_is_immutable';
    end if;
    return new;
  end $fn$;

  perform set_config('pikas.bootstrap_horizonte_sandbox','202610090003',true);
  update public.accounts set tenant_kind='sandbox' where id=acc and tenant_kind='customer';
  if not found then raise exception 'sandbox_bootstrap_conversion_failed'; end if;
  perform set_config('pikas.bootstrap_horizonte_sandbox','',true);

  -- Permanent strict guard, identical to migration 202610090001.
  create or replace function pikas_private.guard_account_tenant_kind() returns trigger
  language plpgsql set search_path = '' as $strict$
begin
  if new.tenant_kind is distinct from old.tenant_kind then
    raise exception using errcode='23514',message='account_tenant_kind_is_immutable';
  end if;
  return new;
end $strict$;

  -- 4-6. Auth-less persona through the normal tables so every existing guard validates it.
  insert into public.persons(display_name,status,auth_user_id) values ('José Ramírez','active',null)
    returning id into person_value;
  insert into public.cafeteria_memberships(account_id,school_id,cafeteria_id,person_id,role_code,status)
    values (acc,sch,caf,person_value,'pos_cashier','active') returning id into membership_value;
  insert into pikas_private.sandbox_pov_personas(account_id,school_id,cafeteria_id,pov_code,person_id,
    cafeteria_membership_id,status)
    values (acc,sch,caf,'cashier',person_value,membership_value,'active') returning id into persona_value;

  -- 7. Explicit audit evidence (row-level audit triggers additionally record the account, person and membership).
  insert into public.audit_events(actor_person_id,authenticated_user_id,actor_role,actor_scope_kind,account_id,
    school_id,cafeteria_id,action,target_type,target_id,outcome,before_metadata,after_metadata)
  values
   (null,null,'database_maintenance','system',acc,sch,caf,'sandbox_tenant_classified','accounts',acc,'succeeded',
    jsonb_build_object('tenant_kind','customer'),
    jsonb_build_object('tenant_kind','sandbox','migration','202610090003_colegio_horizonte_sandbox_bootstrap')),
   (null,null,'database_maintenance','system',acc,sch,caf,'sandbox_persona_registered','sandbox_pov_personas',
    persona_value,'succeeded','{}'::jsonb,
    jsonb_build_object('pov_code','cashier','role_code','pos_cashier','migration','202610090003_colegio_horizonte_sandbox_bootstrap'));

  -- 8. Final assertions.
  if (select prosrc from pg_proc where oid='pikas_private.guard_account_tenant_kind()'::regprocedure) is distinct from original_src
    or coalesce(current_setting('pikas.bootstrap_horizonte_sandbox',true),'')<>'' then
    raise exception 'sandbox_bootstrap_guard_not_restored';
  end if;
  if not exists(select 1 from pg_trigger where tgrelid='public.accounts'::regclass
      and tgname='accounts_tenant_kind_immutable' and tgenabled='O') then
    raise exception 'sandbox_bootstrap_guard_trigger_not_enabled';
  end if;
  if (select count(*) from public.accounts where tenant_kind='sandbox')<>1
    or not exists(select 1 from public.accounts where id=acc and tenant_kind='sandbox') then
    raise exception 'sandbox_bootstrap_classification_mismatch';
  end if;
  if not exists(select 1 from public.persons where id=person_value and display_name='José Ramírez'
      and status='active' and auth_user_id is null)
    or (select count(*) from public.cafeteria_memberships where person_id=person_value)<>1
    or not exists(select 1 from public.cafeteria_memberships where id=membership_value and person_id=person_value
      and account_id=acc and school_id=sch and cafeteria_id=caf and role_code='pos_cashier' and status='active')
    or exists(select 1 from public.account_memberships where person_id=person_value)
    or exists(select 1 from public.school_memberships where person_id=person_value)
    or exists(select 1 from pikas_private.platform_memberships where person_id=person_value)
    or (select count(*) from pikas_private.sandbox_pov_personas where cafeteria_id=caf and status='active')<>1
    or not exists(select 1 from pikas_private.sandbox_pov_personas where id=persona_value and person_id=person_value
      and cafeteria_membership_id=membership_value and pov_code='cashier' and status='active')
    or exists(select 1 from pikas_private.sandbox_pov_sessions) then
    raise exception 'sandbox_bootstrap_persona_assertion_failed';
  end if;
end
$bootstrap$;
$t$,'P0001','sandbox_bootstrap_account_state_mismatch','Inactive account aborts');
update public.accounts set status='active' where id='03e71159-69e9-4387-9b3b-65799d49faf0';
update public.school_locations set status='inactive' where id='cc7ca5f3-d27e-43ea-b3c9-8a6ef4e327d4';
select throws_ok($t$
do $bootstrap$
declare
  acc constant uuid := '03e71159-69e9-4387-9b3b-65799d49faf0';
  sch constant uuid := 'df8fcd98-6ece-4f87-b4e9-2f5f3ec8e488';
  loc constant uuid := 'cc7ca5f3-d27e-43ea-b3c9-8a6ef4e327d4';
  caf constant uuid := 'b9496342-5079-46ae-83b8-05c39bcbd7fe';
  original_src text;
  person_value uuid;
  membership_value uuid;
  persona_value uuid;
begin
  if not exists(select 1 from public.accounts where id=acc) then
    if not exists(select 1 from public.accounts) and not exists(select 1 from public.persons)
      and not exists(select 1 from pikas_private.platform_memberships) then
      raise notice 'Pristine database: nothing to bootstrap';
      return;
    end if;
    raise exception 'sandbox_bootstrap_account_missing';
  end if;

  -- 1-2. Exact hierarchy and state; any drift aborts the whole migration.
  if not exists(select 1 from public.accounts where id=acc and status='active' and tenant_kind='customer') then
    raise exception 'sandbox_bootstrap_account_state_mismatch';
  end if;
  if not exists(select 1 from public.schools where id=sch and account_id=acc and status='active')
    or not exists(select 1 from public.school_locations where id=loc and account_id=acc and school_id=sch and status='active')
    or not exists(select 1 from public.cafeterias where id=caf and account_id=acc and school_id=sch
                  and school_location_id=loc and status='active') then
    raise exception 'sandbox_bootstrap_hierarchy_mismatch';
  end if;
  if (select count(*) from public.accounts where tenant_kind='sandbox')<>0
    or exists(select 1 from pikas_private.sandbox_pov_personas where cafeteria_id=caf) then
    raise exception 'sandbox_bootstrap_unexpected_existing_sandbox_state';
  end if;
  if not pikas_private.scope_active(acc,sch,caf) then
    raise exception 'sandbox_bootstrap_scope_inactive';
  end if;

  -- 3. Controlled transition. The trigger stays enabled. A transaction-local signal plus the exact account and
  -- transition are required by the temporary guard; the strict guard is then restored and compared to the original.
  select p.prosrc into strict original_src from pg_proc p
    where p.oid='pikas_private.guard_account_tenant_kind()'::regprocedure;
  create or replace function pikas_private.guard_account_tenant_kind() returns trigger
  language plpgsql set search_path = '' as $fn$
  begin
    if new.tenant_kind is distinct from old.tenant_kind
      and not (coalesce(current_setting('pikas.bootstrap_horizonte_sandbox',true),'')='202610090003'
               and old.id='03e71159-69e9-4387-9b3b-65799d49faf0'::uuid
               and old.tenant_kind='customer' and new.tenant_kind='sandbox') then
      raise exception using errcode='23514',message='account_tenant_kind_is_immutable';
    end if;
    return new;
  end $fn$;

  perform set_config('pikas.bootstrap_horizonte_sandbox','202610090003',true);
  update public.accounts set tenant_kind='sandbox' where id=acc and tenant_kind='customer';
  if not found then raise exception 'sandbox_bootstrap_conversion_failed'; end if;
  perform set_config('pikas.bootstrap_horizonte_sandbox','',true);

  -- Permanent strict guard, identical to migration 202610090001.
  create or replace function pikas_private.guard_account_tenant_kind() returns trigger
  language plpgsql set search_path = '' as $strict$
begin
  if new.tenant_kind is distinct from old.tenant_kind then
    raise exception using errcode='23514',message='account_tenant_kind_is_immutable';
  end if;
  return new;
end $strict$;

  -- 4-6. Auth-less persona through the normal tables so every existing guard validates it.
  insert into public.persons(display_name,status,auth_user_id) values ('José Ramírez','active',null)
    returning id into person_value;
  insert into public.cafeteria_memberships(account_id,school_id,cafeteria_id,person_id,role_code,status)
    values (acc,sch,caf,person_value,'pos_cashier','active') returning id into membership_value;
  insert into pikas_private.sandbox_pov_personas(account_id,school_id,cafeteria_id,pov_code,person_id,
    cafeteria_membership_id,status)
    values (acc,sch,caf,'cashier',person_value,membership_value,'active') returning id into persona_value;

  -- 7. Explicit audit evidence (row-level audit triggers additionally record the account, person and membership).
  insert into public.audit_events(actor_person_id,authenticated_user_id,actor_role,actor_scope_kind,account_id,
    school_id,cafeteria_id,action,target_type,target_id,outcome,before_metadata,after_metadata)
  values
   (null,null,'database_maintenance','system',acc,sch,caf,'sandbox_tenant_classified','accounts',acc,'succeeded',
    jsonb_build_object('tenant_kind','customer'),
    jsonb_build_object('tenant_kind','sandbox','migration','202610090003_colegio_horizonte_sandbox_bootstrap')),
   (null,null,'database_maintenance','system',acc,sch,caf,'sandbox_persona_registered','sandbox_pov_personas',
    persona_value,'succeeded','{}'::jsonb,
    jsonb_build_object('pov_code','cashier','role_code','pos_cashier','migration','202610090003_colegio_horizonte_sandbox_bootstrap'));

  -- 8. Final assertions.
  if (select prosrc from pg_proc where oid='pikas_private.guard_account_tenant_kind()'::regprocedure) is distinct from original_src
    or coalesce(current_setting('pikas.bootstrap_horizonte_sandbox',true),'')<>'' then
    raise exception 'sandbox_bootstrap_guard_not_restored';
  end if;
  if not exists(select 1 from pg_trigger where tgrelid='public.accounts'::regclass
      and tgname='accounts_tenant_kind_immutable' and tgenabled='O') then
    raise exception 'sandbox_bootstrap_guard_trigger_not_enabled';
  end if;
  if (select count(*) from public.accounts where tenant_kind='sandbox')<>1
    or not exists(select 1 from public.accounts where id=acc and tenant_kind='sandbox') then
    raise exception 'sandbox_bootstrap_classification_mismatch';
  end if;
  if not exists(select 1 from public.persons where id=person_value and display_name='José Ramírez'
      and status='active' and auth_user_id is null)
    or (select count(*) from public.cafeteria_memberships where person_id=person_value)<>1
    or not exists(select 1 from public.cafeteria_memberships where id=membership_value and person_id=person_value
      and account_id=acc and school_id=sch and cafeteria_id=caf and role_code='pos_cashier' and status='active')
    or exists(select 1 from public.account_memberships where person_id=person_value)
    or exists(select 1 from public.school_memberships where person_id=person_value)
    or exists(select 1 from pikas_private.platform_memberships where person_id=person_value)
    or (select count(*) from pikas_private.sandbox_pov_personas where cafeteria_id=caf and status='active')<>1
    or not exists(select 1 from pikas_private.sandbox_pov_personas where id=persona_value and person_id=person_value
      and cafeteria_membership_id=membership_value and pov_code='cashier' and status='active')
    or exists(select 1 from pikas_private.sandbox_pov_sessions) then
    raise exception 'sandbox_bootstrap_persona_assertion_failed';
  end if;
end
$bootstrap$;
$t$,'P0001','sandbox_bootstrap_hierarchy_mismatch','Inactive hierarchy aborts');
update public.school_locations set status='active' where id='cc7ca5f3-d27e-43ea-b3c9-8a6ef4e327d4';
-- A valid but unexpected campus under the same school must also abort.
insert into public.school_locations(id,account_id,school_id,code,name) values
 ('00000000-0000-0000-0000-000000006022','03e71159-69e9-4387-9b3b-65799d49faf0','df8fcd98-6ece-4f87-b4e9-2f5f3ec8e488','WRONG','Unexpected campus');
-- Test-only scope drift setup; all guards run normally during the bootstrap.
set local session_replication_role = replica;
update public.cafeterias set school_location_id='00000000-0000-0000-0000-000000006022' where id='b9496342-5079-46ae-83b8-05c39bcbd7fe';
set local session_replication_role = origin;
select throws_ok($t$
do $bootstrap$
declare
  acc constant uuid := '03e71159-69e9-4387-9b3b-65799d49faf0';
  sch constant uuid := 'df8fcd98-6ece-4f87-b4e9-2f5f3ec8e488';
  loc constant uuid := 'cc7ca5f3-d27e-43ea-b3c9-8a6ef4e327d4';
  caf constant uuid := 'b9496342-5079-46ae-83b8-05c39bcbd7fe';
  original_src text;
  person_value uuid;
  membership_value uuid;
  persona_value uuid;
begin
  if not exists(select 1 from public.accounts where id=acc) then
    if not exists(select 1 from public.accounts) and not exists(select 1 from public.persons)
      and not exists(select 1 from pikas_private.platform_memberships) then
      raise notice 'Pristine database: nothing to bootstrap';
      return;
    end if;
    raise exception 'sandbox_bootstrap_account_missing';
  end if;

  -- 1-2. Exact hierarchy and state; any drift aborts the whole migration.
  if not exists(select 1 from public.accounts where id=acc and status='active' and tenant_kind='customer') then
    raise exception 'sandbox_bootstrap_account_state_mismatch';
  end if;
  if not exists(select 1 from public.schools where id=sch and account_id=acc and status='active')
    or not exists(select 1 from public.school_locations where id=loc and account_id=acc and school_id=sch and status='active')
    or not exists(select 1 from public.cafeterias where id=caf and account_id=acc and school_id=sch
                  and school_location_id=loc and status='active') then
    raise exception 'sandbox_bootstrap_hierarchy_mismatch';
  end if;
  if (select count(*) from public.accounts where tenant_kind='sandbox')<>0
    or exists(select 1 from pikas_private.sandbox_pov_personas where cafeteria_id=caf) then
    raise exception 'sandbox_bootstrap_unexpected_existing_sandbox_state';
  end if;
  if not pikas_private.scope_active(acc,sch,caf) then
    raise exception 'sandbox_bootstrap_scope_inactive';
  end if;

  -- 3. Controlled transition. The trigger stays enabled. A transaction-local signal plus the exact account and
  -- transition are required by the temporary guard; the strict guard is then restored and compared to the original.
  select p.prosrc into strict original_src from pg_proc p
    where p.oid='pikas_private.guard_account_tenant_kind()'::regprocedure;
  create or replace function pikas_private.guard_account_tenant_kind() returns trigger
  language plpgsql set search_path = '' as $fn$
  begin
    if new.tenant_kind is distinct from old.tenant_kind
      and not (coalesce(current_setting('pikas.bootstrap_horizonte_sandbox',true),'')='202610090003'
               and old.id='03e71159-69e9-4387-9b3b-65799d49faf0'::uuid
               and old.tenant_kind='customer' and new.tenant_kind='sandbox') then
      raise exception using errcode='23514',message='account_tenant_kind_is_immutable';
    end if;
    return new;
  end $fn$;

  perform set_config('pikas.bootstrap_horizonte_sandbox','202610090003',true);
  update public.accounts set tenant_kind='sandbox' where id=acc and tenant_kind='customer';
  if not found then raise exception 'sandbox_bootstrap_conversion_failed'; end if;
  perform set_config('pikas.bootstrap_horizonte_sandbox','',true);

  -- Permanent strict guard, identical to migration 202610090001.
  create or replace function pikas_private.guard_account_tenant_kind() returns trigger
  language plpgsql set search_path = '' as $strict$
begin
  if new.tenant_kind is distinct from old.tenant_kind then
    raise exception using errcode='23514',message='account_tenant_kind_is_immutable';
  end if;
  return new;
end $strict$;

  -- 4-6. Auth-less persona through the normal tables so every existing guard validates it.
  insert into public.persons(display_name,status,auth_user_id) values ('José Ramírez','active',null)
    returning id into person_value;
  insert into public.cafeteria_memberships(account_id,school_id,cafeteria_id,person_id,role_code,status)
    values (acc,sch,caf,person_value,'pos_cashier','active') returning id into membership_value;
  insert into pikas_private.sandbox_pov_personas(account_id,school_id,cafeteria_id,pov_code,person_id,
    cafeteria_membership_id,status)
    values (acc,sch,caf,'cashier',person_value,membership_value,'active') returning id into persona_value;

  -- 7. Explicit audit evidence (row-level audit triggers additionally record the account, person and membership).
  insert into public.audit_events(actor_person_id,authenticated_user_id,actor_role,actor_scope_kind,account_id,
    school_id,cafeteria_id,action,target_type,target_id,outcome,before_metadata,after_metadata)
  values
   (null,null,'database_maintenance','system',acc,sch,caf,'sandbox_tenant_classified','accounts',acc,'succeeded',
    jsonb_build_object('tenant_kind','customer'),
    jsonb_build_object('tenant_kind','sandbox','migration','202610090003_colegio_horizonte_sandbox_bootstrap')),
   (null,null,'database_maintenance','system',acc,sch,caf,'sandbox_persona_registered','sandbox_pov_personas',
    persona_value,'succeeded','{}'::jsonb,
    jsonb_build_object('pov_code','cashier','role_code','pos_cashier','migration','202610090003_colegio_horizonte_sandbox_bootstrap'));

  -- 8. Final assertions.
  if (select prosrc from pg_proc where oid='pikas_private.guard_account_tenant_kind()'::regprocedure) is distinct from original_src
    or coalesce(current_setting('pikas.bootstrap_horizonte_sandbox',true),'')<>'' then
    raise exception 'sandbox_bootstrap_guard_not_restored';
  end if;
  if not exists(select 1 from pg_trigger where tgrelid='public.accounts'::regclass
      and tgname='accounts_tenant_kind_immutable' and tgenabled='O') then
    raise exception 'sandbox_bootstrap_guard_trigger_not_enabled';
  end if;
  if (select count(*) from public.accounts where tenant_kind='sandbox')<>1
    or not exists(select 1 from public.accounts where id=acc and tenant_kind='sandbox') then
    raise exception 'sandbox_bootstrap_classification_mismatch';
  end if;
  if not exists(select 1 from public.persons where id=person_value and display_name='José Ramírez'
      and status='active' and auth_user_id is null)
    or (select count(*) from public.cafeteria_memberships where person_id=person_value)<>1
    or not exists(select 1 from public.cafeteria_memberships where id=membership_value and person_id=person_value
      and account_id=acc and school_id=sch and cafeteria_id=caf and role_code='pos_cashier' and status='active')
    or exists(select 1 from public.account_memberships where person_id=person_value)
    or exists(select 1 from public.school_memberships where person_id=person_value)
    or exists(select 1 from pikas_private.platform_memberships where person_id=person_value)
    or (select count(*) from pikas_private.sandbox_pov_personas where cafeteria_id=caf and status='active')<>1
    or not exists(select 1 from pikas_private.sandbox_pov_personas where id=persona_value and person_id=person_value
      and cafeteria_membership_id=membership_value and pov_code='cashier' and status='active')
    or exists(select 1 from pikas_private.sandbox_pov_sessions) then
    raise exception 'sandbox_bootstrap_persona_assertion_failed';
  end if;
end
$bootstrap$;
$t$,'P0001','sandbox_bootstrap_hierarchy_mismatch','Wrong active campus aborts');
-- Test-only scope drift setup; all guards run normally during the bootstrap.
set local session_replication_role = replica;
update public.cafeterias set school_location_id='cc7ca5f3-d27e-43ea-b3c9-8a6ef4e327d4' where id='b9496342-5079-46ae-83b8-05c39bcbd7fe';
set local session_replication_role = origin;
select pg_temp.reclassify('00000000-0000-0000-0000-000000006001','sandbox');
select throws_ok($t$
do $bootstrap$
declare
  acc constant uuid := '03e71159-69e9-4387-9b3b-65799d49faf0';
  sch constant uuid := 'df8fcd98-6ece-4f87-b4e9-2f5f3ec8e488';
  loc constant uuid := 'cc7ca5f3-d27e-43ea-b3c9-8a6ef4e327d4';
  caf constant uuid := 'b9496342-5079-46ae-83b8-05c39bcbd7fe';
  original_src text;
  person_value uuid;
  membership_value uuid;
  persona_value uuid;
begin
  if not exists(select 1 from public.accounts where id=acc) then
    if not exists(select 1 from public.accounts) and not exists(select 1 from public.persons)
      and not exists(select 1 from pikas_private.platform_memberships) then
      raise notice 'Pristine database: nothing to bootstrap';
      return;
    end if;
    raise exception 'sandbox_bootstrap_account_missing';
  end if;

  -- 1-2. Exact hierarchy and state; any drift aborts the whole migration.
  if not exists(select 1 from public.accounts where id=acc and status='active' and tenant_kind='customer') then
    raise exception 'sandbox_bootstrap_account_state_mismatch';
  end if;
  if not exists(select 1 from public.schools where id=sch and account_id=acc and status='active')
    or not exists(select 1 from public.school_locations where id=loc and account_id=acc and school_id=sch and status='active')
    or not exists(select 1 from public.cafeterias where id=caf and account_id=acc and school_id=sch
                  and school_location_id=loc and status='active') then
    raise exception 'sandbox_bootstrap_hierarchy_mismatch';
  end if;
  if (select count(*) from public.accounts where tenant_kind='sandbox')<>0
    or exists(select 1 from pikas_private.sandbox_pov_personas where cafeteria_id=caf) then
    raise exception 'sandbox_bootstrap_unexpected_existing_sandbox_state';
  end if;
  if not pikas_private.scope_active(acc,sch,caf) then
    raise exception 'sandbox_bootstrap_scope_inactive';
  end if;

  -- 3. Controlled transition. The trigger stays enabled. A transaction-local signal plus the exact account and
  -- transition are required by the temporary guard; the strict guard is then restored and compared to the original.
  select p.prosrc into strict original_src from pg_proc p
    where p.oid='pikas_private.guard_account_tenant_kind()'::regprocedure;
  create or replace function pikas_private.guard_account_tenant_kind() returns trigger
  language plpgsql set search_path = '' as $fn$
  begin
    if new.tenant_kind is distinct from old.tenant_kind
      and not (coalesce(current_setting('pikas.bootstrap_horizonte_sandbox',true),'')='202610090003'
               and old.id='03e71159-69e9-4387-9b3b-65799d49faf0'::uuid
               and old.tenant_kind='customer' and new.tenant_kind='sandbox') then
      raise exception using errcode='23514',message='account_tenant_kind_is_immutable';
    end if;
    return new;
  end $fn$;

  perform set_config('pikas.bootstrap_horizonte_sandbox','202610090003',true);
  update public.accounts set tenant_kind='sandbox' where id=acc and tenant_kind='customer';
  if not found then raise exception 'sandbox_bootstrap_conversion_failed'; end if;
  perform set_config('pikas.bootstrap_horizonte_sandbox','',true);

  -- Permanent strict guard, identical to migration 202610090001.
  create or replace function pikas_private.guard_account_tenant_kind() returns trigger
  language plpgsql set search_path = '' as $strict$
begin
  if new.tenant_kind is distinct from old.tenant_kind then
    raise exception using errcode='23514',message='account_tenant_kind_is_immutable';
  end if;
  return new;
end $strict$;

  -- 4-6. Auth-less persona through the normal tables so every existing guard validates it.
  insert into public.persons(display_name,status,auth_user_id) values ('José Ramírez','active',null)
    returning id into person_value;
  insert into public.cafeteria_memberships(account_id,school_id,cafeteria_id,person_id,role_code,status)
    values (acc,sch,caf,person_value,'pos_cashier','active') returning id into membership_value;
  insert into pikas_private.sandbox_pov_personas(account_id,school_id,cafeteria_id,pov_code,person_id,
    cafeteria_membership_id,status)
    values (acc,sch,caf,'cashier',person_value,membership_value,'active') returning id into persona_value;

  -- 7. Explicit audit evidence (row-level audit triggers additionally record the account, person and membership).
  insert into public.audit_events(actor_person_id,authenticated_user_id,actor_role,actor_scope_kind,account_id,
    school_id,cafeteria_id,action,target_type,target_id,outcome,before_metadata,after_metadata)
  values
   (null,null,'database_maintenance','system',acc,sch,caf,'sandbox_tenant_classified','accounts',acc,'succeeded',
    jsonb_build_object('tenant_kind','customer'),
    jsonb_build_object('tenant_kind','sandbox','migration','202610090003_colegio_horizonte_sandbox_bootstrap')),
   (null,null,'database_maintenance','system',acc,sch,caf,'sandbox_persona_registered','sandbox_pov_personas',
    persona_value,'succeeded','{}'::jsonb,
    jsonb_build_object('pov_code','cashier','role_code','pos_cashier','migration','202610090003_colegio_horizonte_sandbox_bootstrap'));

  -- 8. Final assertions.
  if (select prosrc from pg_proc where oid='pikas_private.guard_account_tenant_kind()'::regprocedure) is distinct from original_src
    or coalesce(current_setting('pikas.bootstrap_horizonte_sandbox',true),'')<>'' then
    raise exception 'sandbox_bootstrap_guard_not_restored';
  end if;
  if not exists(select 1 from pg_trigger where tgrelid='public.accounts'::regclass
      and tgname='accounts_tenant_kind_immutable' and tgenabled='O') then
    raise exception 'sandbox_bootstrap_guard_trigger_not_enabled';
  end if;
  if (select count(*) from public.accounts where tenant_kind='sandbox')<>1
    or not exists(select 1 from public.accounts where id=acc and tenant_kind='sandbox') then
    raise exception 'sandbox_bootstrap_classification_mismatch';
  end if;
  if not exists(select 1 from public.persons where id=person_value and display_name='José Ramírez'
      and status='active' and auth_user_id is null)
    or (select count(*) from public.cafeteria_memberships where person_id=person_value)<>1
    or not exists(select 1 from public.cafeteria_memberships where id=membership_value and person_id=person_value
      and account_id=acc and school_id=sch and cafeteria_id=caf and role_code='pos_cashier' and status='active')
    or exists(select 1 from public.account_memberships where person_id=person_value)
    or exists(select 1 from public.school_memberships where person_id=person_value)
    or exists(select 1 from pikas_private.platform_memberships where person_id=person_value)
    or (select count(*) from pikas_private.sandbox_pov_personas where cafeteria_id=caf and status='active')<>1
    or not exists(select 1 from pikas_private.sandbox_pov_personas where id=persona_value and person_id=person_value
      and cafeteria_membership_id=membership_value and pov_code='cashier' and status='active')
    or exists(select 1 from pikas_private.sandbox_pov_sessions) then
    raise exception 'sandbox_bootstrap_persona_assertion_failed';
  end if;
end
$bootstrap$;
$t$,'P0001','sandbox_bootstrap_unexpected_existing_sandbox_state','Pre-existing sandbox tenant aborts');
select pg_temp.reclassify('00000000-0000-0000-0000-000000006001','customer');
select is((select tenant_kind from public.accounts where id='03e71159-69e9-4387-9b3b-65799d49faf0'),'customer','Aborted runs leave Horizonte a customer');
select is((select count(*) from public.persons where display_name='José Ramírez'),0::bigint,'Aborted runs create no persona');

-- Snapshot every table outside the explicitly allowed bootstrap writes, including Auth and POS data.
create temp table before_bootstrap as select pg_temp.application_snapshot()
  - array['public.accounts','public.persons','public.cafeteria_memberships','public.audit_events','pikas_private.sandbox_pov_personas'] as data;
create temp table before_auth as select jsonb_agg(to_jsonb(u) order by id) as data from auth.users u;
-- Happy path.
select lives_ok($t$
do $bootstrap$
declare
  acc constant uuid := '03e71159-69e9-4387-9b3b-65799d49faf0';
  sch constant uuid := 'df8fcd98-6ece-4f87-b4e9-2f5f3ec8e488';
  loc constant uuid := 'cc7ca5f3-d27e-43ea-b3c9-8a6ef4e327d4';
  caf constant uuid := 'b9496342-5079-46ae-83b8-05c39bcbd7fe';
  original_src text;
  person_value uuid;
  membership_value uuid;
  persona_value uuid;
begin
  if not exists(select 1 from public.accounts where id=acc) then
    if not exists(select 1 from public.accounts) and not exists(select 1 from public.persons)
      and not exists(select 1 from pikas_private.platform_memberships) then
      raise notice 'Pristine database: nothing to bootstrap';
      return;
    end if;
    raise exception 'sandbox_bootstrap_account_missing';
  end if;

  -- 1-2. Exact hierarchy and state; any drift aborts the whole migration.
  if not exists(select 1 from public.accounts where id=acc and status='active' and tenant_kind='customer') then
    raise exception 'sandbox_bootstrap_account_state_mismatch';
  end if;
  if not exists(select 1 from public.schools where id=sch and account_id=acc and status='active')
    or not exists(select 1 from public.school_locations where id=loc and account_id=acc and school_id=sch and status='active')
    or not exists(select 1 from public.cafeterias where id=caf and account_id=acc and school_id=sch
                  and school_location_id=loc and status='active') then
    raise exception 'sandbox_bootstrap_hierarchy_mismatch';
  end if;
  if (select count(*) from public.accounts where tenant_kind='sandbox')<>0
    or exists(select 1 from pikas_private.sandbox_pov_personas where cafeteria_id=caf) then
    raise exception 'sandbox_bootstrap_unexpected_existing_sandbox_state';
  end if;
  if not pikas_private.scope_active(acc,sch,caf) then
    raise exception 'sandbox_bootstrap_scope_inactive';
  end if;

  -- 3. Controlled transition. The trigger stays enabled. A transaction-local signal plus the exact account and
  -- transition are required by the temporary guard; the strict guard is then restored and compared to the original.
  select p.prosrc into strict original_src from pg_proc p
    where p.oid='pikas_private.guard_account_tenant_kind()'::regprocedure;
  create or replace function pikas_private.guard_account_tenant_kind() returns trigger
  language plpgsql set search_path = '' as $fn$
  begin
    if new.tenant_kind is distinct from old.tenant_kind
      and not (coalesce(current_setting('pikas.bootstrap_horizonte_sandbox',true),'')='202610090003'
               and old.id='03e71159-69e9-4387-9b3b-65799d49faf0'::uuid
               and old.tenant_kind='customer' and new.tenant_kind='sandbox') then
      raise exception using errcode='23514',message='account_tenant_kind_is_immutable';
    end if;
    return new;
  end $fn$;

  perform set_config('pikas.bootstrap_horizonte_sandbox','202610090003',true);
  update public.accounts set tenant_kind='sandbox' where id=acc and tenant_kind='customer';
  if not found then raise exception 'sandbox_bootstrap_conversion_failed'; end if;
  perform set_config('pikas.bootstrap_horizonte_sandbox','',true);

  -- Permanent strict guard, identical to migration 202610090001.
  create or replace function pikas_private.guard_account_tenant_kind() returns trigger
  language plpgsql set search_path = '' as $strict$
begin
  if new.tenant_kind is distinct from old.tenant_kind then
    raise exception using errcode='23514',message='account_tenant_kind_is_immutable';
  end if;
  return new;
end $strict$;

  -- 4-6. Auth-less persona through the normal tables so every existing guard validates it.
  insert into public.persons(display_name,status,auth_user_id) values ('José Ramírez','active',null)
    returning id into person_value;
  insert into public.cafeteria_memberships(account_id,school_id,cafeteria_id,person_id,role_code,status)
    values (acc,sch,caf,person_value,'pos_cashier','active') returning id into membership_value;
  insert into pikas_private.sandbox_pov_personas(account_id,school_id,cafeteria_id,pov_code,person_id,
    cafeteria_membership_id,status)
    values (acc,sch,caf,'cashier',person_value,membership_value,'active') returning id into persona_value;

  -- 7. Explicit audit evidence (row-level audit triggers additionally record the account, person and membership).
  insert into public.audit_events(actor_person_id,authenticated_user_id,actor_role,actor_scope_kind,account_id,
    school_id,cafeteria_id,action,target_type,target_id,outcome,before_metadata,after_metadata)
  values
   (null,null,'database_maintenance','system',acc,sch,caf,'sandbox_tenant_classified','accounts',acc,'succeeded',
    jsonb_build_object('tenant_kind','customer'),
    jsonb_build_object('tenant_kind','sandbox','migration','202610090003_colegio_horizonte_sandbox_bootstrap')),
   (null,null,'database_maintenance','system',acc,sch,caf,'sandbox_persona_registered','sandbox_pov_personas',
    persona_value,'succeeded','{}'::jsonb,
    jsonb_build_object('pov_code','cashier','role_code','pos_cashier','migration','202610090003_colegio_horizonte_sandbox_bootstrap'));

  -- 8. Final assertions.
  if (select prosrc from pg_proc where oid='pikas_private.guard_account_tenant_kind()'::regprocedure) is distinct from original_src
    or coalesce(current_setting('pikas.bootstrap_horizonte_sandbox',true),'')<>'' then
    raise exception 'sandbox_bootstrap_guard_not_restored';
  end if;
  if not exists(select 1 from pg_trigger where tgrelid='public.accounts'::regclass
      and tgname='accounts_tenant_kind_immutable' and tgenabled='O') then
    raise exception 'sandbox_bootstrap_guard_trigger_not_enabled';
  end if;
  if (select count(*) from public.accounts where tenant_kind='sandbox')<>1
    or not exists(select 1 from public.accounts where id=acc and tenant_kind='sandbox') then
    raise exception 'sandbox_bootstrap_classification_mismatch';
  end if;
  if not exists(select 1 from public.persons where id=person_value and display_name='José Ramírez'
      and status='active' and auth_user_id is null)
    or (select count(*) from public.cafeteria_memberships where person_id=person_value)<>1
    or not exists(select 1 from public.cafeteria_memberships where id=membership_value and person_id=person_value
      and account_id=acc and school_id=sch and cafeteria_id=caf and role_code='pos_cashier' and status='active')
    or exists(select 1 from public.account_memberships where person_id=person_value)
    or exists(select 1 from public.school_memberships where person_id=person_value)
    or exists(select 1 from pikas_private.platform_memberships where person_id=person_value)
    or (select count(*) from pikas_private.sandbox_pov_personas where cafeteria_id=caf and status='active')<>1
    or not exists(select 1 from pikas_private.sandbox_pov_personas where id=persona_value and person_id=person_value
      and cafeteria_membership_id=membership_value and pov_code='cashier' and status='active')
    or exists(select 1 from pikas_private.sandbox_pov_sessions) then
    raise exception 'sandbox_bootstrap_persona_assertion_failed';
  end if;
end
$bootstrap$;
$t$,'Bootstrap succeeds on the exact legacy hierarchy');
select is(pg_temp.application_snapshot()
  - array['public.accounts','public.persons','public.cafeteria_memberships','public.audit_events','pikas_private.sandbox_pov_personas'],
  (select data from before_bootstrap),'All other tables including every POS operational table remain unchanged');
select is((select jsonb_agg(to_jsonb(u) order by id) from auth.users u),(select data from before_auth),'Bootstrap creates or modifies no Auth identity');
select is((select array_agg(id order by id) from public.accounts where tenant_kind='sandbox'),array['03e71159-69e9-4387-9b3b-65799d49faf0'::uuid],'Only Horizonte is sandbox');
select is((select tenant_kind from public.accounts where id='00000000-0000-0000-0000-000000006001'),'customer','Other tenant unchanged');
select is((select count(*) from public.persons where display_name='José Ramírez' and status='active' and auth_user_id is null),1::bigint,'Jose is active and Auth-less');
select is((select count(*) from public.cafeteria_memberships m join public.persons p on p.id=m.person_id
  where p.display_name='José Ramírez' and m.role_code='pos_cashier' and m.status='active'
   and m.account_id='03e71159-69e9-4387-9b3b-65799d49faf0' and m.school_id='df8fcd98-6ece-4f87-b4e9-2f5f3ec8e488' and m.cafeteria_id='b9496342-5079-46ae-83b8-05c39bcbd7fe'),1::bigint,'Jose has the exact cashier membership');
select is((select count(*) from public.cafeteria_memberships m join public.persons p on p.id=m.person_id where p.display_name='José Ramírez'),1::bigint,'Jose has no other cafeteria membership');
select is((select count(*) from public.account_memberships m join public.persons p on p.id=m.person_id where p.display_name='José Ramírez')
  +(select count(*) from public.school_memberships m join public.persons p on p.id=m.person_id where p.display_name='José Ramírez'),0::bigint,'Jose has no account or school membership');
select is((select count(*) from pikas_private.sandbox_pov_personas sp join public.persons p on p.id=sp.person_id
  join public.cafeteria_memberships m on m.id=sp.cafeteria_membership_id
  where p.display_name='José Ramírez' and sp.pov_code='cashier' and sp.status='active' and sp.cafeteria_id='b9496342-5079-46ae-83b8-05c39bcbd7fe'
   and sp.account_id='03e71159-69e9-4387-9b3b-65799d49faf0' and sp.school_id='df8fcd98-6ece-4f87-b4e9-2f5f3ec8e488' and m.person_id=p.id),1::bigint,'Persona registered as active cashier');
select is((select count(*) from pikas_private.platform_memberships m join public.persons p on p.id=m.person_id where p.display_name='José Ramírez'),0::bigint,'Jose has no platform authority');
select is((select count(*) from pikas_private.sandbox_pov_sessions),0::bigint,'Bootstrap creates no POV session');
select is((select count(*) from public.cafeteria_register_assignments where account_id='03e71159-69e9-4387-9b3b-65799d49faf0')+(select count(*) from public.register_sessions where account_id='03e71159-69e9-4387-9b3b-65799d49faf0')
  +(select count(*) from public.purchases where account_id='03e71159-69e9-4387-9b3b-65799d49faf0'),0::bigint,'No POS operational data created for Horizonte');
select is((select count(*) from public.audit_events where action='sandbox_tenant_classified' and target_id='03e71159-69e9-4387-9b3b-65799d49faf0'::uuid and outcome='succeeded'),1::bigint,'Classification audit recorded');
select is((select count(*) from public.audit_events where action='sandbox_persona_registered' and account_id='03e71159-69e9-4387-9b3b-65799d49faf0'),1::bigint,'Persona audit recorded');
select ok((select count(*) from public.audit_events where target_type='cafeteria_memberships' and account_id='03e71159-69e9-4387-9b3b-65799d49faf0')>=1,'Row-level membership audit recorded');
select is((select array_agg(person_id||role_code||status order by person_id) from pikas_private.platform_memberships where person_id='00000000-0000-0000-0000-000000001601'),
  (select array_agg(person_id||role_code||status order by person_id) from before_admin),'Existing platform_admin authority unaffected');

select is(coalesce(current_setting('pikas.bootstrap_horizonte_sandbox',true),''),'','Transaction-local bootstrap signal is cleared');
select is((select prosrc from pg_proc where oid='pikas_private.guard_account_tenant_kind()'::regprocedure),
$strict$
begin
  if new.tenant_kind is distinct from old.tenant_kind then
    raise exception using errcode='23514',message='account_tenant_kind_is_immutable';
  end if;
  return new;
end $strict$,'Permanent guard matches the original strict definition byte for byte');

-- Immutability remains in force.
select throws_ok($$update public.accounts set tenant_kind='customer' where id='03e71159-69e9-4387-9b3b-65799d49faf0'$$,'23514','account_tenant_kind_is_immutable','Horizonte cannot revert');
select throws_ok($$update public.accounts set tenant_kind='sandbox' where id='00000000-0000-0000-0000-000000006001'$$,'23514','account_tenant_kind_is_immutable','Other accounts cannot become sandbox');
select ok(pg_get_functiondef('pikas_private.guard_account_tenant_kind()'::regprocedure) not like '%03e71159%','Guard function carries no bootstrap exception');
select is((select tgenabled::text from pg_trigger where tgname='accounts_tenant_kind_immutable' and tgrelid='public.accounts'::regclass),'O','Immutability trigger enabled');
select throws_ok($t$
do $bootstrap$
declare
  acc constant uuid := '03e71159-69e9-4387-9b3b-65799d49faf0';
  sch constant uuid := 'df8fcd98-6ece-4f87-b4e9-2f5f3ec8e488';
  loc constant uuid := 'cc7ca5f3-d27e-43ea-b3c9-8a6ef4e327d4';
  caf constant uuid := 'b9496342-5079-46ae-83b8-05c39bcbd7fe';
  original_src text;
  person_value uuid;
  membership_value uuid;
  persona_value uuid;
begin
  if not exists(select 1 from public.accounts where id=acc) then
    if not exists(select 1 from public.accounts) and not exists(select 1 from public.persons)
      and not exists(select 1 from pikas_private.platform_memberships) then
      raise notice 'Pristine database: nothing to bootstrap';
      return;
    end if;
    raise exception 'sandbox_bootstrap_account_missing';
  end if;

  -- 1-2. Exact hierarchy and state; any drift aborts the whole migration.
  if not exists(select 1 from public.accounts where id=acc and status='active' and tenant_kind='customer') then
    raise exception 'sandbox_bootstrap_account_state_mismatch';
  end if;
  if not exists(select 1 from public.schools where id=sch and account_id=acc and status='active')
    or not exists(select 1 from public.school_locations where id=loc and account_id=acc and school_id=sch and status='active')
    or not exists(select 1 from public.cafeterias where id=caf and account_id=acc and school_id=sch
                  and school_location_id=loc and status='active') then
    raise exception 'sandbox_bootstrap_hierarchy_mismatch';
  end if;
  if (select count(*) from public.accounts where tenant_kind='sandbox')<>0
    or exists(select 1 from pikas_private.sandbox_pov_personas where cafeteria_id=caf) then
    raise exception 'sandbox_bootstrap_unexpected_existing_sandbox_state';
  end if;
  if not pikas_private.scope_active(acc,sch,caf) then
    raise exception 'sandbox_bootstrap_scope_inactive';
  end if;

  -- 3. Controlled transition. The trigger stays enabled. A transaction-local signal plus the exact account and
  -- transition are required by the temporary guard; the strict guard is then restored and compared to the original.
  select p.prosrc into strict original_src from pg_proc p
    where p.oid='pikas_private.guard_account_tenant_kind()'::regprocedure;
  create or replace function pikas_private.guard_account_tenant_kind() returns trigger
  language plpgsql set search_path = '' as $fn$
  begin
    if new.tenant_kind is distinct from old.tenant_kind
      and not (coalesce(current_setting('pikas.bootstrap_horizonte_sandbox',true),'')='202610090003'
               and old.id='03e71159-69e9-4387-9b3b-65799d49faf0'::uuid
               and old.tenant_kind='customer' and new.tenant_kind='sandbox') then
      raise exception using errcode='23514',message='account_tenant_kind_is_immutable';
    end if;
    return new;
  end $fn$;

  perform set_config('pikas.bootstrap_horizonte_sandbox','202610090003',true);
  update public.accounts set tenant_kind='sandbox' where id=acc and tenant_kind='customer';
  if not found then raise exception 'sandbox_bootstrap_conversion_failed'; end if;
  perform set_config('pikas.bootstrap_horizonte_sandbox','',true);

  -- Permanent strict guard, identical to migration 202610090001.
  create or replace function pikas_private.guard_account_tenant_kind() returns trigger
  language plpgsql set search_path = '' as $strict$
begin
  if new.tenant_kind is distinct from old.tenant_kind then
    raise exception using errcode='23514',message='account_tenant_kind_is_immutable';
  end if;
  return new;
end $strict$;

  -- 4-6. Auth-less persona through the normal tables so every existing guard validates it.
  insert into public.persons(display_name,status,auth_user_id) values ('José Ramírez','active',null)
    returning id into person_value;
  insert into public.cafeteria_memberships(account_id,school_id,cafeteria_id,person_id,role_code,status)
    values (acc,sch,caf,person_value,'pos_cashier','active') returning id into membership_value;
  insert into pikas_private.sandbox_pov_personas(account_id,school_id,cafeteria_id,pov_code,person_id,
    cafeteria_membership_id,status)
    values (acc,sch,caf,'cashier',person_value,membership_value,'active') returning id into persona_value;

  -- 7. Explicit audit evidence (row-level audit triggers additionally record the account, person and membership).
  insert into public.audit_events(actor_person_id,authenticated_user_id,actor_role,actor_scope_kind,account_id,
    school_id,cafeteria_id,action,target_type,target_id,outcome,before_metadata,after_metadata)
  values
   (null,null,'database_maintenance','system',acc,sch,caf,'sandbox_tenant_classified','accounts',acc,'succeeded',
    jsonb_build_object('tenant_kind','customer'),
    jsonb_build_object('tenant_kind','sandbox','migration','202610090003_colegio_horizonte_sandbox_bootstrap')),
   (null,null,'database_maintenance','system',acc,sch,caf,'sandbox_persona_registered','sandbox_pov_personas',
    persona_value,'succeeded','{}'::jsonb,
    jsonb_build_object('pov_code','cashier','role_code','pos_cashier','migration','202610090003_colegio_horizonte_sandbox_bootstrap'));

  -- 8. Final assertions.
  if (select prosrc from pg_proc where oid='pikas_private.guard_account_tenant_kind()'::regprocedure) is distinct from original_src
    or coalesce(current_setting('pikas.bootstrap_horizonte_sandbox',true),'')<>'' then
    raise exception 'sandbox_bootstrap_guard_not_restored';
  end if;
  if not exists(select 1 from pg_trigger where tgrelid='public.accounts'::regclass
      and tgname='accounts_tenant_kind_immutable' and tgenabled='O') then
    raise exception 'sandbox_bootstrap_guard_trigger_not_enabled';
  end if;
  if (select count(*) from public.accounts where tenant_kind='sandbox')<>1
    or not exists(select 1 from public.accounts where id=acc and tenant_kind='sandbox') then
    raise exception 'sandbox_bootstrap_classification_mismatch';
  end if;
  if not exists(select 1 from public.persons where id=person_value and display_name='José Ramírez'
      and status='active' and auth_user_id is null)
    or (select count(*) from public.cafeteria_memberships where person_id=person_value)<>1
    or not exists(select 1 from public.cafeteria_memberships where id=membership_value and person_id=person_value
      and account_id=acc and school_id=sch and cafeteria_id=caf and role_code='pos_cashier' and status='active')
    or exists(select 1 from public.account_memberships where person_id=person_value)
    or exists(select 1 from public.school_memberships where person_id=person_value)
    or exists(select 1 from pikas_private.platform_memberships where person_id=person_value)
    or (select count(*) from pikas_private.sandbox_pov_personas where cafeteria_id=caf and status='active')<>1
    or not exists(select 1 from pikas_private.sandbox_pov_personas where id=persona_value and person_id=person_value
      and cafeteria_membership_id=membership_value and pov_code='cashier' and status='active')
    or exists(select 1 from pikas_private.sandbox_pov_sessions) then
    raise exception 'sandbox_bootstrap_persona_assertion_failed';
  end if;
end
$bootstrap$;
$t$,'P0001','sandbox_bootstrap_account_state_mismatch','Bootstrap cannot be applied twice');

-- Persona guards remain enforced.
insert into auth.users(id,aud,role,email,confirmed_at) values
 ('00000000-0000-0000-0000-000000002602','authenticated','authenticated','p6b3-auth-cashier@example.invalid',now());
insert into public.persons(id,auth_user_id,display_name,status) values
 ('00000000-0000-0000-0000-000000001602','00000000-0000-0000-0000-000000002602','Auth cashier','active'),
 ('00000000-0000-0000-0000-000000001603',null,'Other cashier','active');
insert into public.cafeteria_memberships(id,account_id,school_id,cafeteria_id,person_id,role_code) values
 ('00000000-0000-0000-0000-0000000b4602','03e71159-69e9-4387-9b3b-65799d49faf0','df8fcd98-6ece-4f87-b4e9-2f5f3ec8e488','b9496342-5079-46ae-83b8-05c39bcbd7fe','00000000-0000-0000-0000-000000001602','pos_cashier'),
 ('00000000-0000-0000-0000-0000000b4603','00000000-0000-0000-0000-000000006001','00000000-0000-0000-0000-000000006011','00000000-0000-0000-0000-000000006031','00000000-0000-0000-0000-000000001603','pos_cashier');
select throws_ok($$insert into pikas_private.sandbox_pov_personas(account_id,school_id,cafeteria_id,pov_code,person_id,cafeteria_membership_id)
  values ('00000000-0000-0000-0000-000000006001','00000000-0000-0000-0000-000000006011','00000000-0000-0000-0000-000000006031','cashier','00000000-0000-0000-0000-000000001603','00000000-0000-0000-0000-0000000b4603')$$,
  '23514','sandbox_pov_persona_requires_sandbox_account','Customer tenants cannot hold personas');
select throws_ok($$insert into pikas_private.sandbox_pov_personas(account_id,school_id,cafeteria_id,pov_code,person_id,cafeteria_membership_id)
  values ('03e71159-69e9-4387-9b3b-65799d49faf0','df8fcd98-6ece-4f87-b4e9-2f5f3ec8e488','b9496342-5079-46ae-83b8-05c39bcbd7fe','cashier','00000000-0000-0000-0000-000000001602','00000000-0000-0000-0000-0000000b4602')$$,
  '23514','sandbox_pov_persona_must_not_have_auth_identity','Auth-linked persons cannot be personas');
select throws_ok($$delete from pikas_private.sandbox_pov_personas$$,'23514','sandbox_pov_persona_must_be_deactivated_not_deleted','Personas cannot be deleted');
select lives_ok($$update pikas_private.sandbox_pov_personas set status='inactive'$$,'Persona can be deactivated');
select throws_ok($$update pikas_private.sandbox_pov_personas set status='active'$$,'23514','sandbox_pov_persona_cannot_be_reactivated','Persona cannot be reactivated');

select * from finish();
rollback;
