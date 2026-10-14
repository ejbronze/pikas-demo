-- 4D.7B2A: create-and-enroll only. No changes to single commands or session policy.
begin;
create table pikas_private.student_bulk_requests (
 request_id uuid primary key, actor_auth_id uuid not null, actor_person_id uuid not null references public.persons(id),
 account_id uuid not null, school_id uuid not null, fingerprint text not null, response jsonb not null,
 sandbox_pov_session_id uuid references pikas_private.sandbox_pov_sessions(id),
 created_at timestamptz not null default now(),
 foreign key(account_id,school_id) references public.schools(account_id,id)
);
alter table pikas_private.student_bulk_requests enable row level security;
revoke all on pikas_private.student_bulk_requests from public,anon,authenticated,service_role;
create trigger student_bulk_requests_immutable before update or delete on pikas_private.student_bulk_requests
 for each row execute function pikas_private.reject_audit_mutation();
create trigger student_bulk_requests_no_truncate before truncate on pikas_private.student_bulk_requests
 execute function pikas_private.reject_audit_mutation();

create function pikas_private.student_bulk_normalize(p_rows jsonb) returns jsonb
language plpgsql stable set search_path='' as $$
declare r jsonb; k text; result jsonb:='[]'::jsonb;
begin
 if p_rows is null or jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows) not between 1 and 200 then
  raise exception 'student_bulk_row_limit' using errcode='22023'; end if;
 if octet_length(p_rows::text)>1048576 then raise exception 'student_bulk_payload_limit' using errcode='22023'; end if;
 for r in select value from jsonb_array_elements(p_rows) loop
  if jsonb_typeof(r)<>'object' or jsonb_typeof(r->'source_row') is distinct from 'number'
    or (r->>'source_row') !~ '^[1-9][0-9]{0,6}$' then raise exception 'invalid_source_row' using errcode='22023'; end if;
  foreach k in array array['first_name','last_name','student_code','grade','class','homeroom'] loop
   if jsonb_typeof(r->k)='string' then
    r:=jsonb_set(r,array[k],case when k in ('grade','class','homeroom') and btrim(r->>k)='' then 'null'::jsonb else to_jsonb(btrim(r->>k)) end);
   elsif k in ('grade','class','homeroom') and not(r?k) then r:=r||jsonb_build_object(k,null); end if;
  end loop;
  if not(r?'location_id') or r->>'location_id'='' then r:=r||jsonb_build_object('location_id',null); end if;
  result:=result||jsonb_build_array(r);
 end loop;
 if (select count(distinct (value->>'source_row')::int) from jsonb_array_elements(result))<>jsonb_array_length(result) then
  raise exception 'duplicate_source_row' using errcode='22023'; end if;
 return (select jsonb_agg(value order by (value->>'source_row')::int) from jsonb_array_elements(result));
end $$;

