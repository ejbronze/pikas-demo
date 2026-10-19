-- Platform customer lifecycle: Activo / Suspendido / Cerrado. Additive and forward-safe.
--
-- Authoritative state is the EXISTING public.accounts.status. Every tenant authority path already
-- requires accounts.status='active' (pikas_private.scope_active → has_capability, require_school_admin,
-- require_cafeteria_admin, POS context/capabilities, tenant contexts and RLS), so a suspended or
-- closed customer is blocked centrally and immediately, including stale sessions, without touching
-- Persons, memberships, Auth users, identity suspension, sessions, registers or any financial row.
-- 'closed' is added as the explicit end-of-relationship state ('inactive' stays valid and unused).
-- Mutation is Platform-only (new narrow capability), journaled in platform_requests (exact retry
-- replays), guarded by the expected current state, and audited append-only in platform_audit_events
-- with the real operator, before/after state and reason. Nothing is deleted, anonymized or settled.
begin;

alter table public.accounts drop constraint accounts_status_check;
alter table public.accounts add constraint accounts_status_check check (status in ('active','suspended','inactive','closed'));

insert into pikas_private.platform_capabilities(capability) values ('platform:tenant:lifecycle:manage');
insert into pikas_private.platform_role_capabilities(role_code,capability) values ('platform_admin','platform:tenant:lifecycle:manage');

alter table pikas_private.platform_audit_events drop constraint platform_audit_events_reason_code_check;
alter table pikas_private.platform_audit_events add constraint platform_audit_events_reason_code_check check (reason_code in (
 'owner_root_bootstrap','tenant_provisioned','school_location_added','customer_admin_intent_prepared','identity_linked',
 'customer_admin_granted','sandbox_pov_entered','sandbox_pov_exited','team_prepared','team_completed','team_demo_changed',
 'customer_suspended','customer_reactivated','customer_closed','customer_reopened'));

-- Customer list: same projection, now filterable by 'closed'.
create or replace function public.platform_list_customers(p_query text default '',p_status text default null,
 p_kind text default null,p_after uuid default null,p_limit integer default 25) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 perform pikas_private.require_platform_capability('platform:tenant:lifecycle:read');
 if p_query is null or length(p_query)>80 or p_limit is null or p_limit not between 1 and 100
   or (p_status is not null and p_status not in ('active','suspended','inactive','closed'))
   or (p_kind is not null and p_kind not in ('customer','sandbox')) then
   raise exception using errcode='22023',message='invalid_customer_filter';
 end if;
 with selected as (
   select a.* from public.accounts a where (p_after is null or a.id>p_after)
    and (p_status is null or a.status=p_status) and (p_kind is null or a.tenant_kind=p_kind)
    and position(lower(btrim(p_query)) in lower(a.name||' '||a.code))>0 order by a.id limit p_limit+1
 ), page as (select * from selected order by id limit p_limit)
 select jsonb_build_object('customers',coalesce((select jsonb_agg(jsonb_build_object(
   'id',a.id,'name',a.name,'code',a.code,'status',a.status,'tenant_kind',a.tenant_kind,
   'school_count',(select count(*) from public.schools s where s.account_id=a.id),
   'location_count',(select count(*) from public.school_locations l where l.account_id=a.id),
   'cafeteria_count',(select count(*) from public.cafeterias c where c.account_id=a.id)) order by a.id) from page a),'[]'::jsonb),
   'next_cursor',case when (select count(*) from selected)>p_limit then (select id from page order by id desc limit 1) else null end)
 into result;
 return result;
end $$;

