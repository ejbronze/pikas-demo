-- Backoffice Customer Management M2/M4: explicit, non-financial Platform cafeteria support writes.
-- Students, parents and staff stay School Admin responsibilities: no Platform school/roster route.
begin;

insert into pikas_private.platform_capabilities(capability)
values ('platform:customer:operations:manage');
insert into pikas_private.platform_role_capabilities(role_code,capability)
values ('platform_admin','platform:customer:operations:manage');

-- Platform support is a truthful audit scope. Existing values and tenant attribution stay valid.
alter table public.audit_events drop constraint audit_events_actor_scope_kind_check;
alter table public.audit_events add constraint audit_events_actor_scope_kind_check
 check (actor_scope_kind in ('account','school','cafeteria','identity','system','platform'));

-- Validate one explicit customer scope. GUCs below are only routing context: every use revalidates
-- the real authenticated Platform actor, capability, ancestry, tenant kind and lifecycle.
create function pikas_private.require_customer_operations_scope(
 p_account_id uuid,p_school_id uuid default null,p_cafeteria_id uuid default null,
 p_mode text default 'manage',p_lock boolean default false) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare actor uuid; result jsonb; required text;
begin
 required:=case p_mode when 'read' then 'platform:customer:operations:read'
   when 'manage' then 'platform:customer:operations:manage' end;
 if required is null then raise exception using errcode='42501',message='customer_operations_authority_required'; end if;
 actor:=pikas_private.require_platform_capability(required);
 if pikas_private.sandbox_pov_active_attempt() then
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

create function pikas_private.begin_customer_operations_scope(
 p_account_id uuid,p_school_id uuid default null,p_cafeteria_id uuid default null,p_mode text default 'manage') returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare ctx jsonb;
begin
 ctx:=pikas_private.require_customer_operations_scope(p_account_id,p_school_id,p_cafeteria_id,p_mode,true);
 perform set_config('pikas.customer_operations_account',p_account_id::text,true);
 perform set_config('pikas.customer_operations_school',coalesce(p_school_id::text,''),true);
 perform set_config('pikas.customer_operations_cafeteria',coalesce(p_cafeteria_id::text,''),true);
 perform set_config('pikas.customer_operations_mode',p_mode,true);
 return ctx;
end $$;
create function pikas_private.end_customer_operations_scope() returns void
language plpgsql volatile security definer set search_path='' as $$
begin
 perform set_config('pikas.customer_operations_account','',true);
 perform set_config('pikas.customer_operations_school','',true);
 perform set_config('pikas.customer_operations_cafeteria','',true);
 perform set_config('pikas.customer_operations_mode','',true);
end $$;

-- Keep the frozen tenant guards intact behind routing wrappers. Without the private context the
-- exact original tenant guard runs. With it, the real Platform authority is revalidated.
alter function pikas_private.require_cafeteria_admin(uuid,boolean) rename to require_cafeteria_admin_tenant;
create function pikas_private.require_cafeteria_admin(p_cafeteria_id uuid,p_lock boolean default false) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare a text:=nullif(current_setting('pikas.customer_operations_account',true),''); mode text;
begin
 if a is null then return pikas_private.require_cafeteria_admin_tenant(p_cafeteria_id,p_lock); end if;
 mode:=nullif(current_setting('pikas.customer_operations_mode',true),'');
 return pikas_private.require_customer_operations_scope(a::uuid,null,p_cafeteria_id,mode,p_lock);
end $$;

