-- Lifecycle & Access Management (narrow, additive). See docs/LIFECYCLE_MATRIX.md.
-- Three Platform commands over EXISTING status columns and one self-scoped read. No table, column,
-- capability, role, grant-table or data change; no delete anywhere.
--   platform_set_customer_structure_status  platform:tenant:lifecycle:manage   sede (active|inactive) / cafetería (active|suspended|inactive)
--   platform_set_customer_membership_status platform:customer:access:provision cafetería or colegio membership (active|suspended|inactive)
--   platform_grant_customer_pos_access      platform:customer:access:provision existing customer Person → POS role in a cafetería (same Person, same login)
--   identity_access_summary                 self                               own memberships with status + organization state
-- Every command: exact-request journal (platform_requests), expected-state check, reason where it
-- matters, Platform audit; cafetería membership changes are also written to the cafetería's own
-- audit (audit_events) as actor_role 'platform_operator'. pikas_private.scope_active already makes an
-- inactive sede or cafetería unavailable to every tenant authority, so no cascade is written.
begin;

-- Platform audit reason codes: widened for the three lifecycle actions (same additive pattern as earlier milestones).
alter table pikas_private.platform_audit_events drop constraint platform_audit_events_reason_code_check;
alter table pikas_private.platform_audit_events add constraint platform_audit_events_reason_code_check check (reason_code in (
 'owner_root_bootstrap','tenant_provisioned','school_location_added','customer_admin_intent_prepared','identity_linked','customer_admin_granted',
 'sandbox_pov_entered','sandbox_pov_exited','team_prepared','team_completed','team_demo_changed','customer_suspended','customer_reactivated',
 'customer_closed','customer_reopened','school_onboarded','customer_profile_updated','customer_structure_renamed','cafeteria_admin_granted','customer_person_renamed',
 'customer_structure_status_changed','customer_membership_status_changed','customer_pos_access_granted'));

create function public.platform_set_customer_structure_status(
 p_request_id uuid,p_account_id uuid,p_kind text,p_target_id uuid,p_expected_status text,p_status text,p_reason text
) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare actor uuid; auth_actor uuid; reason text:=nullif(btrim(coalesce(p_reason,'')),''); payload jsonb; fingerprint text; replay jsonb;
 current_status text; school uuid; location uuid; cafeteria uuid; open_sessions integer; result jsonb;
