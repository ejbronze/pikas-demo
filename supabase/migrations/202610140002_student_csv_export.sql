-- 4D.7B2C: bounded, read-only export snapshot; no pagination or write contracts changed.
begin;
create function public.school_student_export(p_school_id uuid,p_query text default '',p_status text default '',p_location_id uuid default null,p_grade text default null)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare ctx jsonb; a uuid; rows_value jsonb;
begin
 perform pikas_private.application_session_assert();
 ctx:=pikas_private.require_school_admin(p_school_id,'school:students:read'); a:=(ctx->>'account_id')::uuid;
 if p_query is null or length(p_query)>80 or p_status is null or p_status not in ('','active','suspended','inactive')
  or (p_grade is not null and (length(p_grade)>80 or length(p_grade)=0)) then
  raise exception 'invalid_school_filter' using errcode='22023';
 end if;
 if p_location_id is not null and not exists(select 1 from public.school_locations where id=p_location_id and account_id=a and school_id=p_school_id and status='active') then
  raise exception 'invalid_school_location' using errcode='22023';
 end if;
 -- Projection and limit detection share ONE statement snapshot. The extra row
 -- detects overflow and is never returned as a silently truncated export.
 with selected as (
  select s.id,s.student_code,s.first_name,s.last_name,s.display_name,s.status from public.students s
  where s.account_id=a and s.school_id=p_school_id
   and (p_status='' or s.status=p_status) and position(lower(btrim(p_query)) in lower(s.display_name||' '||s.student_code))>0
   and ((p_location_id is null and p_grade is null) or exists (
    select 1 from public.student_enrollments e join public.student_campus_placements pl on pl.enrollment_id=e.id and pl.status='active'
    where e.student_id=s.id and e.account_id=a and e.school_id=p_school_id and e.status='active'
     and (p_location_id is null or pl.school_location_id=p_location_id) and (p_grade is null or pl.grade_label=p_grade)))
  order by s.id limit 1001
 )
 select coalesce(jsonb_agg(jsonb_build_object('student_code',s.student_code,'first_name',s.first_name,'last_name',s.last_name,
  'display_name',s.display_name,'status',s.status,'campus',l.name,'grade',pl.grade_label,'class',pl.class_label,'homeroom',pl.homeroom_label) order by s.id),'[]'::jsonb)
 into rows_value from selected s left join public.student_enrollments e on e.student_id=s.id and e.status='active'
 left join public.student_campus_placements pl on pl.enrollment_id=e.id and pl.status='active'
 left join public.school_locations l on l.id=pl.school_location_id and l.account_id=a and l.school_id=p_school_id;
 if jsonb_array_length(rows_value)>1000 then raise exception 'student_export_limit' using errcode='54000'; end if;
 perform pikas_private.application_session_assert();
 ctx:=pikas_private.require_school_admin(p_school_id,'school:students:read');
 return jsonb_build_object('school_id',p_school_id,'actor_id',(ctx->>'actor_id')::uuid,'rows',rows_value);
end $$;
revoke all on function public.school_student_export(uuid,text,text,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.school_student_export(uuid,text,text,uuid,text) to authenticated;
notify pgrst, 'reload schema';
commit;
