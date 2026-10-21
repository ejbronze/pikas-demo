-- Backoffice "Usuarios y accesos": one read-only support view of who has access to a customer.
--
-- New narrow capability platform:customer:access:read (platform_admin only). The read assembles
-- existing authoritative data for ONE customer (never sandbox): people holding account, school or
-- cafeteria memberships of that customer, their login identity state, register assignments, and
-- pending access (Platform initial-admin requests and staff invitations). Activation states come
-- from the existing write-free derivations. It writes nothing: no login_identities row, no audit,
-- no lock. It never returns passwords, password traces, tokens, link handles or Auth metadata.
-- A current Demo POV is refused; expired Demo history is not (Customer Operations semantics).
begin;

insert into pikas_private.platform_capabilities(capability) values ('platform:customer:access:read');
insert into pikas_private.platform_role_capabilities(role_code,capability) values ('platform_admin','platform:customer:access:read');

create function public.platform_customer_access_read(p_account_id uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare result jsonb;
begin
 perform pikas_private.require_platform_capability('platform:customer:access:read');
 if pikas_private.sandbox_pov_current_attempt() then
  raise exception using errcode='42501',message='customer_access_authority_required';
 end if;
 if not exists(select 1 from public.accounts a where a.id=p_account_id and a.tenant_kind='customer') then
  raise exception using errcode='42501',message='customer_access_scope_required';
 end if;
 with grants as (
  select m.person_id,m.id membership_id,'account'::text scope,m.role_code,m.status,m.created_at,m.updated_at,
   null::uuid school_id,null::text school_name,null::uuid cafeteria_id,null::text cafeteria_name,null::text location_name
  from public.account_memberships m where m.account_id=p_account_id
  union all
  select m.person_id,m.id,'school',m.role_code,m.status,m.created_at,m.updated_at,s.id,s.name,null,null,null
  from public.school_memberships m join public.schools s on s.id=m.school_id and s.account_id=m.account_id where m.account_id=p_account_id
  union all
  select m.person_id,m.id,'cafeteria',m.role_code,m.status,m.created_at,m.updated_at,s.id,s.name,c.id,c.name,l.name
  from public.cafeteria_memberships m join public.cafeterias c on c.id=m.cafeteria_id and c.account_id=m.account_id
   join public.schools s on s.id=c.school_id join public.school_locations l on l.id=c.school_location_id
  where m.account_id=p_account_id
 ), people as (
  select p.id,p.display_name,p.status,p.created_at,p.auth_user_id is not null has_login,li.username,u.email,nullif(u.phone,'') phone,
   u.email_confirmed_at is not null email_confirmed,u.last_sign_in_at,coalesce(li.must_change_password,false) must_change_password,
   li.login_suspended_at is not null login_suspended,li.pending_email is not null email_change_pending,li.temporary_issued_at
  from public.persons p left join pikas_private.login_identities li on li.person_id=p.id left join auth.users u on u.id=p.auth_user_id
  where p.id in (select person_id from grants)
 )
 select jsonb_build_object('account_id',p_account_id,
  'people',coalesce((select jsonb_agg(jsonb_build_object(
    'person_id',pe.id,'display_name',pe.display_name,'person_status',pe.status,'created_at',pe.created_at,'has_login',pe.has_login,
    'username',pe.username,'email',pe.email,'phone',pe.phone,'email_confirmed',pe.email_confirmed,'last_sign_in_at',pe.last_sign_in_at,
    'must_change_password',pe.must_change_password,'login_suspended',pe.login_suspended,'email_change_pending',pe.email_change_pending,
    'temporary_issued_at',pe.temporary_issued_at,
    'grants',(select jsonb_agg(jsonb_build_object('membership_id',g.membership_id,'scope',g.scope,'role_code',g.role_code,'status',g.status,
       'created_at',g.created_at,'updated_at',g.updated_at,'school_id',g.school_id,'school_name',g.school_name,'cafeteria_id',g.cafeteria_id,
       'cafeteria_name',g.cafeteria_name,'location_name',g.location_name,
       'registers',case when g.scope='cafeteria' then coalesce((select jsonb_agg(jsonb_build_object('register_id',r.id,'name',r.display_name,'code',r.register_code,
          'register_status',r.status,'assignment_status',ra.status) order by r.display_name,r.id)
         from public.cafeteria_register_assignments ra join public.cafeteria_registers r on r.id=ra.register_id
         where ra.cafeteria_membership_id=g.membership_id and ra.account_id=p_account_id),'[]'::jsonb) else '[]'::jsonb end)
      order by case g.scope when 'account' then 0 when 'school' then 1 else 2 end,g.school_name,g.cafeteria_name,g.role_code)
     from grants g where g.person_id=pe.id))
   order by pe.display_name,pe.id) from people pe),'[]'::jsonb),
  'pending',coalesce((select jsonb_agg(x order by x->>'created_at') from (
    select jsonb_build_object('kind','initial_admin','request_id',i.id,'role_code',i.role_code,'scope',i.scope_kind,'status',i.status,
     'email',i.intended_email_key,'username',i.intended_username,'school_name',null,'cafeteria_name',null,'created_at',i.created_at,'expires_at',i.expires_at,
     'request_expired',i.expires_at<=clock_timestamp(),'identity_state',s.st->>'identity_state','link_state',s.st->>'link_state') x
    from pikas_private.platform_customer_admin_intents i cross join lateral (select pikas_private.customer_activation_state(i.id) as st) s
    where i.account_id=p_account_id and i.status in ('pending','linked')
    union all
    select jsonb_build_object('kind','invitation','request_id',v.id,'role_code',v.role_code,'scope',v.scope_kind,'status',v.status,
     'email',v.email_key,'username',v.intended_username,'school_name',s.name,'cafeteria_name',c.name,'created_at',v.created_at,'expires_at',v.expires_at,
     'request_expired',v.expires_at<=clock_timestamp(),'identity_state',s2.st->>'identity_state','link_state',s2.st->>'link_state')
    from public.invitations v left join public.schools s on s.id=v.school_id left join public.cafeterias c on c.id=v.cafeteria_id
     cross join lateral (select case
       when v.role_code in ('pos_cashier','pos_supervisor') then pikas_private.staff_activation_identity_state(v.id)
       when v.role_code='cafeteria_admin' then pikas_private.cafeteria_delegation_identity_state(v.id) end as st) s2
    where v.account_id=p_account_id and v.status='pending') q),'[]'::jsonb))
 into result;
 return result;
end $$;

revoke all on function public.platform_customer_access_read(uuid) from public,anon,authenticated,service_role;
grant execute on function public.platform_customer_access_read(uuid) to authenticated;

notify pgrst, 'reload schema';
commit;
