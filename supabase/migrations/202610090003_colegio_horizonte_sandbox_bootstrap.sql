-- Phase 6B.3: one-time legacy bootstrap that designates the fictional Colegio Horizonte tenant as the PIKAS
-- demonstration sandbox and provisions its Auth-less cashier persona (Jose Ramirez).
-- Fails closed: if the known account is missing the migration aborts. The only exception is a pristine database
-- (no accounts, persons or platform memberships, i.e. a fresh local reset whose seed runs after migrations).
-- The tenant_kind immutability trigger is never disabled or dropped: while the migration runs, its function is
-- replaced by an explicit version that also requires a transaction-local bootstrap signal, then the strict
-- permanent definition is restored before commit and verified against the original.
begin;

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

commit;
