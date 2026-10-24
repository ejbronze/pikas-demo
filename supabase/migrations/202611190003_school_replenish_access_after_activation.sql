-- PIKAS FIN 4 follow-up (local; not deployed): the School's wallet access tells the truth after activation.
--
-- Since FIN 2, post_manual_wallet_replenishment refuses a School top-up for a fee-era (activated) customer
-- (`collection_source_required`): positive fee-era value must come from a verified bank transfer or Cafetería cash.
-- school_wallet_access still reported `replenish: true`, so the School saw a «Recargar» action that could only fail.
-- It now reports `replenish: false` for an activated customer. Same shape; reads, legacy reversals and adjustments are
-- unchanged; the database guard stays the authority. No financial semantics change.
begin;

create or replace function public.school_wallet_access(p_school_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare a uuid; pov boolean;
begin
 select s.account_id into a from public.schools s where s.id=p_school_id;
 pov:=exists(select 1 from pikas_private.sandbox_validated_pov());
 return jsonb_build_object('school_id',p_school_id,
  'read',a is not null and pikas_private.sandbox_admin_has_capability('school_admin','school:wallets:read',a,p_school_id),
  'replenish',a is not null and not pov and pikas_private.financial_activation(a) is null and pikas_private.has_capability('school:wallets:replenish',a,p_school_id),
  'reverse',a is not null and not pov and pikas_private.has_capability('school:wallets:reverse_replenishment',a,p_school_id),
  'adjust',a is not null and not pov and pikas_private.has_capability('school:wallets:administrative_adjust',a,p_school_id));
end $function$;

revoke all on function public.school_wallet_access(uuid) from public, anon, service_role;
grant execute on function public.school_wallet_access(uuid) to authenticated;
do $acl$ begin
  if has_function_privilege('anon','public.school_wallet_access(uuid)','execute')
    or exists (select 1 from pg_proc p, aclexplode(p.proacl) a where p.oid='public.school_wallet_access(uuid)'::regprocedure and a.grantee=0)
    or not has_function_privilege('authenticated','public.school_wallet_access(uuid)','execute') then raise exception 'fin4_acl_mismatch'; end if;
end $acl$;

commit;
