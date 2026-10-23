-- Demo Lab & Sandbox customer (additive). See docs/DEMO_LAB.md.
-- A Demo is a real PIKAS account with tenant_kind='sandbox'; the UX 11 POV machinery stays the only way an
-- operator acts inside it ("Abrir como…"). This migration:
--   1. platform:sandbox:manage — new capability for restoring a sandbox baseline (platform_admin only).
--   2. Sandbox-scoped normal provisioning: a cafetería-admin POV may create Personal POS inside ITS sandbox
--      cafetería (username reservation with a mandatory ".demo" suffix, temporary credential) — never a real
--      customer person, never a username without the suffix, never while the target is outside the sandbox.
--   3. Demo-context reporting: read-only sales/sessions reports and PIKAS Cash reads inside the sandbox POV
--      (write operations on wallets stay refused; finance stays refused).
--   4. Restaurar escenario inicial: platform_reset_sandbox removes the sandbox's operational history and
--      re-seeds the Horizonte baseline (fixed ids); history-preservation triggers admit the delete only for
--      rows of the sandbox named by the reset's own transaction-local setting. Audit history is never deleted.
--   5. platform_demo_lab_read: sandboxes, personas, counts and last reset for the Demo Lab.
-- No real-customer path changes authority. No finance activation. No table or column changes.
begin;

insert into pikas_private.platform_capabilities(capability) values ('platform:sandbox:manage') on conflict do nothing;
insert into pikas_private.platform_role_capabilities(role_code,capability) values ('platform_admin','platform:sandbox:manage') on conflict do nothing;

alter table pikas_private.platform_audit_events drop constraint platform_audit_events_reason_code_check;
alter table pikas_private.platform_audit_events add constraint platform_audit_events_reason_code_check check (reason_code in (
 'owner_root_bootstrap','tenant_provisioned','school_location_added','customer_admin_intent_prepared','identity_linked','customer_admin_granted',
 'sandbox_pov_entered','sandbox_pov_exited','team_prepared','team_completed','team_demo_changed','customer_suspended','customer_reactivated',
 'customer_closed','customer_reopened','school_onboarded','customer_profile_updated','customer_structure_renamed','cafeteria_admin_granted','customer_person_renamed',
 'customer_structure_status_changed','customer_membership_status_changed','customer_pos_access_granted','sandbox_reset'));
alter table pikas_private.sandbox_pov_sessions drop constraint sandbox_pov_sessions_end_reason_check;
alter table pikas_private.sandbox_pov_sessions add constraint sandbox_pov_sessions_end_reason_check check (end_reason in ('exited','superseded','sandbox_reset'));

-- ───────────────────────── 2. Sandbox-scoped provisioning ─────────────────────────
-- A person is a "sandbox identity target" for the current cafetería-admin POV when every membership the
-- person holds lives in the POV's sandbox cafetería and the person is not a Platform member.
create function pikas_private.sandbox_identity_target(p_target uuid) returns boolean
language plpgsql stable security definer set search_path='' as $$
declare x record;
begin
 select * into x from pikas_private.sandbox_validated_pov() v where v.pov_code='cafeteria_admin';
 if not found or p_target is null then return false; end if;
 if not exists(select 1 from public.accounts a where a.id=x.account_id and a.tenant_kind='sandbox') then return false; end if;
 if not exists(select 1 from public.persons p where p.id=p_target) then return false; end if;
 if exists(select 1 from pikas_private.platform_memberships where person_id=p_target and status<>'inactive') then return false; end if;
 if exists(select 1 from public.account_memberships where person_id=p_target and status<>'inactive')
  or exists(select 1 from public.school_memberships where person_id=p_target and status<>'inactive') then return false; end if;
 if not exists(select 1 from public.cafeteria_memberships m where m.person_id=p_target and m.status<>'inactive') then return false; end if;
 if exists(select 1 from public.cafeteria_memberships m where m.person_id=p_target and m.status<>'inactive'
   and (m.account_id<>x.account_id or m.cafeteria_id<>x.cafeteria_id)) then return false; end if;
 return true;
end $$;

