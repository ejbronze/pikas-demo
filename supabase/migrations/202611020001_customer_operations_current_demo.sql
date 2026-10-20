-- Customer Operations: refuse Platform support only while the operator has a CURRENT Demo POV.
--
-- Sandbox POV sessions leave status 'active' until an explicit exit or a superseding entry; expiry
-- never changes status. sandbox_pov_active_attempt() deliberately ignores expiry (fail-closed for the
-- tenant delegation/activation guards that use it) and stays UNCHANGED. Customer Operations reused
-- it, so expired Demo history blocked every Platform operator in production.
--
-- Current Demo = status 'active' AND expires_at > clock_timestamp(), the exact temporal predicate of
-- the authoritative resolver pikas_private.sandbox_validated_pov(). That resolver is not reused as
-- the block condition: its extra persona/capability validity checks would let an unexpired but
-- invalid session through, which would loosen this guard. The three Customer Operations guards
-- change only their Demo check; their bodies are otherwise identical to 202610290001/202610300001.
--
-- The shared cafeteria command engine also calls sandbox_admin_actor(), which applies the same
-- fail-closed rule. It is renamed and wrapped like the other tenant guards in 202610300001: without
-- the private support context the exact original runs; with it, the real Platform operator is
-- returned only after the support scope is revalidated (which refuses a current Demo POV).
-- No capability, grant, RLS, tenant/Demo semantic or data change.
begin;

create function pikas_private.sandbox_pov_current_attempt() returns boolean
language sql volatile security definer set search_path='' as $$
 select exists(select 1 from pikas_private.sandbox_pov_sessions s where s.initiator_auth_user_id=auth.uid()
  and s.status='active' and s.expires_at>clock_timestamp())
$$;
revoke all on function pikas_private.sandbox_pov_current_attempt() from public,anon,authenticated,service_role;

create or replace function public.platform_customer_operations_overview(p_account_id uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare result jsonb;
begin
 perform pikas_private.require_platform_capability('platform:customer:operations:read');
 if pikas_private.sandbox_pov_current_attempt() then raise exception using errcode='42501',message='customer_operations_authority_required'; end if;
 select jsonb_build_object('account',jsonb_build_object('id',a.id,'name',a.name,'code',a.code,'status',a.status),
  'schools',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'name',s.name,'status',s.status,
    'locations',coalesce((select jsonb_agg(jsonb_build_object('id',l.id,'name',l.name,'status',l.status,
      'cafeterias',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'name',c.name,'code',c.code,'status',c.status) order by c.name,c.id)
        from public.cafeterias c where c.school_location_id=l.id and c.account_id=a.id),'[]'::jsonb)) order by l.name,l.id)
      from public.school_locations l where l.school_id=s.id and l.account_id=a.id),'[]'::jsonb)) order by s.name,s.id)
    from public.schools s where s.account_id=a.id),'[]'::jsonb)) into result
 from public.accounts a where a.id=p_account_id and a.tenant_kind='customer';
 if result is null then raise exception using errcode='42501',message='customer_operations_scope_required'; end if;
 return result;
end $$;

create or replace function pikas_private.require_customer_operations_read(p_account_id uuid,p_cafeteria_id uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare actor uuid; ctx jsonb;
begin
 actor:=pikas_private.require_platform_capability('platform:customer:operations:read');
 if pikas_private.sandbox_pov_current_attempt() then raise exception using errcode='42501',message='customer_operations_authority_required'; end if;
 select jsonb_build_object('actor_id',actor,'membership_id',null,'cafeteria_id',c.id,'cafeteria_name',c.name,'cafeteria_status',c.status,
   'account_id',a.id,'account_name',a.name,'account_status',a.status,'school_name',s.name,'location_name',l.name,'tenant_kind',a.tenant_kind,
   'capabilities','[]'::jsonb,'support',true) into ctx
 from public.cafeterias c join public.accounts a on a.id=c.account_id join public.schools s on s.id=c.school_id and s.account_id=c.account_id
 join public.school_locations l on l.id=c.school_location_id
 where c.id=p_cafeteria_id and c.account_id=p_account_id and a.tenant_kind='customer';
 if ctx is null then raise exception using errcode='42501',message='customer_operations_scope_required'; end if;
 return ctx;
end $$;

create or replace function pikas_private.require_customer_operations_scope(
 p_account_id uuid,p_school_id uuid default null,p_cafeteria_id uuid default null,
 p_mode text default 'manage',p_lock boolean default false) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare actor uuid; result jsonb; required text;
begin
 required:=case p_mode when 'read' then 'platform:customer:operations:read'
   when 'manage' then 'platform:customer:operations:manage' end;
 if required is null then raise exception using errcode='42501',message='customer_operations_authority_required'; end if;
 actor:=pikas_private.require_platform_capability(required);
 if pikas_private.sandbox_pov_current_attempt() then
  raise exception using errcode='42501',message='customer_operations_authority_required';
 end if;
 if p_lock then
  perform 1 from public.persons where id=actor for share;
  perform 1 from pikas_private.platform_memberships where person_id=actor and status='active' order by id for share;
  perform 1 from public.accounts where id=p_account_id for share;
  if p_school_id is not null then perform 1 from public.schools where id=p_school_id and account_id=p_account_id for share; end if;
  if p_cafeteria_id is not null then perform 1 from public.cafeterias where id=p_cafeteria_id and account_id=p_account_id for share; end if;
 end if;
 select jsonb_build_object('actor_id',actor,'membership_id',null,'role','platform_support','support',true,
  'account_id',a.id,'account_name',a.name,'account_status',a.status,'tenant_kind',a.tenant_kind,
  'school_id',s.id,'school_name',s.name,'cafeteria_id',c.id,'cafeteria_name',c.name,
  'cafeteria_status',c.status,'location_name',l.name,'capabilities','[]'::jsonb)
 into result
 from public.accounts a
 left join public.schools s on s.account_id=a.id and s.id=p_school_id
 left join public.cafeterias c on c.account_id=a.id and c.id=p_cafeteria_id
  and (p_school_id is null or c.school_id=p_school_id)
 left join public.school_locations l on l.id=c.school_location_id and l.account_id=a.id
 where a.id=p_account_id and a.tenant_kind='customer'
  and (p_mode='read' or a.status='active')
  and (p_school_id is null or s.id is not null)
  and (p_cafeteria_id is null or c.id is not null);
 if result is null then raise exception using errcode='42501',message='customer_operations_scope_required'; end if;
 return result;
end $$;

alter function pikas_private.sandbox_admin_actor(text) rename to sandbox_admin_actor_tenant;
create function pikas_private.sandbox_admin_actor(p_code text) returns uuid
language plpgsql volatile security definer set search_path='' as $$
declare a text:=nullif(current_setting('pikas.customer_operations_account',true),'');
begin
 if a is null then return pikas_private.sandbox_admin_actor_tenant(p_code); end if;
 return (pikas_private.require_customer_operations_scope(a::uuid,null,
  nullif(current_setting('pikas.customer_operations_cafeteria',true),'')::uuid,
  nullif(current_setting('pikas.customer_operations_mode',true),''),false)->>'actor_id')::uuid;
end $$;
revoke all on function pikas_private.sandbox_admin_actor(text) from public,anon,authenticated,service_role;

notify pgrst, 'reload schema';
commit;
