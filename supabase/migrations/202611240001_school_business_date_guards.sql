-- PIKAS Pilot Hardening: enrollment dates are the school's business date (local; not deployed).
--
-- Five student-enrollment guards compared dates with the database session's current_date, which is UTC in production.
-- From about 20:00 to 24:00 America/Santo_Domingo the UTC date is already tomorrow, so a start, placement, transfer or
-- withdrawal dated TOMORROW in the school's own calendar was accepted (and the School form proposed exactly that date).
-- They now compare with the school's business date (schools.business_timezone). Validation is tightened, never relaxed:
-- today stays valid at every hour; tomorrow is refused at every hour. Same signatures, same ACLs, no data change.
begin;

create function pikas_private.school_business_date(p_school_id uuid) returns date
language sql stable security definer set search_path = '' as $$
  select (pg_catalog.clock_timestamp() at time zone coalesce((select s.business_timezone from public.schools s where s.id = p_school_id), 'America/Santo_Domingo'))::date
$$;
revoke all on function pikas_private.school_business_date(uuid) from public, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION pikas_private.guard_student_enrollment_period()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(new.student_id::text,0));
  if new.status='active' and new.starts_on>pikas_private.school_business_date(new.school_id) then
    raise exception using errcode='23514',message='active_enrollment_cannot_start_in_future';
  end if;
  if new.status='active' and not exists(select 1 from public.students s where s.id=new.student_id and s.status='active') then
    raise exception using errcode='23514',message='active_enrollment_requires_active_student';
  end if;
  if exists(select 1 from public.student_enrollments e where e.student_id=new.student_id and e.id<>new.id
    and daterange(e.starts_on,e.ends_on,'[)') && daterange(new.starts_on,new.ends_on,'[)')) then
    raise exception using errcode='23P01',message='student_enrollment_period_overlap';
  end if;
  if new.status<>'active' and exists(select 1 from public.student_campus_placements p
      where p.enrollment_id=new.id and p.status='active') then
    raise exception using errcode='23514',message='end_active_placement_before_enrollment';
  end if;
  if exists(select 1 from public.student_campus_placements p where p.enrollment_id=new.id
      and (p.starts_on<new.starts_on or (new.ends_on is not null and (p.ends_on is null or p.ends_on>new.ends_on)))) then
    raise exception using errcode='23514',message='placement_outside_enrollment_period';
  end if;
  return new;
end $function$;

CREATE OR REPLACE FUNCTION pikas_private.guard_student_placement_period()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare enrollment_start date; enrollment_end date; enrollment_status text;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(new.enrollment_id::text,1));
  select e.starts_on,e.ends_on,e.status into enrollment_start,enrollment_end,enrollment_status
    from public.student_enrollments e where e.id=new.enrollment_id;
  if new.starts_on<enrollment_start or (enrollment_end is not null and (new.ends_on is null or new.ends_on>enrollment_end)) then
    raise exception using errcode='23514',message='placement_outside_enrollment_period';
  end if;
  if new.status='active' and new.starts_on>pikas_private.school_business_date(new.school_id) then
    raise exception using errcode='23514',message='active_placement_cannot_start_in_future';
  end if;
  if new.status='active' and enrollment_status is distinct from 'active' then
    raise exception using errcode='23514',message='active_placement_requires_active_enrollment';
  end if;
  if new.status='active' and new.school_location_id is not null and not exists(select 1 from public.school_locations l
      where l.id=new.school_location_id and l.account_id=new.account_id and l.school_id=new.school_id and l.status='active') then
    raise exception using errcode='23514',message='active_placement_requires_active_campus';
  end if;
  if exists(select 1 from public.student_campus_placements p where p.enrollment_id=new.enrollment_id and p.id<>new.id
    and daterange(p.starts_on,p.ends_on,'[)') && daterange(new.starts_on,new.ends_on,'[)')) then
    raise exception using errcode='23P01',message='student_placement_period_overlap';
  end if;
  return new;
end $function$;

