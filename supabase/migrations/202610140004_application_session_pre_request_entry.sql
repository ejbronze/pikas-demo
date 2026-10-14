-- 4D.8: expose only a parameterless entry point, never the private schema.
begin;
create function public.pikas_application_session_pre_request()
returns void language plpgsql volatile security definer set search_path = '' as $$
begin
  perform pikas_private.application_session_pre_request();
end $$;
alter function public.pikas_application_session_pre_request() owner to postgres;
revoke all on function public.pikas_application_session_pre_request() from public,anon,authenticated,service_role;
grant execute on function public.pikas_application_session_pre_request() to authenticated,anon,service_role;

-- Replace only the exact known private hook. Never disable or overwrite another guard.
do $$
declare v_setting text; v_existing text; v_seen boolean := false;
begin
  for v_setting in select unnest(setconfig) from pg_db_role_setting
    where setrole=(select oid from pg_roles where rolname='authenticator')
      and setdatabase in (0,(select oid from pg_database where datname=current_database()))
  loop
    if v_setting like 'pgrst.db_pre_request=%' then
      v_existing := substring(v_setting from length('pgrst.db_pre_request=')+1);
      if v_existing <> 'pikas_private.application_session_pre_request' then
        raise exception 'Unexpected existing PostgREST pre-request guard: %',v_existing;
      end if;
      v_seen := true;
    end if;
  end loop;
  if not v_seen then raise exception 'Expected private PostgREST pre-request guard is missing'; end if;
  execute format('alter role authenticator in database %I set pgrst.db_pre_request = %L',current_database(),'public.pikas_application_session_pre_request');
end $$;
notify pgrst, 'reload config';
notify pgrst, 'reload schema';
commit;
