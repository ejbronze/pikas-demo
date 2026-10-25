-- PIKAS Pilot Hardening: one authority for the School sharing state (local; not deployed).
--
-- School · Resumen took «Cafetería compartida · COMPLETO» from school_admin_read (require_school_admin: the real School
-- Admin or the validated sandbox School Admin POV), but each cafetería's label from a direct school_cafeteria_shares read
-- under the row policy, which evaluates the signed-in person. Inside a Demo POV that read is empty, so the same cafetería
-- showed «Sin compartir todavía» beside COMPLETO. school_sharing_rows returns the School's own share rows (cafetería and
-- status only: the facts that tell «revocada» from «nunca compartida») under the same authority. Read only.
begin;

create function public.school_sharing_rows(p_school_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare ctx jsonb;
begin
  ctx := pikas_private.require_school_admin(p_school_id, 'school:sharing:read');
  return coalesce((select jsonb_agg(jsonb_build_object('cafeteria_id', sh.cafeteria_id, 'status', sh.status) order by sh.cafeteria_id)
    from public.school_cafeteria_shares sh where sh.school_id = p_school_id and sh.account_id = (ctx->>'account_id')::uuid), '[]'::jsonb);
end $$;

revoke all on function public.school_sharing_rows(uuid) from public, anon, service_role;
grant execute on function public.school_sharing_rows(uuid) to authenticated;
do $acl$
begin
  if exists (select 1 from pg_proc p where p.oid = 'public.school_sharing_rows(uuid)'::regprocedure
      and (p.proacl is null or exists (select 1 from aclexplode(p.proacl) a where a.grantee in (0, 'anon'::regrole::oid, 'service_role'::regrole::oid))
        or not has_function_privilege('authenticated', p.oid, 'execute'))) then raise exception 'school_sharing_rows_acl_mismatch'; end if;
end $acl$;

commit;