begin
 actor:=pikas_private.require_platform_capability('platform:tenant:lifecycle:manage');
 auth_actor:=auth.uid();
 if pikas_private.sandbox_pov_current_attempt() then raise exception using errcode='42501',message='customer_access_authority_required'; end if;
 if p_request_id is null or p_account_id is null or p_target_id is null or p_kind is null or p_kind not in ('location','cafeteria')
   or p_expected_status is null or p_status is null
   or (p_kind='location' and p_status not in ('active','inactive'))
   or (p_kind='cafeteria' and p_status not in ('active','suspended','inactive')) then
  raise exception using errcode='22023',message='invalid_structure_status_input';
 end if;
 if reason is null or length(reason)<3 or length(reason)>500 then raise exception using errcode='22023',message='lifecycle_reason_required'; end if;
 payload:=jsonb_build_object('account_id',p_account_id,'kind',p_kind,'target_id',p_target_id,'expected_status',p_expected_status,'status',p_status,'reason',reason);
 fingerprint:=pikas_private.platform_request_fingerprint(payload);
 replay:=pikas_private.platform_replay_request(p_request_id,'customer_structure_status',fingerprint,actor);
 if replay is not null then return replay; end if;

 perform 1 from public.accounts where id=p_account_id and tenant_kind='customer' for update;
 if not found then raise exception using errcode='23514',message='lifecycle_customer_only'; end if;
 perform 1 from public.accounts where id=p_account_id and status in ('active','suspended');
 if not found then raise exception using errcode='23514',message='customer_lifecycle_inactive'; end if;
 if p_kind='location' then
  select l.status,l.school_id,l.id into current_status,school,location from public.school_locations l where l.id=p_target_id and l.account_id=p_account_id for update;
 else
  select c.status,c.school_id,c.school_location_id,c.id into current_status,school,location,cafeteria from public.cafeterias c where c.id=p_target_id and c.account_id=p_account_id for update;
 end if;
 if not found then raise exception using errcode='42501',message='customer_access_scope_required'; end if;
 if current_status is distinct from p_expected_status then raise exception using errcode='23514',message='lifecycle_state_changed'; end if;
 if current_status=p_status then raise exception using errcode='23514',message='invalid_lifecycle_transition'; end if;
 -- Leaving operation never cuts an open caja: it is closed in the POS first (its own close, with reconciliation).
 if p_status<>'active' then
  select count(*) into open_sessions from public.register_sessions rs where rs.status='open'
   and ((p_kind='cafeteria' and rs.cafeteria_id=p_target_id) or (p_kind='location' and rs.cafeteria_id in (select id from public.cafeterias where school_location_id=p_target_id)));
  if open_sessions>0 then raise exception using errcode='23514',message='open_register_sessions_block_lifecycle'; end if;
 end if;
 -- A cafetería cannot be reactivated under an inactive sede: it would stay unavailable without saying so.
 if p_kind='cafeteria' and p_status='active' and not exists(select 1 from public.school_locations where id=location and status='active') then
  raise exception using errcode='23514',message='location_inactive';
 end if;
 if p_kind='location' then update public.school_locations set status=p_status where id=p_target_id and account_id=p_account_id;
 else update public.cafeterias set status=p_status where id=p_target_id and account_id=p_account_id; end if;

 result:=jsonb_build_object('account_id',p_account_id,'kind',p_kind,'target_id',p_target_id,'status',p_status,'previous_status',current_status);
 insert into pikas_private.platform_requests(request_id,operation,request_fingerprint,actor_auth_user_id,actor_person_id,response)
 values(p_request_id,'customer_structure_status',fingerprint,auth_actor,actor,result);
 perform pikas_private.record_platform_audit(p_request_id,actor,auth_actor,'platform:tenant:lifecycle:manage','customer_structure_status_changed',
  'customer_structure_status_changed',p_account_id,school,location,cafeteria,null,null,
  jsonb_build_object('kind',p_kind,'previous_status',current_status,'status',p_status,'reason',reason));
 return result;
end $$;

create function public.platform_set_customer_membership_status(
 p_request_id uuid,p_account_id uuid,p_scope text,p_membership_id uuid,p_expected_status text,p_status text,p_reason text
) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare actor uuid; auth_actor uuid; reason text:=nullif(btrim(coalesce(p_reason,'')),''); payload jsonb; fingerprint text; replay jsonb;
 person uuid; current_status text; role text; school uuid; location uuid; cafeteria uuid; result jsonb;