-- The UX 11 guard with the one sandbox-safe exception: a current POV may touch a sandbox identity target.
create function pikas_private.require_no_current_demo_except_sandbox_identity(p_target uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
 if pikas_private.sandbox_pov_current_attempt() and not pikas_private.sandbox_identity_target(p_target) then
  raise exception using errcode='42501',message='demo_mode_active';
 end if;
end $$;

create or replace function pikas_private.identity_support_scope(p_target uuid) returns text
language plpgsql security definer set search_path='' as $$
declare actor uuid;
begin
 if exists(select 1 from pikas_private.sandbox_validated_pov()) then
  -- Inside a sandbox POV the real operator supports only identities that exist solely in that sandbox cafetería.
  if pikas_private.sandbox_identity_target(p_target) and exists(select 1 from public.persons where id=p_target and auth_user_id is not null) then return 'tenant'; end if;
  return null;
 end if;
 if not exists(select 1 from public.persons where id=p_target and auth_user_id is not null) then return null; end if;
 if exists(select 1 from pikas_private.platform_memberships where person_id=p_target and status<>'inactive') then return null; end if;
 if pikas_private.platform_has_capability('platform:identity:support') then
  if exists(select 1 from public.persons where id=p_target and auth_user_id=(select auth.uid())) then return null; end if;
  return 'platform';
 end if;
 actor:=pikas_private.current_person_id();
 if actor is null or actor=p_target then return null; end if;
 if not exists(select 1 from public.school_memberships where person_id=p_target and status<>'inactive')
  and not exists(select 1 from public.cafeteria_memberships where person_id=p_target and status<>'inactive') then return null; end if;
 if exists(select 1 from public.account_memberships where person_id=p_target and status<>'inactive') then return null; end if;
 if exists(select 1 from public.school_memberships m where m.person_id=p_target and m.status<>'inactive'
  and not exists(select 1 from public.account_memberships a where a.person_id=actor and a.status='active' and a.role_code='account_admin' and a.account_id=m.account_id)) then return null; end if;
 if exists(select 1 from public.cafeteria_memberships m where m.person_id=p_target and m.status<>'inactive' and not (
   exists(select 1 from public.account_memberships a where a.person_id=actor and a.status='active' and a.role_code='account_admin' and a.account_id=m.account_id)
   or exists(select 1 from public.school_memberships s where s.person_id=actor and s.status='active' and s.role_code='school_admin' and s.account_id=m.account_id and s.school_id=m.school_id)
   or (m.role_code in ('pos_cashier','pos_supervisor') and exists(select 1 from public.cafeteria_memberships c where c.person_id=actor and c.status='active'
    and c.role_code='cafeteria_admin' and c.account_id=m.account_id and c.school_id=m.school_id and c.cafeteria_id=m.cafeteria_id)))) then return null; end if;
 return 'tenant';
end $$;

create or replace function public.identity_begin_temporary_access(p_person_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare ctx jsonb;
begin
 perform pikas_private.require_no_current_demo_except_sandbox_identity(p_person_id);
 ctx:=pikas_private.require_identity_support(p_person_id);
 update pikas_private.login_identities set must_change_password=true,password_baseline=null,temporary_requested_at=clock_timestamp(),
  temporary_issued_at=null,version=version+1,updated_at=now() where person_id=p_person_id;
 perform pikas_private.end_identity_sessions((ctx->>'target_auth')::uuid);
 perform pikas_private.identity_audit(ctx,p_person_id,'temporary_access_requested');
 return jsonb_build_object('auth_user_id',ctx->>'target_auth');
end $$;

create or replace function public.identity_finish_temporary_access(p_person_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare ctx jsonb; li pikas_private.login_identities; hash text;
begin
 perform pikas_private.require_no_current_demo_except_sandbox_identity(p_person_id);
 ctx:=pikas_private.require_identity_support(p_person_id);
 select * into li from pikas_private.login_identities where person_id=p_person_id;
 if not li.must_change_password or li.temporary_requested_at is null or li.password_baseline is not null then raise exception using errcode='40001',message='temporary_access_not_pending'; end if;
 select encode(extensions.digest(coalesce(u.encrypted_password,''),'sha256'),'hex') into hash from auth.users u where u.id=(ctx->>'target_auth')::uuid;
 update pikas_private.login_identities set password_baseline=hash,temporary_issued_at=clock_timestamp(),version=version+1,updated_at=now() where person_id=p_person_id;
 perform pikas_private.identity_audit(ctx,p_person_id,'temporary_access_issued',jsonb_build_object('requires_password_change',true));
 return pikas_private.identity_summary(p_person_id);
end $$;

-- Username reservation inside a sandbox POV: only the cafetería-staff flow, only the POV's own sandbox
-- cafetería, and only usernames ending in ".demo" so a sandbox can never squat a real person's username.
create or replace function public.provisioning_prepare_with_username(p_flow text, p_request_id uuid, p_school_id uuid, p_cafeteria_id uuid, p_payload jsonb, p_username text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v text:=pikas_private.normalize_username(p_username); prior pikas_private.provisioning_username_requests; result jsonb; source uuid; pov record;
begin
 if p_request_id is null or p_flow not in ('cafeteria_staff','school_admin','cafeteria_admin') then raise exception using errcode='22023',message='invalid_provisioning_request'; end if;
 select * into pov from pikas_private.sandbox_validated_pov() x;
 if found then
  if p_flow<>'cafeteria_staff' or pov.pov_code<>'cafeteria_admin' or p_cafeteria_id is distinct from pov.cafeteria_id
   or not exists(select 1 from public.accounts a where a.id=pov.account_id and a.tenant_kind='sandbox') then
   raise exception using errcode='22023',message='sandbox_username_unsupported';
  end if;
  if v is null or v not like '%.demo' then raise exception using errcode='22023',message='sandbox_username_requires_demo_suffix'; end if;
 end if;
 if not pikas_private.valid_username(v) then raise exception using errcode='22023',message='invalid_username'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_request_id::text,20261027));
 select * into prior from pikas_private.provisioning_username_requests where request_id=p_request_id;
 if found and (prior.username<>v or prior.flow<>p_flow or prior.actor_auth_user_id<>(select auth.uid())) then raise exception using errcode='23505',message='request_key_reused'; end if;
 if p_flow='cafeteria_staff' then
  result:=public.cafeteria_admin_command(p_cafeteria_id,p_request_id,'staff_prepare',p_payload); source:=(result->>'target_id')::uuid;
 elsif p_flow='school_admin' then
  result:=public.school_admin_command(p_school_id,p_request_id,'admin_prepare',p_payload); source:=(result->>'invitation_id')::uuid;
 else
  result:=public.cafeteria_delegation_command(p_school_id:=p_school_id,p_cafeteria_id:=p_cafeteria_id,p_request_id:=p_request_id,p_operation:='cafeteria_admin_prepare',p_payload:=p_payload);
  source:=(result->>'invitation_id')::uuid;
 end if;
 if source is null then raise exception using errcode='23514',message='pending_provisioning_required'; end if;
 if prior.request_id is null then
  perform pikas_private.reserve_provisioning_username('invitation',source,v);
  insert into pikas_private.provisioning_username_requests(request_id,actor_auth_user_id,flow,username,source_id) values(p_request_id,(select auth.uid()),p_flow,v,source);
 elsif prior.source_id<>source then raise exception using errcode='23505',message='request_key_reused'; end if;
 return result||jsonb_build_object('username',v);
end $$;

-- POS membership grants/status inside the sandbox resolve the acting persona and its POV capability (the
-- real operator stays in the audit through auth.uid() and the POV audit stamp). Outside a POV: unchanged.
create or replace function public.set_cafeteria_pos_membership(p_cafeteria_id uuid, p_person_id uuid, p_role_code text, p_status text)
 returns table(membership_id uuid, status text)
language plpgsql security definer set search_path='' as $$
declare a uuid; s uuid; actor uuid; target_auth uuid; target_status text; member_id uuid; old_status text;
begin
  actor:=pikas_private.sandbox_admin_actor('cafeteria_admin');
  select x.account_id,x.school_id into a,s from pikas_private.lock_active_cafeteria_scope(p_cafeteria_id) x;
  if actor is null or a is null or not pikas_private.sandbox_admin_has_capability('cafeteria_admin','cafeteria:pos:memberships:manage',a,s,p_cafeteria_id) then
    raise exception using errcode='42501',message='not_authorized';
  end if;
  if p_role_code is null or p_role_code not in ('pos_cashier','pos_supervisor')
      or p_status is null or p_status not in ('active','suspended','inactive') or p_person_id is null then
    raise exception using errcode='22023',message='invalid_pos_membership_role_or_status';
  end if;
  select p.auth_user_id,p.status into target_auth,target_status from public.persons p where p.id=p_person_id;
  if not found then raise exception using errcode='23503',message='person_not_found'; end if;
  if p_status<>'inactive' and (target_auth is null or target_status<>'active') then
    raise exception using errcode='23514',message='active_auth_linked_person_required_for_pos_role';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_cafeteria_id::text||':'||p_person_id::text||':'||p_role_code,20261005));
  select m.id,m.status into member_id,old_status from public.cafeteria_memberships m
    where m.account_id=a and m.school_id=s and m.cafeteria_id=p_cafeteria_id and m.person_id=p_person_id and m.role_code=p_role_code for update;
  if not found then
    if p_status='inactive' then raise exception using errcode='23503',message='pos_membership_not_found'; end if;
    insert into public.cafeteria_memberships(account_id,school_id,cafeteria_id,person_id,role_code,status)
    values(a,s,p_cafeteria_id,p_person_id,p_role_code,p_status) returning id into member_id;
    perform pikas_private.record_pos_operational_audit(actor,auth.uid(),'cafeteria_admin',a,s,p_cafeteria_id,
      'pos_membership_granted','cafeteria_memberships',member_id,'{}'::jsonb,jsonb_build_object('role_code',p_role_code,'status',p_status));
  elsif old_status is distinct from p_status then
    update public.cafeteria_memberships m set status=p_status where m.id=member_id;
    perform pikas_private.record_pos_operational_audit(actor,auth.uid(),'cafeteria_admin',a,s,p_cafeteria_id,
      case when p_status='inactive' then 'pos_membership_revoked' else 'pos_membership_status_changed' end,
      'cafeteria_memberships',member_id,jsonb_build_object('role_code',p_role_code,'status',old_status),jsonb_build_object('role_code',p_role_code,'status',p_status));
  end if;
  return query select member_id,p_status;
end $$;

-- Caja assignment creation (assignment_save for a new pair) resolves the acting persona and the POV capability the same way.
create or replace function public.create_cafeteria_register_assignment(p_cafeteria_id uuid, p_assignment_id uuid, p_cafeteria_membership_id uuid, p_register_id uuid)
 returns table(assignment_id uuid, assignment_version integer)
