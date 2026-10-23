-- Permission helper ACL hardening.
-- 202610300001 renamed three private permission helpers to *_tenant and created new wrapper functions under the
-- original names. CREATE FUNCTION gives a new function PUBLIC EXECUTE by default, and the wrappers were never
-- revoked, so they drifted from the original authority model (the renamed *_tenant originals kept it).
-- This migration restores exactly that model. It changes privileges only: no function body, security mode,
-- capability, role, grant to business data, RLS policy or row is touched.
--
--   has_capability(text,uuid,uuid,uuid)                      authenticated only (foundation contract, 202609300001)
--   require_cafeteria_admin(uuid,boolean)                    owner only (called solely from SECURITY DEFINER RPCs)
--   sandbox_admin_has_capability(text,text,uuid,uuid,uuid)   owner only (called solely from SECURITY DEFINER RPCs)
--
-- Callers audited: all 42 RLS policies reference the *_tenant originals; the three wrappers are called only by
-- 78 SECURITY DEFINER functions owned by postgres; no view, trigger, invoker function or application code calls them.
begin;

revoke all on function pikas_private.has_capability(text,uuid,uuid,uuid) from public, anon, authenticated, service_role;
grant execute on function pikas_private.has_capability(text,uuid,uuid,uuid) to authenticated;

revoke all on function pikas_private.require_cafeteria_admin(uuid,boolean) from public, anon, authenticated, service_role;

revoke all on function pikas_private.sandbox_admin_has_capability(text,text,uuid,uuid,uuid) from public, anon, authenticated, service_role;

-- Fail closed unless the resulting privileges are exactly the intended model.
do $acl$
begin
  if has_function_privilege('anon','pikas_private.has_capability(text,uuid,uuid,uuid)','execute')
    or has_function_privilege('service_role','pikas_private.has_capability(text,uuid,uuid,uuid)','execute')
    or not has_function_privilege('authenticated','pikas_private.has_capability(text,uuid,uuid,uuid)','execute')
    or has_function_privilege('anon','pikas_private.require_cafeteria_admin(uuid,boolean)','execute')
    or has_function_privilege('authenticated','pikas_private.require_cafeteria_admin(uuid,boolean)','execute')
    or has_function_privilege('service_role','pikas_private.require_cafeteria_admin(uuid,boolean)','execute')
    or has_function_privilege('anon','pikas_private.sandbox_admin_has_capability(text,text,uuid,uuid,uuid)','execute')
    or has_function_privilege('authenticated','pikas_private.sandbox_admin_has_capability(text,text,uuid,uuid,uuid)','execute')
    or has_function_privilege('service_role','pikas_private.sandbox_admin_has_capability(text,text,uuid,uuid,uuid)','execute')
  then
    raise exception 'permission_helper_acl_hardening_mismatch';
  end if;
end
$acl$;

commit;