create function pikas_private.student_bulk_check(p_school_id uuid,p_rows jsonb,p_included_rows integer[] default null) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare ctx jsonb; normalized jsonb; r jsonb; errors jsonb; result jsonb:='[]'::jsonb; k text; location uuid; date_value date;
begin
 perform pikas_private.application_session_assert();
 ctx:=pikas_private.require_school_admin(p_school_id,'school:students:manage');
 normalized:=pikas_private.student_bulk_normalize(p_rows);
 for r in select value from jsonb_array_elements(normalized) loop
  errors:='[]';
  if exists(select 1 from jsonb_object_keys(r) key where key<>all(array['source_row','first_name','last_name','student_code','starts_on','location_id','grade','class','homeroom'])) then errors:=errors||'"unknown_field"'::jsonb; end if;
  foreach k in array array['first_name','last_name','student_code'] loop
   if jsonb_typeof(r->k) is distinct from 'string' or length(r->>k) not between 1 and (case k when 'student_code' then 64 else 80 end) then errors:=errors||to_jsonb(k||'_invalid'); end if;
  end loop;
  foreach k in array array['grade','class','homeroom'] loop
   if jsonb_typeof(r->k) is distinct from 'null' and (jsonb_typeof(r->k) is distinct from 'string' or length(r->>k)>80) then errors:=errors||to_jsonb(k||'_invalid'); end if;
  end loop;
  begin
   if jsonb_typeof(r->'starts_on') is distinct from 'string' or (r->>'starts_on') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then raise exception 'invalid'; end if;
   date_value:=(r->>'starts_on')::date;
   if date_value>current_date then raise exception 'future'; end if;
  exception when others then errors:=errors||'"starts_on_invalid"'::jsonb; end;
  if jsonb_typeof(r->'location_id') is distinct from 'null' then
   begin
    if jsonb_typeof(r->'location_id') is distinct from 'string' then raise exception 'invalid'; end if;
    location:=(r->>'location_id')::uuid;
    if p_included_rows is not null and (r->>'source_row')::int=any(p_included_rows) then
     -- Match single-create's campus stabilization during the entire confirmed batch.
     perform 1 from public.school_locations where id=location and school_id=p_school_id and account_id=(ctx->>'account_id')::uuid and status='active' for share;
     if not found then raise exception 'invalid'; end if;
    elsif not exists(select 1 from public.school_locations where id=location and school_id=p_school_id and account_id=(ctx->>'account_id')::uuid and status='active') then raise exception 'invalid'; end if;
    r:=r||jsonb_build_object('location_id',location);
   exception when others then errors:=errors||'"location_invalid"'::jsonb; end;
  end if;
  if jsonb_typeof(r->'student_code')='string' and length(r->>'student_code')>0 then
   if (select count(*) from jsonb_array_elements(normalized) x where lower(x->>'student_code')=lower(r->>'student_code') and (p_included_rows is null or (x->>'source_row')::int=any(p_included_rows)))>1 then errors:=errors||'"duplicate_code"'::jsonb; end if;
   if exists(select 1 from public.students where school_id=p_school_id and code_key=lower(r->>'student_code')) then errors:=errors||'"existing_code"'::jsonb; end if;
  end if;
  result:=result||jsonb_build_array(jsonb_build_object('source_row',(r->>'source_row')::int,'row',r,'errors',errors));
 end loop;
 perform pikas_private.application_session_assert();
 perform pikas_private.require_school_admin(p_school_id,'school:students:manage');
 return jsonb_build_object('school_id',p_school_id,'valid',not exists(select 1 from jsonb_array_elements(result) x where jsonb_array_length(x->'errors')>0),'rows',result);
end $$;

create function public.school_student_bulk_validate(p_school_id uuid,p_rows jsonb) returns jsonb
language sql volatile security definer set search_path='' as $$
 select pikas_private.student_bulk_check(p_school_id,p_rows);
$$;

create function public.school_student_bulk_commit(p_school_id uuid,p_request_id uuid,p_rows jsonb,p_included_rows integer[],p_confirmed boolean) returns jsonb
language plpgsql volatile security definer set search_path='' set statement_timeout='30s' as $$
declare ctx jsonb; rows_value jsonb; validation jsonb; fingerprint text; prior pikas_private.student_bulk_requests;
 r jsonb; code text; person uuid; student uuid; enrollment uuid; created jsonb:='[]'::jsonb; result jsonb;