language plpgsql security definer set search_path='' as $$
declare a uuid; s uuid; l uuid; actor uuid; target_person_id uuid; role_value text; existing public.cafeteria_register_assignments%rowtype; register_status text;
begin
  actor:=pikas_private.sandbox_admin_actor('cafeteria_admin');
  select x.account_id,x.school_id,x.school_location_id into a,s,l from pikas_private.lock_active_cafeteria_scope(p_cafeteria_id) x;
  if actor is null or a is null or not pikas_private.sandbox_admin_has_capability('cafeteria_admin','cafeteria:register_assignments:manage',a,s,p_cafeteria_id) then
    raise exception using errcode='42501',message='not_authorized';
  end if;
  if p_assignment_id is null or p_cafeteria_membership_id is null or p_register_id is null then raise exception using errcode='22023',message='register_assignment_required_fields'; end if;
  select m.person_id,m.role_code into target_person_id,role_value from public.cafeteria_memberships m
    where m.id=p_cafeteria_membership_id and m.account_id=a and m.school_id=s and m.cafeteria_id=p_cafeteria_id and m.status='active';
  if not found or not exists(select 1 from pikas_private.role_capabilities rc where rc.scope_kind='cafeteria' and rc.role_code=role_value and rc.capability='cafeteria:pos:session:open') then
    raise exception using errcode='23503',message='active_pos_membership_required';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(target_person_id::text,20261005));
  select r.status into register_status from public.cafeteria_registers r where r.id=p_register_id and r.account_id=a and r.school_id=s and r.school_location_id=l and r.cafeteria_id=p_cafeteria_id for update;
  if not found or register_status<>'active' then raise exception using errcode='23503',message='active_register_required'; end if;
  perform 1 from public.cafeteria_memberships m where m.id=p_cafeteria_membership_id and m.account_id=a and m.school_id=s and m.cafeteria_id=p_cafeteria_id
    and m.person_id=target_person_id and m.role_code=role_value and m.status='active' for share;
  if not found then raise exception using errcode='42501',message='active_pos_membership_required'; end if;
  insert into public.cafeteria_register_assignments(id,account_id,school_id,school_location_id,cafeteria_id,cafeteria_membership_id,operator_person_id,register_id)
  values(p_assignment_id,a,s,l,p_cafeteria_id,p_cafeteria_membership_id,target_person_id,p_register_id)
  on conflict(cafeteria_membership_id,register_id) do nothing returning id,version into assignment_id,assignment_version;
  if found then
    perform pikas_private.record_pos_operational_audit(actor,auth.uid(),'cafeteria_admin',a,s,p_cafeteria_id,'register_assignment_created','cafeteria_register_assignments',assignment_id,'{}'::jsonb,
      jsonb_build_object('operator_person_id',target_person_id,'register_id',p_register_id,'status','active'));
    return next; return;
  end if;
  select ra.* into existing from public.cafeteria_register_assignments ra where ra.cafeteria_membership_id=p_cafeteria_membership_id and ra.register_id=p_register_id;
  if not found or existing.id<>p_assignment_id or existing.status<>'active' then raise exception using errcode='23505',message='register_assignment_already_exists_or_request_id_changed'; end if;
  return query select existing.id,existing.version;
end $$;

-- ───────────────────────── 3. Demo-context reporting (read-only) ─────────────────────────
create or replace function pikas_private.sandbox_admin_has_capability_tenant(p_code text, cap text, a uuid, s uuid default null, c uuid default null) returns boolean
language plpgsql security definer set search_path='' as $$
declare x record;
begin
 if not pikas_private.sandbox_pov_active_attempt() then return pikas_private.has_capability(cap,a,s,c); end if;
 select * into x from pikas_private.sandbox_validated_pov() v where v.pov_code=p_code;
 if not found then return false; end if;
 if x.account_id is distinct from a or x.school_id is distinct from s or (p_code='cafeteria_admin' and x.cafeteria_id is distinct from c)
 or (p_code='school_admin' and c is not null and x.cafeteria_id is distinct from c) then return false; end if;
 -- Demo Lab: the sandbox's own fictional reports are readable inside the Demo; every wallet/finance write stays excluded.
 if p_code='school_admin' and cap<>all(array['school:read','school:students:read','school:students:manage','school:administrators:manage','school:sharing:read','school:sharing:manage','school:customers:read','school:customers:manage','school:wallets:read']) then return false; end if;
 if p_code='cafeteria_admin' and cap<>all(array['cafeteria:catalog:read','cafeteria:catalog:manage','cafeteria:pos:memberships:manage','cafeteria:registers:manage','cafeteria:register_assignments:manage','cafeteria:pos:purchases:read','cafeteria:pos:sessions:read']) then return false; end if;
 return exists(select 1 from pikas_private.role_capabilities rc where rc.scope_kind=case p_code when 'school_admin' then 'school' else 'cafeteria' end and rc.role_code=p_code and rc.capability=cap);
end $$;