-- Legacy domain RPCs enforce their own capability checks. Route those checks through the same
-- revalidated support context so the shared engines remain the sole mutation implementation.
alter function pikas_private.has_capability(text,uuid,uuid,uuid) rename to has_capability_tenant;
create function pikas_private.has_capability(cap text,a uuid,s uuid default null,c uuid default null) returns boolean
language plpgsql volatile security definer set search_path='' as $$
declare support_account text:=nullif(current_setting('pikas.customer_operations_account',true),''); mode text;
begin
 if support_account is null then return pikas_private.has_capability_tenant(cap,a,s,c); end if;
 mode:=nullif(current_setting('pikas.customer_operations_mode',true),'');
 if support_account::uuid is distinct from a then return false; end if;
 perform pikas_private.require_customer_operations_scope(a,s,c,mode,false);
 return mode='manage' and cap=any(array['cafeteria:catalog:manage','cafeteria:catalog:read','cafeteria:registers:manage','cafeteria:register_assignments:manage']);
end $$;

alter function pikas_private.sandbox_admin_has_capability(text,text,uuid,uuid,uuid) rename to sandbox_admin_has_capability_tenant;
create function pikas_private.sandbox_admin_has_capability(p_code text,cap text,a uuid,s uuid default null,c uuid default null) returns boolean
language plpgsql volatile security definer set search_path='' as $$
declare support_account text:=nullif(current_setting('pikas.customer_operations_account',true),''); mode text;
begin
 if support_account is null then return pikas_private.sandbox_admin_has_capability_tenant(p_code,cap,a,s,c); end if;
 mode:=nullif(current_setting('pikas.customer_operations_mode',true),'');
 if support_account::uuid is distinct from a then return false; end if;
 perform pikas_private.require_customer_operations_scope(a,s,c,mode,false);
 if p_code='cafeteria_admin' then
  return mode='manage' and cap=any(array['cafeteria:catalog:manage','cafeteria:catalog:read','cafeteria:registers:manage','cafeteria:register_assignments:manage']);
 end if;
 return false;
end $$;

-- Every audit row produced by the shared domain commands/triggers is attributed to the real
-- Platform operator while retaining the customer object scope columns.
create function pikas_private.stamp_customer_operations_audit() returns trigger
language plpgsql volatile security definer set search_path='' as $$
declare a text:=nullif(current_setting('pikas.customer_operations_account',true),''); ctx jsonb;
begin
 if a is null then return new; end if;
 ctx:=pikas_private.require_customer_operations_scope(a::uuid,new.school_id,new.cafeteria_id,'manage',false);
 new.actor_person_id:=(ctx->>'actor_id')::uuid;
 new.authenticated_user_id:=auth.uid();
 new.actor_scope_kind:='platform';
 new.actor_role:='platform_support';
 return new;
end $$;
create trigger zz_audit_events_stamp_customer_operations before insert on public.audit_events
for each row execute function pikas_private.stamp_customer_operations_audit();

-- M2/M4: the only Platform support write entry point, over the existing cafeteria command engine.
create function public.platform_support_cafeteria_command(p_account_id uuid,p_cafeteria_id uuid,p_request_id uuid,p_operation text,p_payload jsonb) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare result jsonb;
begin
 if p_operation is null or p_operation<>all(array['product_save','category_save','menu_save','shift_save','settings_save','register_save','assignment_save']) then
  raise exception using errcode='42501',message='customer_operations_command_denied';
 end if;
 perform pikas_private.begin_customer_operations_scope(p_account_id,null,p_cafeteria_id,'manage');
 result:=public.cafeteria_admin_command(p_cafeteria_id,p_request_id,p_operation,p_payload);
 perform pikas_private.end_customer_operations_scope(); return result;
end $$;

revoke all on function pikas_private.require_customer_operations_scope(uuid,uuid,uuid,text,boolean),
 pikas_private.begin_customer_operations_scope(uuid,uuid,uuid,text),
 pikas_private.end_customer_operations_scope(),
 pikas_private.stamp_customer_operations_audit() from public,anon,authenticated,service_role;
revoke all on function public.platform_support_cafeteria_command(uuid,uuid,uuid,text,jsonb)
 from public,anon,authenticated,service_role;
grant execute on function public.platform_support_cafeteria_command(uuid,uuid,uuid,text,jsonb)
 to authenticated;

notify pgrst, 'reload schema';
commit;
