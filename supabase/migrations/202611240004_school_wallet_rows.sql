-- PIKAS Pilot Hardening: one authority for the School PIKAS Cash list (local; not deployed).
--
-- The School PIKAS Cash page took its summary from school_wallet_report (require_school_admin: the real School Admin or the
-- validated sandbox School Admin POV) but its per-student rows and «Requiere atención» list from a direct student_wallets
-- read under the row policy, which evaluates the signed-in person. Inside a Demo POV the operator holds no tenant
-- capability, so the summary counted wallets while the list showed «Sin monedero» and «Todo en orden».
-- school_wallet_rows returns those same rows (with the student's name, code and status, which the School already sees)
-- under the same require_school_admin authority as the summary. Read only:
-- no wallet mutation, no financial data, no change for real School Admins.
begin;

create function public.school_wallet_rows(p_school_id uuid, p_student_ids uuid[] default null, p_attention boolean default false)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare ctx jsonb;
begin
  ctx := pikas_private.require_school_admin(p_school_id, 'school:wallets:read');
  if p_student_ids is not null and cardinality(p_student_ids) > 100 then raise exception using errcode = '22023', message = 'too_many_students'; end if;
  if p_student_ids is null and not coalesce(p_attention, false) then raise exception using errcode = '22023', message = 'students_or_attention_required'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('student_id', w.student_id, 'status', w.status, 'current_balance_minor', w.current_balance_minor::text,
      'display_name', st.display_name, 'student_code', st.student_code, 'student_status', st.status) order by w.student_id)
    from (select * from public.student_wallets w
          where w.school_id = p_school_id and w.account_id = (ctx->>'account_id')::uuid and w.currency_code = 'DOP'
            and (p_student_ids is null or w.student_id = any(p_student_ids))
            and (not coalesce(p_attention, false) or w.status = 'frozen' or w.current_balance_minor < 0)
          order by w.student_id limit case when coalesce(p_attention, false) then 50 else 100 end) w
    join public.students st on st.id = w.student_id and st.school_id = p_school_id), '[]'::jsonb);
end $$;

revoke all on function public.school_wallet_rows(uuid,uuid[],boolean) from public, anon, service_role;
grant execute on function public.school_wallet_rows(uuid,uuid[],boolean) to authenticated;
do $acl$
begin
  if exists (select 1 from pg_proc p where p.oid = 'public.school_wallet_rows(uuid,uuid[],boolean)'::regprocedure
      and (p.proacl is null or exists (select 1 from aclexplode(p.proacl) a where a.grantee in (0, 'anon'::regrole::oid, 'service_role'::regrole::oid))
        or not has_function_privilege('authenticated', p.oid, 'execute'))) then raise exception 'school_wallet_rows_acl_mismatch'; end if;
end $acl$;

commit;
