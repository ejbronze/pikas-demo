-- PIKAS Pilot Hardening: the last six private functions with default PUBLIC EXECUTE (local; not deployed).
--
-- Audit (2026-10-25):
--   * guard_phase2_identity(), guard_student_enrollment_period(), guard_student_lifecycle(), guard_student_placement_period()
--     (SECURITY INVOKER) and audit_phase2_change() (SECURITY DEFINER) are trigger functions on the student / family /
--     staff / sharing tables. PostgreSQL never lets a trigger function be called directly and checks EXECUTE only when a
--     trigger is created, not when it fires, so no role needs EXECUTE on them: all client grants are removed.
--   * can_read_school_person(uuid) (SECURITY DEFINER) backs the RLS policy persons.person_school_read, which applies to
--     `authenticated` only. Policy expressions run as the querying role, so `authenticated` keeps EXECUTE; PUBLIC (which
--     includes anon) and service_role lose it. anon has no USAGE on pikas_private, so nothing reachable changes.
-- No function body, owner, security mode, search path or role changes. Fails closed if any pikas_private function is
-- still executable by PUBLIC afterwards.
begin;

revoke all on function pikas_private.guard_phase2_identity(), pikas_private.guard_student_enrollment_period(), pikas_private.guard_student_lifecycle(),
  pikas_private.guard_student_placement_period(), pikas_private.audit_phase2_change()
  from public, anon, authenticated, service_role;
revoke all on function pikas_private.can_read_school_person(uuid) from public, anon, service_role;
grant execute on function pikas_private.can_read_school_person(uuid) to authenticated;

do $acl$
declare bad text;
begin
  select string_agg(p.oid::regprocedure::text, ', ') into bad from pg_proc p
   where p.pronamespace = 'pikas_private'::regnamespace
     and (p.proacl is null or exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0 and a.privilege_type = 'EXECUTE'));
  if bad is not null then raise exception 'private_public_execute_remains: %', bad; end if;
  if not has_function_privilege('authenticated', 'pikas_private.can_read_school_person(uuid)', 'execute') then
    raise exception 'person_school_read_policy_would_break'; end if;
end $acl$;

commit;