begin
 perform pikas_private.application_session_assert();
 perform pikas_private.begin_sandbox_admin_command('school_admin');
 ctx:=pikas_private.require_school_admin(p_school_id,'school:students:manage',true);
 rows_value:=pikas_private.student_bulk_normalize(p_rows);
 if p_request_id is null or p_confirmed is distinct from true or cardinality(p_included_rows) not between 1 and 200 or p_included_rows is null
  or exists(select 1 from unnest(p_included_rows) n where n is null or not exists(select 1 from jsonb_array_elements(rows_value) input_row where (input_row->>'source_row')::int=n))
  or (select count(distinct n) from unnest(p_included_rows) n)<>cardinality(p_included_rows) then raise exception 'invalid_confirmed_selection' using errcode='22023'; end if;
 if octet_length(jsonb_build_object('school',p_school_id,'rows',rows_value,'included_rows',p_included_rows)::text)>1048576 then raise exception 'student_bulk_payload_limit' using errcode='22023'; end if;
 fingerprint:=pikas_private.platform_request_fingerprint(jsonb_build_object('version',1,'school',p_school_id,'rows',rows_value,
  'included_rows',(select jsonb_agg(n order by n) from unnest(p_included_rows) n)));
 perform pg_advisory_xact_lock(hashtextextended(p_request_id::text,202610130002));
 perform pikas_private.application_session_assert();
 perform pikas_private.require_school_admin(p_school_id,'school:students:manage',true);
 select * into prior from pikas_private.student_bulk_requests where request_id=p_request_id;
 if found then
  if prior.actor_auth_id is distinct from auth.uid() or prior.actor_person_id<>(ctx->>'actor_id')::uuid or prior.school_id<>p_school_id or prior.fingerprint<>fingerprint then raise exception 'student_bulk_request_conflict' using errcode='23505'; end if;
  perform set_config('pikas.admin_pov_session','',true); return prior.response;
 end if;
 -- PostgREST hoists this RPC's 30s statement budget; no role/global timeout is changed.
 -- Common code locks serialize competing batches in a stable order; the unique index also
 -- protects races with unchanged single-student commands and direct authorized writers.
 for code in select distinct lower(value->>'student_code') from jsonb_array_elements(rows_value) where (value->>'source_row')::int=any(p_included_rows) order by 1 loop
  perform pg_advisory_xact_lock(hashtextextended(p_school_id::text||':'||coalesce(code,''),202610130003));
 end loop;
 perform pikas_private.application_session_assert();
 perform pikas_private.require_school_admin(p_school_id,'school:students:manage',true);
 validation:=pikas_private.student_bulk_check(p_school_id,rows_value,p_included_rows);
 if exists(select 1 from jsonb_array_elements(validation->'rows') x where (x->>'source_row')::int=any(p_included_rows) and jsonb_array_length(x->'errors')>0) then
  perform set_config('pikas.admin_pov_session','',true); return validation||jsonb_build_object('status','invalid','request_id',p_request_id);
 end if;
 for r in select value->'row' from jsonb_array_elements(validation->'rows') where (value->>'source_row')::int=any(p_included_rows) order by (value->>'source_row')::int loop
  person:=public.create_school_person((ctx->>'account_id')::uuid,p_school_id,(r->>'first_name')||' '||(r->>'last_name'),'student');
  student:=public.create_student((ctx->>'account_id')::uuid,p_school_id,person,r->>'student_code',r->>'first_name',r->>'last_name',(r->>'first_name')||' '||(r->>'last_name'));
  enrollment:=public.enroll_student((ctx->>'account_id')::uuid,p_school_id,student,(r->>'starts_on')::date,(r->>'location_id')::uuid,r->>'grade',r->>'class',r->>'homeroom');
  created:=created||jsonb_build_array(jsonb_build_object('source_row',(r->>'source_row')::int,'student_id',student,'enrollment_id',enrollment));
 end loop;
 perform pikas_private.application_session_assert();
 perform pikas_private.require_school_admin(p_school_id,'school:students:manage',true);
 result:=jsonb_build_object('status','committed','request_id',p_request_id,'school_id',p_school_id,'created',created,'excluded_rows',
  (select coalesce(jsonb_agg((value->>'source_row')::int order by (value->>'source_row')::int),'[]') from jsonb_array_elements(rows_value) where not((value->>'source_row')::int=any(p_included_rows))));
 insert into pikas_private.student_bulk_requests(request_id,actor_auth_id,actor_person_id,account_id,school_id,fingerprint,response,sandbox_pov_session_id)
 values(p_request_id,auth.uid(),(ctx->>'actor_id')::uuid,(ctx->>'account_id')::uuid,p_school_id,fingerprint,result,nullif(current_setting('pikas.admin_pov_session',true),'')::uuid);
 perform set_config('pikas.admin_pov_session','',true); return result;
end $$;
revoke all on function pikas_private.student_bulk_normalize(jsonb),pikas_private.student_bulk_check(uuid,jsonb,integer[]),public.school_student_bulk_validate(uuid,jsonb),public.school_student_bulk_commit(uuid,uuid,jsonb,integer[],boolean) from public,anon,authenticated,service_role;
grant execute on function public.school_student_bulk_validate(uuid,jsonb),public.school_student_bulk_commit(uuid,uuid,jsonb,integer[],boolean) to authenticated;
notify pgrst, 'reload schema';
commit;
