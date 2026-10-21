-- PIKAS UX 2: read-only launch-readiness facts for the Platform cockpit and Puesta en marcha.
--
-- One read assembles, per REAL customer (tenant_kind 'customer'), the observable facts the launch
-- path needs: profile presence, operating structure (active colegio → sede → cafetería), usable
-- administrator access and the state of a pending initial-administrator request (through the
-- existing write-free customer_activation_state), POS staff and staff invitations, cajas with an
-- assigned active POS member, products available for sale, and the first/last sale timestamps.
-- Sandbox tenants are listed apart (id, name, status) and never counted with customers.
--
-- It returns no amounts, totals, balances, credentials, tokens, link handles or Auth metadata,
-- writes nothing and takes no lock. Authority is the existing customer-support read
-- platform:customer:operations:read (cafeterías, cajas, personal, transacciones); a current Demo
-- POV is refused. Lifecycle (active/suspended/closed) is returned as-is: readiness is derived in
-- the application and never stored.
begin;

create function public.platform_customer_readiness(p_account_id uuid default null) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare result jsonb;
begin
 perform pikas_private.require_platform_capability('platform:customer:operations:read');
 if pikas_private.sandbox_pov_current_attempt() then
  raise exception using errcode='42501',message='customer_operations_authority_required';
 end if;
 if p_account_id is not null and not exists(select 1 from public.accounts a where a.id=p_account_id and a.tenant_kind='customer') then
  raise exception using errcode='42501',message='customer_operations_scope_required';
 end if;
 with acct as (
  select a.* from public.accounts a where a.tenant_kind='customer' and (p_account_id is null or a.id=p_account_id)
  order by a.name,a.id limit 200
 ), cafe as (
  -- Operating cafeterías: active cafetería in an active sede of an active colegio.
  select c.id,c.account_id,c.name from public.cafeterias c
  join public.school_locations l on l.id=c.school_location_id and l.status='active'
  join public.schools s on s.id=c.school_id and s.status='active'
  where c.status='active' and c.account_id in (select id from acct)
 ), pos as (
  select m.id membership_id,m.account_id,m.cafeteria_id,m.person_id from public.cafeteria_memberships m
  join public.persons p on p.id=m.person_id and p.status='active' and p.auth_user_id is not null
  where m.status='active' and m.role_code in ('pos_cashier','pos_supervisor') and m.cafeteria_id in (select id from cafe)
 )
 select jsonb_build_object('customers',coalesce(jsonb_agg(jsonb_build_object(
   'account_id',a.id,'name',a.name,'code',a.code,'status',a.status,'created_at',a.created_at,
   'profile',(select jsonb_build_object('active_schools',count(*),
      'missing_tax_id',count(*) filter (where nullif(btrim(s.tax_id),'') is null),
      'missing_address',count(*) filter (where nullif(btrim(s.address_line),'') is null),
      'missing_province',count(*) filter (where s.subdivision_code is null))
     from public.schools s where s.account_id=a.id and s.status='active'),
   'structure',jsonb_build_object(
     'active_locations',(select count(*) from public.school_locations l join public.schools s on s.id=l.school_id and s.status='active' where l.account_id=a.id and l.status='active'),
     'operating_cafeterias',(select count(*) from cafe where cafe.account_id=a.id),
     'first_cafeteria_id',(select cafe.id from cafe where cafe.account_id=a.id order by cafe.name,cafe.id limit 1)),
   'administrators',jsonb_build_object(
     'active',(select count(distinct x.person_id) from (
        select m.person_id from public.account_memberships m where m.account_id=a.id and m.status='active' and m.role_code='account_admin'
        union all select m.person_id from public.school_memberships m where m.account_id=a.id and m.status='active' and m.role_code='school_admin') x
       join public.persons p on p.id=x.person_id and p.status='active' and p.auth_user_id is not null),
     'requests',coalesce((select jsonb_agg(jsonb_build_object('status',i.status,'expires_at',i.expires_at,'request_expired',i.expires_at<=clock_timestamp(),
        'identity_state',st.v->>'identity_state','link_state',st.v->>'link_state') order by i.created_at desc)
       from pikas_private.platform_customer_admin_intents i cross join lateral (select pikas_private.customer_activation_state(i.id) v) st
       where i.account_id=a.id and i.role_code='account_admin' and i.scope_kind='account' and i.status in ('pending','linked')),'[]'::jsonb)),
   'staff',jsonb_build_object(
     'active_pos',(select count(distinct pos.person_id) from pos where pos.account_id=a.id),
     'pending_invitations',(select count(*) from public.invitations v where v.account_id=a.id and v.status='pending' and v.role_code in ('pos_cashier','pos_supervisor') and v.expires_at>clock_timestamp()),
     'expired_invitations',(select count(*) from public.invitations v where v.account_id=a.id and v.status='pending' and v.role_code in ('pos_cashier','pos_supervisor') and v.expires_at<=clock_timestamp())),
   'registers',jsonb_build_object(
     'active',(select count(*) from public.cafeteria_registers r where r.status='active' and r.cafeteria_id in (select id from cafe where cafe.account_id=a.id)),
     'staffed',(select count(distinct r.id) from public.cafeteria_registers r
        join public.cafeteria_register_assignments ra on ra.register_id=r.id and ra.status='active'
        join pos on pos.membership_id=ra.cafeteria_membership_id
       where r.status='active' and pos.account_id=a.id)),
   'products',jsonb_build_object('available',(select count(*) from public.cafeteria_products pr where pr.active and pr.available and pr.cafeteria_id in (select id from cafe where cafe.account_id=a.id))),
   'sales',(select jsonb_build_object('first_at',min(p.purchased_at),'last_at',max(p.purchased_at)) from public.purchases p where p.account_id=a.id))
  order by a.name,a.id),'[]'::jsonb),
  'sandbox',case when p_account_id is null then coalesce((select jsonb_agg(jsonb_build_object('account_id',s.id,'name',s.name,'status',s.status) order by s.name)
     from public.accounts s where s.tenant_kind='sandbox'),'[]'::jsonb) else '[]'::jsonb end,
  'truncated',(select count(*) from public.accounts where tenant_kind='customer' and (p_account_id is null or id=p_account_id))>200)
 into result from acct a;
 return result;
end $$;

revoke all on function public.platform_customer_readiness(uuid) from public,anon,authenticated,service_role;
grant execute on function public.platform_customer_readiness(uuid) to authenticated;

notify pgrst, 'reload schema';
commit;
