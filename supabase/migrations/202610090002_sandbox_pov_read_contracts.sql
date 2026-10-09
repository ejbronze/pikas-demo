-- Phase 6B read contracts: the operator's own active sandbox POV and the cashier targets they may start.
-- Read-only; grants no authority. Enter/exit, actor resolution and tenant authorization are unchanged.
begin;

create function public.platform_get_active_sandbox_pov() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare result jsonb;
begin
  perform pikas_private.require_platform_capability('platform:sandbox:pov:enter');
  select jsonb_build_object(
    'session_id',c.pov_session_id,
    'account_id',c.account_id,'account_name',ac.name,
    'cafeteria_id',c.cafeteria_id,'cafeteria_name',ca.name,
    'pov_code',c.pov_code,
    'persona_display_name',pp.display_name,
    'expires_at',c.expires_at)
  into result
  from pikas_private.sandbox_pov_context() c
  join public.accounts ac on ac.id=c.account_id
  join public.cafeterias ca on ca.id=c.cafeteria_id and ca.account_id=c.account_id
  join public.persons pp on pp.id=c.persona_person_id;
  return result;
end $$;

create function public.platform_list_sandbox_pov_targets() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare result jsonb;
begin
  perform pikas_private.require_platform_capability('platform:sandbox:pov:enter');
  select coalesce(jsonb_agg(jsonb_build_object(
      'account_id',ac.id,'account_name',ac.name,
      'cafeteria_id',ca.id,'cafeteria_name',ca.name,
      'pov_code',pr.pov_code,
      'persona_display_name',pp.display_name) order by ac.name,ca.name),'[]'::jsonb)
  into result
  from pikas_private.sandbox_pov_personas pr
  join public.accounts ac on ac.id=pr.account_id and ac.status='active' and ac.tenant_kind='sandbox'
  join public.cafeterias ca on ca.id=pr.cafeteria_id and ca.account_id=pr.account_id and ca.school_id=pr.school_id
  join public.persons pp on pp.id=pr.person_id and pp.status='active' and pp.auth_user_id is null
  join public.cafeteria_memberships m on m.id=pr.cafeteria_membership_id and m.person_id=pp.id
    and m.status='active' and m.role_code='pos_cashier' and m.account_id=pr.account_id
    and m.school_id=pr.school_id and m.cafeteria_id=pr.cafeteria_id
  where pr.status='active' and pr.pov_code='cashier'
    and pikas_private.scope_active(pr.account_id,pr.school_id,pr.cafeteria_id);
  return result;
end $$;

revoke all on function public.platform_get_active_sandbox_pov() from public,anon,authenticated,service_role;
revoke all on function public.platform_list_sandbox_pov_targets() from public,anon,authenticated,service_role;
grant execute on function public.platform_get_active_sandbox_pov() to authenticated;
grant execute on function public.platform_list_sandbox_pov_targets() to authenticated;

commit;
