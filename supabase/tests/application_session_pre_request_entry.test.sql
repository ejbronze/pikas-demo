-- Local rollback-only ACL/entry and fail-closed configuration checks.
begin;
create extension if not exists pgtap with schema extensions;
set search_path=public,extensions;
select no_plan();
select ok(not has_schema_privilege('anon','pikas_private','USAGE'),'anon has no private schema usage');
select ok(not has_schema_privilege('service_role','pikas_private','USAGE'),'service has no private schema usage');
select ok(not has_function_privilege('anon','pikas_private.application_session_pre_request()','EXECUTE'),'anon private hook execution unchanged');
select ok(not has_function_privilege('service_role','pikas_private.application_session_pre_request()','EXECUTE'),'service private hook execution unchanged');
select ok(has_function_privilege('authenticated','public.pikas_application_session_pre_request()','EXECUTE'),'authenticated public entry');
select ok(has_function_privilege('anon','public.pikas_application_session_pre_request()','EXECUTE'),'anon public entry');
select ok(has_function_privilege('service_role','public.pikas_application_session_pre_request()','EXECUTE'),'service public entry');
select ok(not exists(select 1 from pg_proc p cross join lateral aclexplode(p.proacl) a where p.oid='public.pikas_application_session_pre_request()'::regprocedure and a.grantee=0),'PUBLIC has no default execution');
select ok(not exists(select 1 from pg_proc p cross join lateral aclexplode(p.proacl) a left join pg_roles r on r.oid=a.grantee where p.oid='public.pikas_application_session_pre_request()'::regprocedure and coalesce(r.rolname,'PUBLIC') not in ('postgres','authenticated','anon','service_role')),'no unexpected wrapper grantees');
select ok((select prosecdef and provolatile='v' and pronargs=0 and prorettype='void'::regtype and pg_get_userbyid(proowner)='postgres' and proconfig=array['search_path=""'] from pg_proc where oid='public.pikas_application_session_pre_request()'::regprocedure),'wrapper fixed trusted definer volatile parameterless void empty search path');
select ok(not has_function_privilege('authenticated','public.activation_provider_context(text,text)','EXECUTE'),'authenticated provider permission unchanged');
select ok(not has_function_privilege('anon','public.activation_provider_context(text,text)','EXECUTE'),'anon provider permission unchanged');
select ok(has_function_privilege('service_role','public.activation_provider_context(text,text)','EXECUTE'),'service provider permission unchanged');
select lives_ok('set local role anon;select public.pikas_application_session_pre_request();reset role;','anon enters unchanged role branch');
select lives_ok('set local role service_role;select public.pikas_application_session_pre_request();reset role;','service enters unchanged role branch');
-- Guard test function uses the exact new migration guard body (included by harness).
create function pg_temp.check_entry_config() returns void language plpgsql as $$
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
do $$begin execute format('alter role authenticator in database %I set pgrst.db_pre_request = %L',current_database(),'public.unexpected_guard');end$$;
select throws_ok($q$select pg_temp.check_entry_config()$q$,'P0001','Unexpected existing PostgREST pre-request guard: public.unexpected_guard','unknown hook rejected');
select ok(exists(select 1 from pg_db_role_setting cross join lateral unnest(setconfig) c where setrole=(select oid from pg_roles where rolname='authenticator') and setdatabase=(select oid from pg_database where datname=current_database()) and c='pgrst.db_pre_request=public.unexpected_guard'),'unknown hook not overwritten');
do $$begin execute format('alter role authenticator in database %I reset pgrst.db_pre_request',current_database());end$$;
select throws_ok($q$select pg_temp.check_entry_config()$q$,'P0001','Expected private PostgREST pre-request guard is missing','missing hook rejected');
do $$begin execute format('alter role authenticator in database %I set pgrst.db_pre_request = %L',current_database(),'pikas_private.application_session_pre_request');end$$;
select lives_ok($q$select pg_temp.check_entry_config()$q$,'exact expected private guard accepted');
select ok(exists(select 1 from pg_db_role_setting cross join lateral unnest(setconfig) c where setrole=(select oid from pg_roles where rolname='authenticator') and setdatabase=(select oid from pg_database where datname=current_database()) and c='pgrst.db_pre_request=public.pikas_application_session_pre_request'),'configuration resolves to wrapper');
select * from finish();
rollback;
