-- Step 4A: read-only POS access/bootstrap. No identifiers or authority supplied by the caller.
begin;

create function public.get_pos_access_context() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare actor uuid; actor_name text; ctx record; memberships_value jsonb;
begin
  actor:=pikas_private.pos_actor_person_id();
  if actor is null then return null; end if;
  select display_name into actor_name from public.persons where id=actor and status='active';
  if not found then return null; end if;
  select * into ctx from pikas_private.sandbox_pov_context();

  select jsonb_agg(jsonb_build_object(
    'membership_id',m.id,'role_code',m.role_code,
    'account_id',m.account_id,'account_name',a.name,'tenant_kind',a.tenant_kind,
    'school_id',m.school_id,'school_location_id',c.school_location_id,
    'cafeteria_id',m.cafeteria_id,'cafeteria_name',c.name
  ) order by m.account_id,m.school_id,m.cafeteria_id,m.id) into memberships_value
  from public.cafeteria_memberships m
  join public.accounts a on a.id=m.account_id
  join public.cafeterias c on c.id=m.cafeteria_id and c.account_id=m.account_id and c.school_id=m.school_id
  where m.person_id=actor and m.status='active' and m.role_code in ('pos_cashier','pos_supervisor')
    and pikas_private.scope_active(m.account_id,m.school_id,m.cafeteria_id)
    and pikas_private.pos_is_operator_membership(m.id,actor,m.account_id,m.school_id,m.cafeteria_id,
      'cafeteria:pos:purchase:create')
    and (ctx.pov_session_id is null or (ctx.persona_person_id=actor and ctx.persona_membership_id=m.id));
  if memberships_value is null then return null; end if;

  return jsonb_build_object(
    'actor',jsonb_build_object('person_id',actor,'display_name',actor_name),
    'memberships',memberships_value,
    'pov',case when ctx.pov_session_id is not null then jsonb_build_object(
      'session_id',ctx.pov_session_id,'pov_code',ctx.pov_code,'expires_at',ctx.expires_at) else null end
  );
end $$;

revoke all on function public.get_pos_access_context() from public,anon,authenticated,service_role;
grant execute on function public.get_pos_access_context() to authenticated;
comment on function public.get_pos_access_context() is
  'Read-only effective POS actor and exact active scopes; null without POS authority. Does not require a register or catalog.';

commit;