CREATE OR REPLACE FUNCTION pikas_private.student_bulk_check(p_school_id uuid, p_rows jsonb, p_included_rows integer[] DEFAULT NULL::integer[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
   if date_value>pikas_private.school_business_date(p_school_id) then raise exception 'future'; end if;
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
end $function$;

CREATE OR REPLACE FUNCTION public.transfer_student_campus(p_account_id uuid, p_school_id uuid, p_enrollment_id uuid, p_effective_on date, p_school_location_id uuid, p_grade_label text DEFAULT NULL::text, p_class_label text DEFAULT NULL::text, p_homeroom_label text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare placement_id uuid; current_placement_id uuid;
begin
 if nullif(current_setting('pikas.admin_pov_session',true),'') is null then perform pikas_private.begin_sandbox_admin_command('school_admin'); end if;
 perform pikas_private.revalidate_sandbox_admin_command();
  if not pikas_private.sandbox_admin_has_capability('school_admin','school:students:manage',p_account_id,p_school_id) then
    raise exception using errcode='42501',message='not_authorized';
  end if;
  if p_effective_on>pikas_private.school_business_date(p_school_id) then raise exception using errcode='22023',message='transfer_effective_date_cannot_be_future'; end if;
  if not exists(select 1 from public.student_enrollments e where e.id=p_enrollment_id
      and e.account_id=p_account_id and e.school_id=p_school_id and e.status='active') then
    raise exception using errcode='23503',message='active_enrollment_not_found_in_school';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_enrollment_id::text,1));
  select p.id into current_placement_id from public.student_campus_placements p
    where p.account_id=p_account_id and p.school_id=p_school_id and p.enrollment_id=p_enrollment_id
      and p.status='active' and p.starts_on=p_effective_on and p.school_location_id=p_school_location_id
      and p.grade_label is not distinct from p_grade_label
      and p.class_label is not distinct from p_class_label
      and p.homeroom_label is not distinct from p_homeroom_label;
  if current_placement_id is not null then return current_placement_id; end if;
  update public.student_campus_placements set status='ended',ends_on=p_effective_on
    where account_id=p_account_id and school_id=p_school_id and enrollment_id=p_enrollment_id
      and status='active' and starts_on<p_effective_on;
  if not found then raise exception using errcode='23514',message='transfer_requires_current_placement_and_later_date'; end if;
  insert into public.student_campus_placements(account_id,school_id,enrollment_id,school_location_id,
    grade_label,class_label,homeroom_label,starts_on)
  values(p_account_id,p_school_id,p_enrollment_id,p_school_location_id,p_grade_label,p_class_label,p_homeroom_label,p_effective_on)
  returning id into placement_id;
  return placement_id;
end $function$;

CREATE OR REPLACE FUNCTION public.withdraw_student_enrollment(p_account_id uuid, p_school_id uuid, p_enrollment_id uuid, p_ends_on date)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare enrollment_student_id uuid; enrollment_status text; enrollment_end date;
begin
 if nullif(current_setting('pikas.admin_pov_session',true),'') is null then perform pikas_private.begin_sandbox_admin_command('school_admin'); end if;
 perform pikas_private.revalidate_sandbox_admin_command();
  if not pikas_private.sandbox_admin_has_capability('school_admin','school:students:manage',p_account_id,p_school_id) then
    raise exception using errcode='42501',message='not_authorized';
  end if;
  if p_ends_on>pikas_private.school_business_date(p_school_id) then raise exception using errcode='22023',message='withdrawal_effective_date_cannot_be_future'; end if;
  select e.student_id into enrollment_student_id from public.student_enrollments e
    where e.id=p_enrollment_id and e.account_id=p_account_id and e.school_id=p_school_id;
  if not found then raise exception using errcode='23503',message='enrollment_not_found_in_school'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(enrollment_student_id::text,0));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_enrollment_id::text,1));
  select e.status,e.ends_on into enrollment_status,enrollment_end from public.student_enrollments e
    where e.id=p_enrollment_id and e.account_id=p_account_id and e.school_id=p_school_id for update;
  if enrollment_status='withdrawn' and enrollment_end=p_ends_on
      and not exists(select 1 from public.student_campus_placements p where p.enrollment_id=p_enrollment_id and p.status='active') then
    return;
  end if;
  update public.student_campus_placements set status='ended',ends_on=p_ends_on
    where account_id=p_account_id and school_id=p_school_id and enrollment_id=p_enrollment_id
      and status='active' and starts_on<p_ends_on;
  update public.student_enrollments set status='withdrawn',ends_on=p_ends_on
    where id=p_enrollment_id and account_id=p_account_id and school_id=p_school_id and status='active' and starts_on<p_ends_on;
  if not found then raise exception using errcode='23514',message='withdrawal_requires_current_enrollment_and_later_date'; end if;
end $function$;

do $acl$
begin
  if exists (select 1 from pg_proc p where p.oid = 'pikas_private.school_business_date(uuid)'::regprocedure
      and (p.proacl is null or exists (select 1 from aclexplode(p.proacl) a where a.grantee <> p.proowner))) then
    raise exception 'school_business_date_acl_mismatch'; end if;
end $acl$;

commit;