-- Lifecycle transition (Platform only). p_action: suspend | reactivate | close | reopen.
create function public.platform_set_customer_lifecycle(p_request_id uuid,p_account_id uuid,p_expected_status text,p_action text,p_reason text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid; auth_actor uuid:=auth.uid(); reason text:=btrim(coalesce(p_reason,'')); payload jsonb; fingerprint text; replay jsonb;
 current_status text; kind text; target text; code text; result jsonb;
begin
 actor:=pikas_private.require_platform_capability('platform:tenant:lifecycle:manage');
 if exists(select 1 from pikas_private.sandbox_validated_pov()) then raise exception using errcode='42501',message='platform_authorization_required'; end if;
 if p_account_id is null or p_expected_status is null or p_action not in ('suspend','reactivate','close','reopen') then
  raise exception using errcode='22023',message='invalid_lifecycle_request'; end if;
 if length(reason) not between 3 and 500 then raise exception using errcode='22023',message='lifecycle_reason_required'; end if;
 payload:=jsonb_build_object('account_id',p_account_id,'expected_status',p_expected_status,'action',p_action,'reason',reason);
 fingerprint:=pikas_private.platform_request_fingerprint(payload);
 replay:=pikas_private.platform_replay_request(p_request_id,'customer_lifecycle',fingerprint,actor);
 if replay is not null then return replay; end if;
 select status,tenant_kind into current_status,kind from public.accounts where id=p_account_id for update;
 if not found then raise exception using errcode='P0002',message='customer_not_found'; end if;
 if kind<>'customer' then raise exception using errcode='22023',message='lifecycle_customer_only'; end if;
 if current_status is distinct from p_expected_status then raise exception using errcode='40001',message='lifecycle_state_changed'; end if;
 select t.target,t.code into target,code from (values
  ('active','suspend','suspended','customer_suspended'),('suspended','reactivate','active','customer_reactivated'),
  ('active','close','closed','customer_closed'),('suspended','close','closed','customer_closed'),
  ('closed','reopen','active','customer_reopened')) t(source,action,target,code)
  where t.source=current_status and t.action=p_action;
 if target is null then raise exception using errcode='22023',message='invalid_lifecycle_transition'; end if;
 update public.accounts set status=target where id=p_account_id;
 result:=jsonb_build_object('account_id',p_account_id,'status',target,'previous_status',current_status);
 insert into pikas_private.platform_requests(request_id,operation,request_fingerprint,actor_auth_user_id,actor_person_id,response)
  values(p_request_id,'customer_lifecycle',fingerprint,auth_actor,actor,result);
 perform pikas_private.record_platform_audit(p_request_id,actor,auth_actor,'platform:tenant:lifecycle:manage',code,code,
  p_account_id,null,null,null,null,null,jsonb_build_object('from',current_status,'to',target,'reason',reason));
 return result;
end $$;

-- Lifecycle history for Platform readers (never exposed to tenants).
create function public.platform_customer_lifecycle_history(p_account_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 perform pikas_private.require_platform_capability('platform:tenant:lifecycle:read');
 return jsonb_build_object('events',coalesce((select jsonb_agg(jsonb_build_object('occurred_at',e.occurred_at,'action',e.reason_code,
   'from',e.metadata->>'from','to',e.metadata->>'to','reason',e.metadata->>'reason','actor_name',p.display_name) order by e.occurred_at desc,e.id)
  from pikas_private.platform_audit_events e left join public.persons p on p.id=e.actor_person_id
  where e.target_account_id=p_account_id and e.reason_code in ('customer_suspended','customer_reactivated','customer_closed','customer_reopened')),'[]'::jsonb));
end $$;

-- Self-only: is the signed-in person blocked ONLY because their organization is suspended/closed?
-- Returns 'suspended' | 'closed' | null. Never returns reasons, operators or other accounts.
create function public.tenant_lifecycle_state() returns text
language sql stable security definer set search_path='' as $$
 with me as (select pikas_private.current_person_id() id),
 held as (
  select m.account_id from public.account_memberships m, me where m.person_id=me.id and m.status='active'
  union select m.account_id from public.school_memberships m, me where m.person_id=me.id and m.status='active'
  union select m.account_id from public.cafeteria_memberships m, me where m.person_id=me.id and m.status='active')
 select case when (select id from me) is null or exists(select 1 from held h join public.accounts a on a.id=h.account_id where a.status='active') then null
  when exists(select 1 from held h join public.accounts a on a.id=h.account_id where a.status='suspended') then 'suspended'
  when exists(select 1 from held h join public.accounts a on a.id=h.account_id where a.status in ('closed','inactive')) then 'closed' end
$$;

revoke all on function public.platform_set_customer_lifecycle(uuid,uuid,text,text,text),public.platform_customer_lifecycle_history(uuid),
 public.tenant_lifecycle_state() from public,anon,authenticated,service_role;
grant execute on function public.platform_set_customer_lifecycle(uuid,uuid,text,text,text),public.platform_customer_lifecycle_history(uuid),
 public.tenant_lifecycle_state() to authenticated;

commit;
