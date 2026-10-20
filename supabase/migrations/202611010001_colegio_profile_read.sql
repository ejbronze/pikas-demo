-- Backoffice "Información del colegio": the existing customer overview also returns each colegio's
-- onboarding profile. Same function, same gate (platform_get_tenant_lifecycle requires
-- platform:tenant:lifecycle:read) and same grants; no RLS, membership or lower-level read change.
-- Colegios provisioned before Agregar colegio return null profile values.
begin;

create or replace function public.platform_get_customer_overview(p_account_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 -- Reuse the existing hierarchy projection and capability gate.
 result:=public.platform_get_tenant_lifecycle(p_account_id);
 result:=jsonb_set(result,'{schools}',coalesce((
  select jsonb_agg(school||jsonb_build_object('rnc',s.tax_id,'address',s.address_line,'country',s.country_code,
    'province',s.subdivision_code,'province_name',d.name) order by ordinality)
  from jsonb_array_elements(result->'schools') with ordinality as e(school,ordinality)
  left join public.schools s on s.id=(school->>'id')::uuid and s.account_id=p_account_id
  left join pikas_private.country_subdivisions d on d.country_code=s.country_code and d.code=s.subdivision_code),'[]'::jsonb));
 return result||jsonb_build_object(
  'tenant_kind',(select tenant_kind from public.accounts where id=p_account_id),
  'administrators',coalesce((select jsonb_agg(jsonb_build_object('display_name',p.display_name,'status',m.status,'person_status',p.status) order by m.id) from public.account_memberships m join public.persons p on p.id=m.person_id where m.account_id=p_account_id and m.role_code='account_admin'),'[]'::jsonb),
  'administrator_intents',case when pikas_private.platform_has_capability('platform:customer_admin:provision') then
   coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'email',i.intended_email_key,
     'status',case when i.status in ('pending','linked') and i.expires_at<=statement_timestamp() then 'expired' else i.status end,
     'expires_at',i.expires_at,'role_code',i.role_code,'scope_kind',i.scope_kind,
     'display_name',p.display_name) order by i.created_at desc,i.id)
    from pikas_private.platform_customer_admin_intents i left join public.persons p on p.id=i.linked_person_id
    where i.account_id=p_account_id),'[]'::jsonb) else '[]'::jsonb end);
end $$;

notify pgrst, 'reload schema';
commit;