create or replace function public.school_wallet_access(p_school_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare a uuid; pov boolean;
begin
 select s.account_id into a from public.schools s where s.id=p_school_id;
 pov:=exists(select 1 from pikas_private.sandbox_validated_pov());
 return jsonb_build_object('school_id',p_school_id,
  'read',a is not null and pikas_private.sandbox_admin_has_capability('school_admin','school:wallets:read',a,p_school_id),
  'replenish',a is not null and not pov and pikas_private.has_capability('school:wallets:replenish',a,p_school_id),
  'reverse',a is not null and not pov and pikas_private.has_capability('school:wallets:reverse_replenishment',a,p_school_id),
  'adjust',a is not null and not pov and pikas_private.has_capability('school:wallets:administrative_adjust',a,p_school_id));
end $$;

do $wallet_report$
declare src text; def text;
begin
 select pg_get_functiondef(p.oid) into def from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='school_wallet_report';
 if def is null then raise exception 'school_wallet_report_missing'; end if;
 -- The school admin authority (require_school_admin → sandbox_admin_has_capability) now decides inside the Demo; the blanket POV refusal is removed verbatim.
 src:=regexp_replace(def,'if\s+exists\(select\s+1\s+from\s+pikas_private\.sandbox_validated_pov\(\)\)\s+then\s+raise\s+exception\s+using\s+errcode=''42501'',\s*message=''wallet_report_authority_required'';\s*end\s+if;','','g');
 if src=def or src ~ 'wallet_report_authority_required' then raise exception 'school_wallet_report_pov_refusal_not_found'; end if;
 execute src;
end $wallet_report$;

-- ───────────────────────── 4. Restaurar escenario inicial ─────────────────────────
-- The reset names its sandbox in a transaction-local setting; history-preservation triggers admit a DELETE
-- only for rows that belong to that sandbox account. Nothing else can set it through the API.
create function pikas_private.sandbox_reset_allows(p_row jsonb) returns boolean
language plpgsql security definer set search_path='' as $$
declare target text:=nullif(current_setting('pikas.sandbox_reset_account',true),''); acc uuid;
begin
 if target is null or p_row is null then return false; end if;
 acc:=(p_row->>'account_id')::uuid;
 if acc is null and p_row ? 'purchase_id' then select account_id into acc from public.purchases where id=(p_row->>'purchase_id')::uuid; end if;
 if acc is null and p_row ? 'tender_id' then select account_id into acc from public.purchase_tenders where id=(p_row->>'tender_id')::uuid; end if;
 if acc is null and p_row ? 'refund_id' then select account_id into acc from public.refunds where id=(p_row->>'refund_id')::uuid; end if;
 if acc is null and p_row ? 'session_id' then select account_id into acc from public.register_sessions where id=(p_row->>'session_id')::uuid; end if;
 return acc is not null and acc::text=target and exists(select 1 from public.accounts a where a.id=acc and a.tenant_kind='sandbox');
end $$;

create or replace function pikas_private.reject_purchase_history_mutation() returns trigger
language plpgsql set search_path='' as $$
begin
 if tg_op='DELETE' and pikas_private.sandbox_reset_allows(to_jsonb(old)) then return old; end if;
 raise exception using errcode='23514',message='purchase_financial_history_is_immutable';
end $$;
create or replace function pikas_private.reject_pos_history_delete() returns trigger
language plpgsql set search_path='' as $$
begin
 if tg_op='DELETE' and pikas_private.sandbox_reset_allows(to_jsonb(old)) then return old; end if;
 raise exception using errcode='23514',message='pos_register_history_is_preserved';
end $$;
create or replace function pikas_private.reject_wallet_history_mutation() returns trigger
language plpgsql set search_path='' as $$
begin
 if tg_op='DELETE' and pikas_private.sandbox_reset_allows(to_jsonb(old)) then return old; end if;
 raise exception using errcode='23514',message='wallet_financial_history_is_immutable';
end $$;
create or replace function pikas_private.reject_staff_receivable_mutation() returns trigger
language plpgsql set search_path='' as $$
begin
 if tg_op='DELETE' and pikas_private.sandbox_reset_allows(to_jsonb(old)) then return old; end if;
 raise exception using errcode='23514',message='STAFF_RECEIVABLE_HISTORY_IMMUTABLE';
end $$;
create or replace function pikas_private.guard_financial_approval_transition() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if tg_op='DELETE' then
  if pikas_private.sandbox_reset_allows(to_jsonb(old)) then return old; end if;
  raise exception using errcode='23514',message='approval_history_is_immutable';
 end if;
 if (to_jsonb(old)-array['consumed_refund_id','consumed_at','revoked_at','revoked_by_person_id'])
 is distinct from (to_jsonb(new)-array['consumed_refund_id','consumed_at','revoked_at','revoked_by_person_id'])
 or old.consumed_refund_id is not null or old.revoked_at is not null
 or not ((new.consumed_refund_id is not null and new.revoked_at is null) or (new.revoked_at is not null and new.consumed_refund_id is null)) then
 raise exception using errcode='23514',message='invalid_approval_transition'; end if;
 return new;
end $$;
create or replace function pikas_private.guard_replenishment_request() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if tg_op = 'DELETE' then
  if pikas_private.sandbox_reset_allows(to_jsonb(old)) then return old; end if;
  raise exception using errcode = '55000', message = 'REPLENISHMENT_REQUEST_IMMUTABLE';
 end if;
 if old.state <> 'submitted' or new.state not in ('posted','rejected')
  or (to_jsonb(new) - array['state','wallet_id','decided_by','decided_at','rejection_reason','posted_at','wallet_replenishment_id','decision_request_key','decision_fingerprint'])
   <> (to_jsonb(old) - array['state','wallet_id','decided_by','decided_at','rejection_reason','posted_at','wallet_replenishment_id','decision_request_key','decision_fingerprint']) then
  raise exception using errcode = '55000', message = 'REPLENISHMENT_REQUEST_IMMUTABLE';
 end if;
 return new;
end $$;
create or replace function pikas_private.guard_staff_receivable_account() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if tg_op='DELETE' then
  if pikas_private.sandbox_reset_allows(to_jsonb(old)) then return old; end if;
  raise exception using errcode='23514',message='STAFF_RECEIVABLE_HISTORY_IMMUTABLE';
 end if;
 if tg_op='UPDATE' then
  if row(new.account_id,new.school_id,new.staff_affiliation_id,new.currency_code,new.created_at) is distinct from row(old.account_id,old.school_id,old.staff_affiliation_id,old.currency_code,old.created_at)
   or ((new.current_balance_minor is distinct from old.current_balance_minor or new.balance_version is distinct from old.balance_version) and pg_catalog.pg_trigger_depth()<2) then
   raise exception using errcode='23514',message='STAFF_RECEIVABLE_BALANCE_REQUIRES_POSTING';
  end if;
  if new.config_version<>old.config_version and new.config_version<>old.config_version+1 then raise exception using errcode='23514',message='INVALID_CONFIG_VERSION'; end if;
  new.updated_at:=clock_timestamp();
 end if;
 return new;
end $$;
create or replace function pikas_private.guard_staff_receivable_entry() returns trigger
language plpgsql security definer set search_path='' as $$
declare account_row public.staff_receivable_accounts%rowtype;
begin
 if tg_op='DELETE' and pikas_private.sandbox_reset_allows(to_jsonb(old)) then return old; end if;
 if tg_op<>'INSERT' then raise exception using errcode='23514',message='STAFF_RECEIVABLE_HISTORY_IMMUTABLE'; end if;
 select * into account_row from public.staff_receivable_accounts where id=new.receivable_account_id for update;
 if not found then raise exception using errcode='23503',message='STAFF_RECEIVABLE_ACCOUNT_MISSING'; end if;
 if new.account_id<>account_row.account_id or new.school_id<>account_row.school_id or new.currency_code<>account_row.currency_code
  or new.balance_version_after<>account_row.balance_version+1 or new.balance_after_minor::numeric<>account_row.current_balance_minor::numeric+new.amount_minor::numeric or new.balance_after_minor<0 then
  raise exception using errcode='23514',message='STAFF_RECEIVABLE_BALANCE_MISMATCH';
 end if;
 update public.staff_receivable_accounts set current_balance_minor=new.balance_after_minor, balance_version=new.balance_version_after,updated_at=new.occurred_at where id=account_row.id;
 return new;
end $$;
create or replace function pikas_private.guard_receipt_print_job() returns trigger
language plpgsql security definer set search_path='' as $$
declare source_kind text;
begin
 if tg_op='DELETE' then
  if pikas_private.sandbox_reset_allows(to_jsonb(old)) then return old; end if;
  raise exception using errcode='23514',message='RECEIPT_PRINT_HISTORY_IMMUTABLE';
 end if;
 if tg_op='INSERT' then
  if new.job_kind='reprint' then
   select j.job_kind into source_kind from public.receipt_print_jobs j where j.id=new.source_job_id and j.purchase_id=new.purchase_id;
   if source_kind is distinct from 'original' then raise exception using errcode='23514',message='REPRINT_SOURCE_MUST_BE_ORIGINAL'; end if;
  end if;
  return new;
 end if;
 if row(new.account_id,new.school_id,new.school_location_id,new.cafeteria_id,new.purchase_id,new.job_kind,new.source_job_id,new.requested_by_person_id,new.requested_at,new.template_version,
   new.receipt_snapshot,new.reprint_reason_code,new.request_key,new.payload_fingerprint,new.created_at)
   is distinct from
   row(old.account_id,old.school_id,old.school_location_id,old.cafeteria_id,old.purchase_id,old.job_kind,old.source_job_id,old.requested_by_person_id,old.requested_at,old.template_version,
   old.receipt_snapshot,old.reprint_reason_code,old.request_key,old.payload_fingerprint,old.created_at) then
  raise exception using errcode='23514',message='RECEIPT_PRINT_EVIDENCE_IMMUTABLE';
 end if;
 if old.state='pending' and new.state='dispatching' then
  if new.attempt_count<>old.attempt_count+1 or new.claim_token is null or new.claimed_by_person_id is null or new.claimed_by_membership_id is null
    or new.claimed_at is null or new.claim_expires_at<=new.claimed_at then raise exception using errcode='23514',message='INVALID_STATE'; end if;
 elsif old.state='dispatching' and new.state in ('submitted','failed','uncertain') then
  if new.attempt_count<>old.attempt_count or old.claim_token is null then raise exception using errcode='23514',message='INVALID_STATE'; end if;
  if new.state='submitted' and new.submitted_at is null then raise exception using errcode='23514',message='INVALID_STATE';
  elsif new.state='failed' and new.last_error_code not in ('BRIDGE_UNAVAILABLE','PRINTER_UNAVAILABLE','SUBMISSION_REJECTED') then raise exception using errcode='23514',message='INVALID_STATE';
  elsif new.state='uncertain' and new.last_error_code not in ('SUBMISSION_TIMEOUT','CLAIM_EXPIRED') then raise exception using errcode='23514',message='INVALID_STATE';
  end if;
 elsif old.state in ('failed','uncertain') and new.state='pending' then
  if new.attempt_count<>old.attempt_count then raise exception using errcode='23514',message='INVALID_STATE'; end if;
 else
  raise exception using errcode='23514',message='INVALID_STATE';
 end if;
 return new;
end $$;

-- The Horizonte baseline (Step 4C dataset, fixed ids 4c000000-0000-4000-8000-…) as a reusable seed, plus the
-- Demo personas with unmistakably fictional names. Idempotent on an emptied sandbox; refuses non-sandbox accounts.
create function pikas_private.sandbox_seed_horizonte(p_account uuid, p_actor uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare sch uuid; loc uuid; caf uuid; prefix constant text:='4c000000-0000-4000-8000-'; r record; share uuid; membership uuid; jose uuid;
 fictional_person uuid; student_id uuid; wallet_id uuid; adjustment_id uuid; stamp timestamptz:=clock_timestamp(); seeded jsonb:='{}'::jsonb;
begin
 if not exists(select 1 from public.accounts where id=p_account and tenant_kind='sandbox') then raise exception using errcode='42501',message='sandbox_required'; end if;
 select s.id into sch from public.schools s where s.account_id=p_account order by s.created_at limit 1;
 select l.id into loc from public.school_locations l where l.account_id=p_account and l.school_id=sch order by l.created_at limit 1;
 select c.id into caf from public.cafeterias c where c.account_id=p_account and c.school_id=sch and c.school_location_id=loc order by c.created_at limit 1;
 if sch is null or loc is null or caf is null then raise exception using errcode='23514',message='sandbox_baseline_structure_missing'; end if;
 update public.school_locations set status='active' where account_id=p_account and status<>'active';
 update public.cafeterias set status='active' where account_id=p_account and status<>'active';
 update public.schools set status='active' where account_id=p_account and status<>'active';
 -- Personas: active memberships, fictional names.
 for r in select pr.*, p.display_name from pikas_private.sandbox_pov_personas pr join public.persons p on p.id=pr.person_id where pr.account_id=p_account and pr.status='active' loop
  update public.persons set status='active',display_name=case r.pov_code when 'school_admin' then 'María Carey' when 'cafeteria_admin' then 'Bruno Mars' else 'José Ramírez' end
   where id=r.person_id and (status<>'active' or display_name is distinct from case r.pov_code when 'school_admin' then 'María Carey' when 'cafeteria_admin' then 'Bruno Mars' else 'José Ramírez' end);
  if r.pov_code='school_admin' then update public.school_memberships set status='active' where id=r.school_membership_id and status<>'active';
  else update public.cafeteria_memberships set status='active' where id=r.cafeteria_membership_id and status<>'active'; end if;
  if r.pov_code='cashier' then jose:=r.person_id; membership:=r.cafeteria_membership_id; end if;
 end loop;
 if jose is null then raise exception using errcode='23514',message='sandbox_baseline_cashier_missing'; end if;
 update public.cafeteria_operation_settings set scheduling_enabled=false,version=version+1 where cafeteria_id=caf and scheduling_enabled;
 -- Sharing + eligibility categories.
 select id into share from public.school_cafeteria_shares where cafeteria_id=caf and account_id=p_account and school_id=sch and status='active' order by created_at limit 1;
 if share is null then
  share:=(prefix||lpad('1',12,'0'))::uuid;
  insert into public.school_cafeteria_shares(id,account_id,school_id,cafeteria_id) values(share,p_account,sch,caf);
 end if;
 for r in select category,n from (values('basic_identification',2),('student_code',3),('placement',4),('dietary_restrictions',5)) v(category,n) loop
  insert into public.school_cafeteria_share_categories(id,account_id,school_id,cafeteria_id,share_id,category,enabled)
   values((prefix||lpad(r.n::text,12,'0'))::uuid,p_account,sch,caf,share,r.category,true)
   on conflict(share_id,category) do update set enabled=true where not school_cafeteria_share_categories.enabled;
 end loop;
 -- Caja + José's assignment.
 insert into public.cafeteria_registers(id,account_id,school_id,school_location_id,cafeteria_id,register_code,display_name)
  values((prefix||lpad('10',12,'0'))::uuid,p_account,sch,loc,caf,'HZ-01','Caja demo Horizonte');
 insert into public.cafeteria_register_assignments(id,account_id,school_id,school_location_id,cafeteria_id,cafeteria_membership_id,operator_person_id,register_id)
  values((prefix||lpad('11',12,'0'))::uuid,p_account,sch,loc,caf,membership,jose,(prefix||lpad('10',12,'0'))::uuid);
 -- Catalog.
 insert into public.cafeteria_product_categories(id,account_id,school_id,cafeteria_id,name,display_order)
  values((prefix||lpad('20',12,'0'))::uuid,p_account,sch,caf,'Bebidas',1),((prefix||lpad('21',12,'0'))::uuid,p_account,sch,caf,'Alimentos',2);
 for r in select * from (values
  (30,'Agua natural',2500,20,array['agua'],array[]::text[]),
  (31,'Jugo de naranja',5500,20,array['naranja','agua'],array[]::text[]),
  (32,'Fruta de temporada',4500,21,array['fruta fresca'],array[]::text[]),
  (33,'Sándwich de pollo',9500,21,array['pan','pollo','queso'],array['gluten','milk']),
  (34,'Empanada de vegetales',6500,21,array['harina','vegetales'],array['gluten']),
  (35,'Yogur natural',6000,21,array['leche','cultivos lácticos'],array['milk'])
 ) v(n,name,price,category,ingredients,allergens) loop
  insert into public.cafeteria_products(id,account_id,school_id,cafeteria_id,category_id,name,description,price_minor,ingredients,allergens)
   values((prefix||lpad(r.n::text,12,'0'))::uuid,p_account,sch,caf,(prefix||lpad(r.category::text,12,'0'))::uuid,r.name,'Producto ficticio del sandbox Horizonte',r.price,r.ingredients,r.allergens);
 end loop;
 -- Students with wallets, limits, eligibility.
 for r in select * from (values
  (1,'Luna','Castillo',120000,35000,20000,'active'),(2,'Mateo','Ventura',4000,25000,15000,'active'),
  (3,'Alma','Robles',60000,10000,8000,'active'),(4,'Bruno','Peña',50000,0,0,'frozen')
 ) v(n,first_name,last_name,balance,daily_limit,transaction_limit,wallet_status) loop
  fictional_person:=(prefix||lpad((100+r.n)::text,12,'0'))::uuid; student_id:=(prefix||lpad((200+r.n)::text,12,'0'))::uuid;
  wallet_id:=(prefix||lpad((600+r.n)::text,12,'0'))::uuid; adjustment_id:=(prefix||lpad((700+r.n)::text,12,'0'))::uuid;
  insert into public.persons(id,display_name,status,auth_user_id) values(fictional_person,r.first_name||' '||r.last_name,'active',null);
  insert into public.students(id,account_id,school_id,person_id,student_code,first_name,last_name,display_name)
   values(student_id,p_account,sch,fictional_person,'DEMO-HZ-00'||r.n,r.first_name,r.last_name,r.first_name||' '||r.last_name);
  insert into public.student_enrollments(id,account_id,school_id,student_id,starts_on) values((prefix||lpad((300+r.n)::text,12,'0'))::uuid,p_account,sch,student_id,'2026-08-01');
  insert into public.student_campus_placements(id,account_id,school_id,enrollment_id,school_location_id,grade_label,class_label,starts_on)
   values((prefix||lpad((400+r.n)::text,12,'0'))::uuid,p_account,sch,(prefix||lpad((300+r.n)::text,12,'0'))::uuid,loc,'4.º primaria','A','2026-08-01');
  insert into public.cafeteria_customers(id,account_id,school_id,cafeteria_id,student_id) values((prefix||lpad((500+r.n)::text,12,'0'))::uuid,p_account,sch,caf,student_id);
  insert into public.student_wallets(id,account_id,school_id,student_id,currency_code,current_balance_minor,balance_version,status)
   values(wallet_id,p_account,sch,student_id,'DOP',r.balance,1,r.wallet_status);
  insert into public.wallet_adjustments(id,account_id,school_id,wallet_id,currency_code,amount_minor,reason_code,explanatory_note,actor_person_id,posted_at,idempotency_key,payload_fingerprint)
   values(adjustment_id,p_account,sch,wallet_id,'DOP',r.balance,'administrative_correction','Capital inicial ficticio del sandbox; no dinero real.',p_actor,stamp,
    'sandbox_seed:'||p_account||':'||stamp::text||':'||r.n,encode(extensions.digest(convert_to('sandbox_seed:'||p_account||':'||stamp::text||':'||r.n||':'||r.balance,'UTF8'),'sha256'),'hex'));
  insert into public.wallet_ledger_entries(id,account_id,school_id,wallet_id,currency_code,entry_type,amount_minor,balance_after_minor,balance_version_after,adjustment_id,occurred_at)
   values((prefix||lpad((800+r.n)::text,12,'0'))::uuid,p_account,sch,wallet_id,'DOP','adjustment',r.balance,r.balance,1,adjustment_id,stamp);
  insert into public.student_spending_controls(id,account_id,school_id,student_id,currency_code,daily_limit_enabled,daily_limit_minor,per_transaction_limit_enabled,per_transaction_limit_minor,updated_by_person_id)
   values((prefix||lpad((900+r.n)::text,12,'0'))::uuid,p_account,sch,student_id,'DOP',r.daily_limit>0,r.daily_limit,r.transaction_limit>0,r.transaction_limit,p_actor);
 end loop;
 insert into public.student_dietary_restrictions(id,account_id,school_id,student_id,restriction_type,restriction_code,display_label,starts_on)
  values((prefix||lpad('1001',12,'0'))::uuid,p_account,sch,(prefix||lpad('203',12,'0'))::uuid,'allergen','milk','Alergia a leche','2026-08-01');
 seeded:=jsonb_build_object('students',4,'products',6,'categories',2,'registers',1,'assignments',1,'personas',(select count(*) from pikas_private.sandbox_pov_personas where account_id=p_account and status='active'),'baseline','horizonte-v1');
 return seeded;
end $$;

create function public.platform_reset_sandbox(p_request_id uuid, p_account_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid; auth_actor uuid; payload jsonb; fingerprint text; replay jsonb; acct public.accounts%rowtype; sch uuid; caf uuid;
 deleted jsonb:='{}'::jsonb; n bigint; persona_persons uuid[]; retired uuid[]; auth_ids uuid[]; usernames text[]; seeded jsonb; result jsonb; r record;
begin
 actor:=pikas_private.require_platform_capability('platform:sandbox:manage');
 auth_actor:=auth.uid();
 perform pikas_private.require_no_current_demo();
 if p_request_id is null or p_account_id is null then raise exception using errcode='22023',message='invalid_sandbox_reset_request'; end if;
 payload:=jsonb_build_object('account_id',p_account_id,'operation','sandbox_reset');
 fingerprint:=pikas_private.platform_request_fingerprint(payload);
 replay:=pikas_private.platform_replay_request(p_request_id,'sandbox_reset',fingerprint,actor);
 if replay is not null then return replay; end if;
 select * into acct from public.accounts where id=p_account_id for update;
 if not found or acct.tenant_kind<>'sandbox' then raise exception using errcode='42501',message='sandbox_required'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_account_id::text,20261117));
 select s.id into sch from public.schools s where s.account_id=p_account_id order by s.created_at limit 1;
 select c.id into caf from public.cafeterias c where c.account_id=p_account_id order by c.created_at limit 1;
 -- Every Demo session on this sandbox ends (append-only history keeps the sessions themselves).
 update pikas_private.sandbox_pov_sessions set status='exited',ended_at=clock_timestamp(),end_reason='sandbox_reset' where account_id=p_account_id and status='active';
 perform set_config('pikas.sandbox_reset_account',p_account_id::text,true);
 select coalesce(array_agg(person_id),'{}') into persona_persons from pikas_private.sandbox_pov_personas where account_id=p_account_id;

 -- Operational history, children first (every row carries the sandbox's account_id or resolves to it).
 delete from public.receipt_print_jobs where account_id=p_account_id; get diagnostics n=row_count; deleted:=deleted||jsonb_build_object('receipt_print_jobs',n);
 delete from public.financial_approvals where account_id=p_account_id; get diagnostics n=row_count; deleted:=deleted||jsonb_build_object('financial_approvals',n);
 delete from public.staff_receivable_entries where account_id=p_account_id; get diagnostics n=row_count; deleted:=deleted||jsonb_build_object('staff_receivable_entries',n);
 delete from public.staff_receivable_settlements where account_id=p_account_id; get diagnostics n=row_count; deleted:=deleted||jsonb_build_object('staff_receivable_settlements',n);
 delete from public.refund_cash_outflows where refund_id in (select id from public.refunds where account_id=p_account_id); get diagnostics n=row_count; deleted:=deleted||jsonb_build_object('refund_cash_outflows',n);
 delete from public.refund_items where refund_id in (select id from public.refunds where account_id=p_account_id); get diagnostics n=row_count; deleted:=deleted||jsonb_build_object('refund_items',n);
 delete from public.student_daily_spend_events where account_id=p_account_id; get diagnostics n=row_count; deleted:=deleted||jsonb_build_object('student_daily_spend_events',n);
 delete from public.wallet_ledger_entries where account_id=p_account_id; get diagnostics n=row_count; deleted:=deleted||jsonb_build_object('wallet_ledger_entries',n);
 delete from public.wallet_refund_credits where account_id=p_account_id; get diagnostics n=row_count; deleted:=deleted||jsonb_build_object('wallet_refund_credits',n);
 delete from public.refunds where account_id=p_account_id; get diagnostics n=row_count; deleted:=deleted||jsonb_build_object('refunds',n);
 delete from public.purchase_cash_tenders where tender_id in (select id from public.purchase_tenders where account_id=p_account_id); get diagnostics n=row_count; deleted:=deleted||jsonb_build_object('purchase_cash_tenders',n);
 delete from public.purchase_wallet_tenders where account_id=p_account_id; get diagnostics n=row_count; deleted:=deleted||jsonb_build_object('purchase_wallet_tenders',n);
 delete from public.purchase_staff_credit_tenders where account_id=p_account_id; get diagnostics n=row_count; deleted:=deleted||jsonb_build_object('purchase_staff_credit_tenders',n);
 delete from public.wallet_purchase_debits where account_id=p_account_id; get diagnostics n=row_count; deleted:=deleted||jsonb_build_object('wallet_purchase_debits',n);
 delete from public.purchase_tenders where account_id=p_account_id; get diagnostics n=row_count; deleted:=deleted||jsonb_build_object('purchase_tenders',n);
 delete from public.purchase_items where account_id=p_account_id; get diagnostics n=row_count; deleted:=deleted||jsonb_build_object('purchase_items',n);
 delete from public.purchases where account_id=p_account_id; get diagnostics n=row_count; deleted:=deleted||jsonb_build_object('purchases',n);
 delete from pikas_private.register_close_reconciliations where session_id in (select id from public.register_sessions where account_id=p_account_id);
 delete from public.register_sessions where account_id=p_account_id; get diagnostics n=row_count; deleted:=deleted||jsonb_build_object('register_sessions',n);
 delete from public.wallet_replenishment_reversals where account_id=p_account_id; get diagnostics n=row_count; deleted:=deleted||jsonb_build_object('wallet_replenishment_reversals',n);
 delete from public.replenishment_requests where account_id=p_account_id; get diagnostics n=row_count; deleted:=deleted||jsonb_build_object('replenishment_requests',n);
 delete from public.wallet_replenishments where account_id=p_account_id; get diagnostics n=row_count; deleted:=deleted||jsonb_build_object('wallet_replenishments',n);
 delete from public.wallet_adjustments where account_id=p_account_id; get diagnostics n=row_count; deleted:=deleted||jsonb_build_object('wallet_adjustments',n);
 delete from public.student_spending_controls where account_id=p_account_id; get diagnostics n=row_count; deleted:=deleted||jsonb_build_object('student_spending_controls',n);
 delete from public.student_wallets where account_id=p_account_id; get diagnostics n=row_count; deleted:=deleted||jsonb_build_object('student_wallets',n);
 delete from public.staff_receivable_accounts where account_id=p_account_id; get diagnostics n=row_count; deleted:=deleted||jsonb_build_object('staff_receivable_accounts',n);
 delete from public.cafeteria_customers where account_id=p_account_id; get diagnostics n=row_count; deleted:=deleted||jsonb_build_object('cafeteria_customers',n);
 delete from public.family_student_relationships where account_id=p_account_id;
 delete from public.family_guardians where account_id=p_account_id;
 delete from public.families where account_id=p_account_id;
 delete from public.student_guardians where account_id=p_account_id;
 delete from public.student_dietary_restrictions where account_id=p_account_id;
 delete from public.student_campus_placements where account_id=p_account_id;
 delete from public.student_enrollments where account_id=p_account_id;
 delete from public.staff_campus_affiliations where account_id=p_account_id;
 delete from public.school_staff_affiliations where account_id=p_account_id;
 delete from public.school_person_contacts where account_id=p_account_id;
 delete from public.students where account_id=p_account_id; get diagnostics n=row_count; deleted:=deleted||jsonb_build_object('students',n);
 delete from public.cafeteria_register_assignments where account_id=p_account_id; get diagnostics n=row_count; deleted:=deleted||jsonb_build_object('register_assignments',n);
 delete from public.cafeteria_registers where account_id=p_account_id; get diagnostics n=row_count; deleted:=deleted||jsonb_build_object('registers',n);
 delete from public.cafeteria_menu_products where account_id=p_account_id;
 delete from public.cafeteria_service_shift_days where account_id=p_account_id;
 delete from public.cafeteria_service_shifts where account_id=p_account_id;
 delete from public.cafeteria_menus where account_id=p_account_id; get diagnostics n=row_count; deleted:=deleted||jsonb_build_object('menus',n);
 delete from public.cafeteria_products where account_id=p_account_id; get diagnostics n=row_count; deleted:=deleted||jsonb_build_object('products',n);
 delete from public.cafeteria_product_categories where account_id=p_account_id; get diagnostics n=row_count; deleted:=deleted||jsonb_build_object('categories',n);
 delete from pikas_private.provisioning_username_requests where source_id in (select id from public.invitations where account_id=p_account_id);
 delete from public.invitations where account_id=p_account_id; get diagnostics n=row_count; deleted:=deleted||jsonb_build_object('invitations',n);
 -- Request journals (cafeteria_admin_requests, school_admin_requests, student_bulk_requests, platform_requests) are
 -- idempotency history referenced by audit rows: kept, like the audit itself.

 -- People created inside the sandbox (never the baseline personas): memberships removed, logins retired,
 -- persons kept as inactive history (audit rows point at them). Their Auth users are returned for the caller.
 select coalesce(array_agg(distinct person_id),'{}') into retired from (
  select person_id from public.cafeteria_memberships where account_id=p_account_id
  union select person_id from public.school_memberships where account_id=p_account_id
  union select person_id from public.account_memberships where account_id=p_account_id) m where person_id<>all(persona_persons);
 delete from public.cafeteria_memberships where account_id=p_account_id and person_id=any(retired); get diagnostics n=row_count; deleted:=deleted||jsonb_build_object('staff_memberships',n);
 delete from public.school_memberships where account_id=p_account_id and person_id=any(retired);
 delete from public.account_memberships where account_id=p_account_id and person_id=any(retired);
 -- Only persons whose every remaining membership is gone are retired (a person also present in a real customer is left alone).
 select coalesce(array_agg(p.id),'{}') into retired from public.persons p where p.id=any(retired)
  and not exists(select 1 from public.cafeteria_memberships where person_id=p.id) and not exists(select 1 from public.school_memberships where person_id=p.id)
  and not exists(select 1 from public.account_memberships where person_id=p.id) and not exists(select 1 from pikas_private.platform_memberships where person_id=p.id);
 select coalesce(array_agg(li.username),'{}') into usernames from pikas_private.login_identities li where li.person_id=any(retired) and li.username is not null;
 select coalesce(array_agg(p.auth_user_id),'{}') into auth_ids from public.persons p where p.id=any(retired) and p.auth_user_id is not null;
 delete from pikas_private.reserved_usernames where username=any(usernames);
 delete from pikas_private.login_identities where person_id=any(retired);
 for r in select unnest(auth_ids) id loop perform pikas_private.end_identity_sessions(r.id); end loop;
 update public.persons set status='inactive' where id=any(retired) and status<>'inactive';
 deleted:=deleted||jsonb_build_object('people_retired',coalesce(array_length(retired,1),0));
 -- Student persons of the former dataset have no identity and no audit actor rows: removed when nothing references them.
 delete from public.persons p where p.auth_user_id is null and p.id<>all(persona_persons) and p.id::text like '4c000000-0000-4000-8000-%'
  and not exists(select 1 from public.audit_events e where e.actor_person_id=p.id)
  and not exists(select 1 from public.students s where s.person_id=p.id)
  and not exists(select 1 from pikas_private.platform_memberships where person_id=p.id);

 seeded:=pikas_private.sandbox_seed_horizonte(p_account_id,actor);
 perform set_config('pikas.sandbox_reset_account','',true);
 result:=jsonb_build_object('request_id',p_request_id,'account_id',p_account_id,'baseline',seeded->>'baseline','deleted',deleted,'seeded',seeded,
  'auth_user_ids',to_jsonb(auth_ids),'reset_at',clock_timestamp());
 insert into pikas_private.platform_requests(request_id,operation,request_fingerprint,actor_auth_user_id,actor_person_id,response)
  values(p_request_id,'sandbox_reset',fingerprint,auth_actor,actor,result);
 perform pikas_private.record_platform_audit(p_request_id,actor,auth_actor,'platform:sandbox:manage','sandbox_reset','sandbox_reset',
  p_account_id,sch,null,caf,null,null,jsonb_build_object('deleted',deleted,'seeded',seeded,'retired_auth_users',coalesce(array_length(auth_ids,1),0)));
 insert into public.audit_events(actor_person_id,authenticated_user_id,actor_role,actor_scope_kind,account_id,school_id,cafeteria_id,action,target_type,target_id,request_id,outcome,before_metadata,after_metadata)
  values(actor,auth_actor,'platform_operator','platform',p_account_id,sch,caf,'sandbox_reset','accounts',p_account_id,p_request_id,'succeeded',deleted,seeded);
 return result;
end $$;

-- ───────────────────────── 5. Demo Lab read ─────────────────────────
create function public.platform_demo_lab_read() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare actor uuid; result jsonb;
begin
 actor:=pikas_private.require_platform_capability('platform:sandbox:pov:enter');
 select jsonb_build_object(
  'can_reset',pikas_private.platform_has_capability('platform:sandbox:manage'),
  'active',public.platform_get_active_sandbox_pov(),
  'sandboxes',coalesce((select jsonb_agg(jsonb_build_object(
    'account_id',a.id,'name',a.name,'code',a.code,'status',a.status,'baseline','horizonte-v1',
    'school',(select jsonb_build_object('school_id',s.id,'name',s.name,'status',s.status) from public.schools s where s.account_id=a.id order by s.created_at limit 1),
    'locations',coalesce((select jsonb_agg(jsonb_build_object('location_id',l.id,'name',l.name,'status',l.status,
      'cafeterias',coalesce((select jsonb_agg(jsonb_build_object('cafeteria_id',c.id,'name',c.name,'status',c.status,
        'registers',coalesce((select jsonb_agg(jsonb_build_object('register_id',rg.id,'name',rg.display_name,'code',rg.register_code,'status',rg.status) order by rg.display_name) from public.cafeteria_registers rg where rg.cafeteria_id=c.id),'[]'::jsonb),
        'products',(select count(*) from public.cafeteria_products p where p.cafeteria_id=c.id and p.active),
        'staff',(select count(*) from public.cafeteria_memberships m where m.cafeteria_id=c.id and m.status='active' and m.role_code in ('pos_cashier','pos_supervisor')),
        'purchases',(select count(*) from public.purchases p where p.cafeteria_id=c.id),
        'open_sessions',(select count(*) from public.register_sessions rs where rs.cafeteria_id=c.id and rs.status='open')) order by c.name)
       from public.cafeterias c where c.school_location_id=l.id),'[]'::jsonb)) order by l.name) from public.school_locations l where l.account_id=a.id),'[]'::jsonb),
    'students',(select count(*) from public.students st where st.account_id=a.id and st.status='active'),
    'eligible_students',(select count(*) from public.cafeteria_customers cc where cc.account_id=a.id and cc.status='active'),
    'personas',coalesce((select jsonb_agg(jsonb_build_object('persona_id',pr.id,'pov_code',pr.pov_code,'display_name',pp.display_name,'school_id',pr.school_id,
       'cafeteria_id',pr.cafeteria_id,'cafeteria_name',cf.name,'location_name',lo.name,
       'membership_status',coalesce((select m.status from public.cafeteria_memberships m where m.id=pr.cafeteria_membership_id),(select m.status from public.school_memberships m where m.id=pr.school_membership_id)),
       'valid',pikas_private.sandbox_persona_valid(pr.id),
       'registers',coalesce((select jsonb_agg(rg.display_name order by rg.display_name) from public.cafeteria_register_assignments ra join public.cafeteria_registers rg on rg.id=ra.register_id
          where ra.cafeteria_membership_id=pr.cafeteria_membership_id and ra.status='active' and rg.status='active'),'[]'::jsonb))
      order by case pr.pov_code when 'school_admin' then 1 when 'cafeteria_admin' then 2 else 3 end)
     from pikas_private.sandbox_pov_personas pr join public.persons pp on pp.id=pr.person_id join public.cafeterias cf on cf.id=pr.cafeteria_id
     join public.school_locations lo on lo.id=cf.school_location_id where pr.account_id=a.id and pr.status='active'),'[]'::jsonb),
    'sandbox_staff',coalesce((select jsonb_agg(jsonb_build_object('person_id',pp.id,'display_name',pp.display_name,'role_code',m.role_code,'status',m.status,'cafeteria_name',cf.name,
       'username',(select li.username from pikas_private.login_identities li where li.person_id=pp.id),'has_login',pp.auth_user_id is not null) order by pp.display_name)
     from public.cafeteria_memberships m join public.persons pp on pp.id=m.person_id join public.cafeterias cf on cf.id=m.cafeteria_id
     where m.account_id=a.id and m.status<>'inactive' and m.person_id<>all(coalesce((select array_agg(person_id) from pikas_private.sandbox_pov_personas where account_id=a.id),'{}'))),'[]'::jsonb),
    'last_reset',(select jsonb_build_object('at',e.occurred_at,'actor_name',p.display_name) from pikas_private.platform_audit_events e left join public.persons p on p.id=e.actor_person_id
       where e.target_account_id=a.id and e.reason_code='sandbox_reset' order by e.occurred_at desc limit 1),
    'last_entered',(select max(s.started_at) from pikas_private.sandbox_pov_sessions s where s.account_id=a.id)
   ) order by a.name) from public.accounts a where a.tenant_kind='sandbox'),'[]'::jsonb)) into result;
 return result;
end $$;

revoke all on function public.platform_reset_sandbox(uuid,uuid), public.platform_demo_lab_read() from public, anon, service_role;
grant execute on function public.platform_reset_sandbox(uuid,uuid), public.platform_demo_lab_read() to authenticated;
-- New private helpers are never browser-callable.
revoke all on function pikas_private.sandbox_identity_target(uuid), pikas_private.require_no_current_demo_except_sandbox_identity(uuid),
 pikas_private.sandbox_reset_allows(jsonb), pikas_private.sandbox_seed_horizonte(uuid,uuid) from public, anon, authenticated, service_role;

commit;