begin
 if p_request_id is null or p_account_id is null or p_membership_id is null or p_scope is null or p_scope not in ('cafeteria','school')
   or p_expected_status is null or p_status is null or p_status not in ('active','suspended','inactive') then
  raise exception using errcode='22023',message='invalid_membership_status_input';
 end if;
 if reason is null or length(reason)<3 or length(reason)>500 then raise exception using errcode='22023',message='lifecycle_reason_required'; end if;
 actor:=pikas_private.require_customer_provisioning(p_account_id,array['active','suspended']);
 auth_actor:=auth.uid();
 payload:=jsonb_build_object('account_id',p_account_id,'scope',p_scope,'membership_id',p_membership_id,'expected_status',p_expected_status,'status',p_status,'reason',reason);
 fingerprint:=pikas_private.platform_request_fingerprint(payload);
 replay:=pikas_private.platform_replay_request(p_request_id,'customer_membership_status',fingerprint,actor);
 if replay is not null then return replay; end if;

 if p_scope='cafeteria' then
  select m.person_id,m.status,m.role_code,m.school_id,c.school_location_id,m.cafeteria_id into person,current_status,role,school,location,cafeteria
  from public.cafeteria_memberships m join public.cafeterias c on c.id=m.cafeteria_id where m.id=p_membership_id and m.account_id=p_account_id for update of m;
 else
  select m.person_id,m.status,m.role_code,m.school_id into person,current_status,role,school
  from public.school_memberships m where m.id=p_membership_id and m.account_id=p_account_id and m.role_code='school_admin' for update;
 end if;
 if person is null then raise exception using errcode='42501',message='customer_access_scope_required'; end if;
 perform pikas_private.require_customer_person(p_account_id,person);
 if current_status is distinct from p_expected_status then raise exception using errcode='23514',message='lifecycle_state_changed'; end if;
 if current_status=p_status then raise exception using errcode='23514',message='invalid_lifecycle_transition'; end if;
 -- Reactivation needs an active Person with a confirmed, usable login (the existing identity rule).
 if p_status='active' then perform pikas_private.lock_cafeteria_pos_identity(person); end if;
 if p_scope='cafeteria' then update public.cafeteria_memberships set status=p_status where id=p_membership_id;
 else update public.school_memberships set status=p_status where id=p_membership_id; end if;

 result:=jsonb_build_object('account_id',p_account_id,'scope',p_scope,'membership_id',p_membership_id,'person_id',person,'role_code',role,'status',p_status,'previous_status',current_status);
 insert into pikas_private.platform_requests(request_id,operation,request_fingerprint,actor_auth_user_id,actor_person_id,response)
 values(p_request_id,'customer_membership_status',fingerprint,auth_actor,actor,result);
 perform pikas_private.record_platform_audit(p_request_id,actor,auth_actor,'platform:customer:access:provision','customer_membership_status_changed',
  'customer_membership_status_changed',p_account_id,school,location,cafeteria,person,null,
  jsonb_build_object('scope',p_scope,'membership_id',p_membership_id,'role_code',role,'previous_status',current_status,'status',p_status,'reason',reason));
 if p_scope='cafeteria' then
  perform pikas_private.record_pos_operational_audit(actor,auth_actor,'platform_operator',p_account_id,school,cafeteria,
   case when p_status='inactive' then 'pos_membership_revoked' else 'pos_membership_status_changed' end,'cafeteria_memberships',p_membership_id,
   jsonb_build_object('role_code',role,'status',current_status),jsonb_build_object('role_code',role,'status',p_status,'reason',reason));
 end if;
 return result;
end $$;

create function public.platform_grant_customer_pos_access(
 p_request_id uuid,p_account_id uuid,p_person_id uuid,p_cafeteria_id uuid,p_role_code text
) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare actor uuid; auth_actor uuid; payload jsonb; fingerprint text; replay jsonb; c public.cafeterias%rowtype;
 member uuid; member_status text; already boolean; result jsonb;
