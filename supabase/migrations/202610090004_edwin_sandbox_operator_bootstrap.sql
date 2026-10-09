-- Phase 6B.4: owner-reviewed grant to Edwin's existing Person; no identity or tenant writes.
-- Like 0003, an empty pre-seed local reset skips. Initialized databases fail closed.
-- Replay accepts only the original active membership with matching bootstrap audit evidence.
begin;

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

commit;
