-- 4D.7B2B additive roster projection. Existing reads, commands and bulk semantics remain intact.
begin;
create function public.school_student_roster(p_school_id uuid,p_query text default '',p_status text default '',p_after uuid default null,p_limit integer default 50,p_location_id uuid default null,p_grade text default null)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare ctx jsonb; a uuid; result jsonb; rows_value jsonb; cursor_value uuid; grades jsonb;
begin
 perform pikas_private.application_session_assert();
 ctx:=pikas_private.require_school_admin(p_school_id,'school:students:read'); a:=(ctx->>'account_id')::uuid;
 if p_query is null or length(p_query)>80 or p_status is null or p_status not in ('','active','suspended','inactive')
  or p_limit is null or p_limit not between 1 and 100 or (p_grade is not null and (length(p_grade)>80 or length(p_grade)=0)) then
  raise exception 'invalid_school_filter' using errcode='22023';
 end if;
 if p_location_id is not null and not exists(select 1 from public.school_locations where id=p_location_id and account_id=a and school_id=p_school_id and status='active') then
  raise exception 'invalid_school_location' using errcode='22023';
 end if;
 with selected as (
  select s.* from public.students s where s.account_id=a and s.school_id=p_school_id and (p_after is null or s.id>p_after)
  and (p_status='' or s.status=p_status) and position(lower(btrim(p_query)) in lower(s.display_name||' '||s.student_code))>0
  and ((p_location_id is null and p_grade is null) or exists (
   select 1 from public.student_enrollments e join public.student_campus_placements pl on pl.enrollment_id=e.id and pl.status='active'
   where e.student_id=s.id and e.account_id=a and e.school_id=p_school_id and e.status='active'
    and (p_location_id is null or pl.school_location_id=p_location_id) and (p_grade is null or pl.grade_label=p_grade)))
  order by s.id limit p_limit+1
 ), page as (select * from selected order by id limit p_limit)
 select coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'first_name',s.first_name,'last_name',s.last_name,'display_name',s.display_name,
  'student_code',s.student_code,'status',s.status,'enrollment',(select jsonb_build_object('id',e.id,'starts_on',e.starts_on,'location_id',pl.school_location_id,
  'grade',pl.grade_label,'class',pl.class_label,'homeroom',pl.homeroom_label) from public.student_enrollments e
  left join public.student_campus_placements pl on pl.enrollment_id=e.id and pl.status='active' where e.student_id=s.id and e.status='active')) order by s.id) from page s),'[]'::jsonb),
  case when (select count(*) from selected)>p_limit then (select id from page order by id desc limit 1) end into rows_value,cursor_value;
 select coalesce(jsonb_agg(grade_label order by grade_label),'[]'::jsonb) into grades from (
  select distinct pl.grade_label from public.student_campus_placements pl join public.student_enrollments e on e.id=pl.enrollment_id
  where e.account_id=a and e.school_id=p_school_id and e.status='active' and pl.status='active' and pl.grade_label is not null and pl.grade_label<>''
 ) g;
 perform pikas_private.application_session_assert();
 ctx:=pikas_private.require_school_admin(p_school_id,'school:students:read');
 result:=jsonb_build_object('scope',ctx,'rows',rows_value,'next_cursor',cursor_value,'grades',grades,'locations',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name) order by name,id) from public.school_locations where account_id=a and school_id=p_school_id and status='active'),'[]'::jsonb));
 return result;
end $$;
revoke all on function public.school_student_roster(uuid,text,text,uuid,integer,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.school_student_roster(uuid,text,text,uuid,integer,uuid,text) to authenticated;
notify pgrst, 'reload schema';
commit;