begin
 actor:=pikas_private.require_platform_capability('platform:customer:access:provision');
 auth_actor:=auth.uid();
 if p_request_id is null or p_account_id is null or p_person_id is null or p_cafeteria_id is null or p_role_code is null or p_role_code not in ('pos_cashier','pos_supervisor') then
  raise exception using errcode='22023',message='invalid_pos_access_grant';
 end if;
 payload:=jsonb_build_object('account_id',p_account_id,'person_id',p_person_id,'cafeteria_id',p_cafeteria_id,'role_code',p_role_code);
 fingerprint:=pikas_private.platform_request_fingerprint(payload);
 replay:=pikas_private.platform_replay_request(p_request_id,'customer_pos_access_grant',fingerprint,actor);
 if replay is not null then return replay; end if;
 perform pikas_private.require_customer_provisioning(p_account_id,array['active']);
 select * into c from public.cafeterias where id=p_cafeteria_id and account_id=p_account_id for share;
 if not found then raise exception using errcode='42501',message='customer_access_scope_required'; end if;
 if not pikas_private.scope_active(c.account_id,c.school_id,c.id) then raise exception using errcode='23514',message='inactive_cafeteria'; end if;
 -- The SAME customer Person (never another customer's, never a Platform person) with a usable login.
 perform pikas_private.require_customer_person(p_account_id,p_person_id);
 perform pikas_private.lock_cafeteria_pos_identity(p_person_id);
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(c.id::text||':'||p_person_id::text||':'||p_role_code,20261005));
 select id,status into member,member_status from public.cafeteria_memberships
  where person_id=p_person_id and cafeteria_id=c.id and role_code=p_role_code for update;
 if found and member_status<>'active' then raise exception using errcode='23505',message='existing_membership_not_active'; end if;
 already:=member is not null;
 if not already then
  insert into public.cafeteria_memberships(account_id,school_id,cafeteria_id,person_id,role_code)
  values(c.account_id,c.school_id,c.id,p_person_id,p_role_code) returning id into member;
  perform pikas_private.record_pos_operational_audit(actor,auth_actor,'platform_operator',c.account_id,c.school_id,c.id,
   'pos_membership_granted','cafeteria_memberships',member,'{}'::jsonb,jsonb_build_object('role_code',p_role_code,'status','active'));
 end if;
 result:=jsonb_build_object('membership_id',member,'person_id',p_person_id,'cafeteria_id',c.id,'role_code',p_role_code,'already_granted',already);
 insert into pikas_private.platform_requests(request_id,operation,request_fingerprint,actor_auth_user_id,actor_person_id,response)
 values(p_request_id,'customer_pos_access_grant',fingerprint,auth_actor,actor,result);
 perform pikas_private.record_platform_audit(p_request_id,actor,auth_actor,'platform:customer:access:provision','customer_pos_access_granted',
  'customer_pos_access_granted',p_account_id,c.school_id,c.school_location_id,c.id,p_person_id,null,jsonb_build_object('role_code',p_role_code,'already_granted',already));
 return result;
end $$;

-- Self only: the signed-in person's own memberships with their status (active or not) and the
-- organization's lifecycle state, so a sign-in or password change can say truthfully why nothing opens.
create function public.identity_access_summary() returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('organization',public.tenant_lifecycle_state(),
  'memberships',coalesce((select jsonb_agg(x order by x->>'scope',x->>'name') from (
   select jsonb_build_object('scope','account','role',m.role_code,'status',m.status,'name',a.name) x from public.account_memberships m join public.accounts a on a.id=m.account_id where m.person_id=p.id
   union all select jsonb_build_object('scope','school','role',m.role_code,'status',m.status,'name',s.name) from public.school_memberships m join public.schools s on s.id=m.school_id where m.person_id=p.id
   union all select jsonb_build_object('scope','cafeteria','role',m.role_code,'status',m.status,'name',c.name) from public.cafeteria_memberships m join public.cafeterias c on c.id=m.cafeteria_id where m.person_id=p.id) q),'[]'::jsonb))
 from public.persons p where p.auth_user_id=(select auth.uid())
$$;

revoke all on function public.platform_set_customer_structure_status(uuid,uuid,text,uuid,text,text,text),
 public.platform_set_customer_membership_status(uuid,uuid,text,uuid,text,text,text),
 public.platform_grant_customer_pos_access(uuid,uuid,uuid,uuid,text),
 public.identity_access_summary() from public,anon,service_role;
grant execute on function public.platform_set_customer_structure_status(uuid,uuid,text,uuid,text,text,text),
 public.platform_set_customer_membership_status(uuid,uuid,text,uuid,text,text,text),
 public.platform_grant_customer_pos_access(uuid,uuid,uuid,uuid,text),
 public.identity_access_summary() to authenticated;

notify pgrst, 'reload schema';
commit;
