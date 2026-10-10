-- 4D.2: customer-owned school workspace. No platform, POS or financial authority changes.
begin;
-- Account administrators need the same school-owned operations across their descendants.
insert into pikas_private.role_capabilities(scope_kind,role_code,capability)
select 'account','account_admin',capability from pikas_private.role_capabilities
where scope_kind='school' and role_code='school_admin' and capability in
 ('school:students:read','school:students:manage','school:sharing:read','school:sharing:manage','school:customers:read','school:customers:manage')
on conflict do nothing;
insert into pikas_private.role_capabilities values
 ('account','account_admin','school:administrators:manage'),('school','school_admin','school:administrators:manage') on conflict do nothing;

create table pikas_private.school_admin_requests(
 request_id uuid primary key, actor_person_id uuid not null references public.persons(id),
 actor_auth_id uuid not null, account_id uuid not null, school_id uuid not null,
 fingerprint text not null, response jsonb not null, created_at timestamptz not null default now(),
 foreign key(account_id,school_id) references public.schools(account_id,id)
);
alter table pikas_private.school_admin_requests enable row level security;
revoke all on pikas_private.school_admin_requests from public,anon,authenticated,service_role;
create trigger school_requests_immutable before update or delete on pikas_private.school_admin_requests
 for each row execute function pikas_private.reject_audit_mutation();
create trigger school_requests_no_truncate before truncate on pikas_private.school_admin_requests
 execute function pikas_private.reject_audit_mutation();

create function pikas_private.require_school_admin(p_school_id uuid,p_capability text,p_lock boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid; a uuid; membership uuid; role_value text; kind text; school_name text; account_name text;
begin
 actor:=pikas_private.current_person_id();
 select s.account_id,s.name,ac.name,ac.tenant_kind into a,school_name,account_name,kind
 from public.schools s join public.accounts ac on ac.id=s.account_id where s.id=p_school_id;
 if actor is null or a is null then raise exception using errcode='42501',message='school_authority_required'; end if;
 if p_lock then
   -- Stabilize real identity, scope and membership before legacy RPCs can wait on locks.
   perform 1 from public.persons where id=actor for share;
   perform 1 from public.accounts where id=a for share;
   perform 1 from public.schools where id=p_school_id and account_id=a for share;
   perform 1 from public.account_memberships where account_id=a and person_id=actor and role_code='account_admin' order by id for share;
   perform 1 from public.school_memberships where account_id=a and school_id=p_school_id and person_id=actor and role_code='school_admin' order by id for share;
 end if;
 if actor is distinct from pikas_private.current_person_id() or not pikas_private.scope_active(a,p_school_id) then
   raise exception using errcode='42501',message='school_authority_required';
 end if;
 select m.id,'account_admin' into membership,role_value from public.account_memberships m
 where m.account_id=a and m.person_id=actor and m.role_code='account_admin' and m.status='active';
 if not found then
   select m.id,'school_admin' into membership,role_value from public.school_memberships m
   where m.account_id=a and m.school_id=p_school_id and m.person_id=actor and m.role_code='school_admin' and m.status='active';
 end if;
 if membership is null or not pikas_private.has_capability(p_capability,a,p_school_id) then
   raise exception using errcode='42501',message='school_authority_required';
 end if;
 return jsonb_build_object('actor_id',actor,'membership_id',membership,'role',role_value,'account_id',a,
   'school_id',p_school_id,'account_name',account_name,'school_name',school_name,'tenant_kind',kind);
end $$;
revoke all on function pikas_private.require_school_admin(uuid,text,boolean) from public,anon,authenticated,service_role;

create function public.get_school_admin_context() returns jsonb
language sql stable security definer set search_path='' as $$
 select case when p.id is null then null else jsonb_build_object('person_id',p.id,'display_name',p.display_name,
 'schools',coalesce((select jsonb_agg(jsonb_build_object('school_id',s.id,'school_name',s.name,
   'account_id',a.id,'account_name',a.name,'tenant_kind',a.tenant_kind) order by a.name,s.name,s.id)
 from public.schools s join public.accounts a on a.id=s.account_id
 where a.status='active' and s.status='active' and (
 exists(select 1 from public.account_memberships m where m.account_id=a.id and m.person_id=p.id and m.role_code='account_admin' and m.status='active') or
 exists(select 1 from public.school_memberships m where m.account_id=a.id and m.school_id=s.id and m.person_id=p.id and m.role_code='school_admin' and m.status='active'))),'[]'::jsonb)) end
 from (select pikas_private.current_person_id() id) x left join public.persons p on p.id=x.id
$$;

create function public.school_admin_read(p_school_id uuid,p_section text,p_query text default '',p_status text default '',p_after uuid default null,p_limit integer default 50)
returns jsonb language plpgsql security definer set search_path='' as $$
declare ctx jsonb; a uuid; result jsonb; rows_value jsonb; cursor_value uuid;
begin
 ctx:=pikas_private.require_school_admin(p_school_id,'school:read'); a:=(ctx->>'account_id')::uuid;
 if p_section is null or p_section not in ('summary','students','administrators','cafeterias','activity') or p_query is null or length(p_query)>80
   or p_status not in ('','active','suspended','inactive') or p_status is null or p_limit is null or p_limit not between 1 and 100 then
   raise exception using errcode='22023',message='invalid_school_filter';
 end if;
 if p_section='students' then
   perform pikas_private.require_school_admin(p_school_id,'school:students:read');
   with selected as (
     select s.* from public.students s where s.account_id=a and s.school_id=p_school_id and (p_after is null or s.id>p_after)
      and (p_status='' or s.status=p_status) and position(lower(btrim(p_query)) in lower(s.display_name||' '||s.student_code))>0 order by s.id limit p_limit+1
   ), page as (select * from selected order by id limit p_limit)
   select coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'first_name',s.first_name,'last_name',s.last_name,'display_name',s.display_name,
     'student_code',s.student_code,'status',s.status,'enrollment',(select jsonb_build_object('id',e.id,'starts_on',e.starts_on,
       'location_id',pl.school_location_id,'grade',pl.grade_label,'class',pl.class_label,'homeroom',pl.homeroom_label)
       from public.student_enrollments e left join public.student_campus_placements pl on pl.enrollment_id=e.id and pl.status='active'
       where e.student_id=s.id and e.status='active')) order by s.id) from page s),'[]'::jsonb),
     case when (select count(*) from selected)>p_limit then (select id from page order by id desc limit 1) end
   into rows_value,cursor_value;
   result:=jsonb_build_object('rows',rows_value,'next_cursor',cursor_value);
 elsif p_section='summary' then
   result:=jsonb_build_object('counts',jsonb_build_object('students',(select count(*) from public.students where account_id=a and school_id=p_school_id),
     'active',(select count(*) from public.students where account_id=a and school_id=p_school_id and status='active'),
     'suspended',(select count(*) from public.students where account_id=a and school_id=p_school_id and status='suspended'),
     'inactive',(select count(*) from public.students where account_id=a and school_id=p_school_id and status='inactive'),
     'cafeterias',(select count(*) from public.school_cafeteria_shares where account_id=a and school_id=p_school_id and status='active')));
 elsif p_section='administrators' then
   result:=jsonb_build_object('memberships',coalesce((select jsonb_agg(x.v order by x.name,x.id) from (
    select m.id,p.display_name name,jsonb_build_object('id',m.id,'display_name',p.display_name,'status',m.status,'role','account_admin','self',p.id=(ctx->>'actor_id')::uuid,'manageable',false) v
    from public.account_memberships m join public.persons p on p.id=m.person_id where m.account_id=a and m.role_code='account_admin'
    union all select m.id,p.display_name,jsonb_build_object('id',m.id,'display_name',p.display_name,'status',m.status,'role','school_admin','self',p.id=(ctx->>'actor_id')::uuid,'manageable',p.id<>(ctx->>'actor_id')::uuid)
    from public.school_memberships m join public.persons p on p.id=m.person_id where m.account_id=a and m.school_id=p_school_id and m.role_code='school_admin') x),'[]'::jsonb),
    'invitations',coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'email',i.intended_email,
      'status',case when i.status='pending' and i.expires_at<=statement_timestamp() then 'expired' else i.status end,'expires_at',i.expires_at) order by i.created_at desc,i.id)
    from public.invitations i where i.account_id=a and i.school_id=p_school_id and i.scope_kind='school' and i.role_code='school_admin'),'[]'::jsonb));
 elsif p_section='cafeterias' then
   perform pikas_private.require_school_admin(p_school_id,'school:sharing:read');
   result:=jsonb_build_object('rows',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'name',c.name,'location',l.name,'status',c.status,
     'sharing_status',coalesce(sh.status,'revoked'),'categories',coalesce((select jsonb_agg(sc.category order by sc.category) from public.school_cafeteria_share_categories sc where sc.share_id=sh.id and sc.enabled),'[]'::jsonb),
     'customer_count',(select count(*) from public.cafeteria_customers cu where cu.cafeteria_id=c.id and cu.status='active'),
     'customers',coalesce((select jsonb_agg(v order by name,id) from (select st.id,st.display_name name,jsonb_build_object('student_id',st.id,'display_name',st.display_name,'status',cu.status) v from public.cafeteria_customers cu join public.students st on st.id=cu.student_id where cu.cafeteria_id=c.id and cu.status='active' and st.account_id=a and st.school_id=p_school_id order by st.display_name,st.id limit 100) customers),'[]'::jsonb)) order by c.name,c.id)
    from public.cafeterias c join public.school_locations l on l.id=c.school_location_id
    left join public.school_cafeteria_shares sh on sh.cafeteria_id=c.id
    where c.account_id=a and c.school_id=p_school_id),'[]'::jsonb));
 else
   -- Explicit customer projection: no Auth IDs, metadata, wallets, purchases or platform audit.
   result:=jsonb_build_object('rows',coalesce((select jsonb_agg(x.v order by x.occurred_at desc,x.id) from (
     select e.id,e.occurred_at,jsonb_build_object('id',e.id,'occurred_at',e.occurred_at,'action',e.action,'target_type',e.target_type,'actor_name',p.display_name) v
     from public.audit_events e left join public.persons p on p.id=e.actor_person_id
     where e.account_id=a and e.school_id=p_school_id and e.actor_scope_kind in ('school','account')
      and e.target_type in ('students','student_enrollments','student_campus_placements','school_cafeteria_shares','school_memberships','invitations','school_administration')
      order by e.occurred_at desc,e.id limit p_limit) x),'[]'::jsonb));
 end if;
 return result||jsonb_build_object('scope',ctx,'locations',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name) order by name,id)
   from public.school_locations where account_id=a and school_id=p_school_id and status='active'),'[]'::jsonb));
end $$;

create function public.school_admin_command(p_school_id uuid,p_request_id uuid,p_operation text,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare ctx jsonb; a uuid; actor uuid; cap text; allowed text[]; fingerprint text; prior pikas_private.school_admin_requests%rowtype;
 result jsonb; student public.students%rowtype; target uuid; enrollment uuid; person uuid; auth_id uuid;
 invite public.invitations%rowtype; member public.school_memberships%rowtype; eligible_count integer;
 categories text[]; status_value text; target_type_value text:='school_administration';
begin
 if p_request_id is null or p_payload is null or jsonb_typeof(p_payload)<>'object' then raise exception using errcode='22023',message='invalid_school_command'; end if;
 cap:=case when p_operation like 'student_%' then 'school:students:manage'
   when p_operation like 'admin_%' then 'school:administrators:manage'
   when p_operation='sharing_set' then 'school:sharing:manage'
   when p_operation='customer_set' then 'school:customers:manage' end;
 allowed:=case p_operation
   when 'student_create' then array['first_name','last_name','student_code','location_id','starts_on','grade','class','homeroom']
   when 'student_update' then array['student_id','first_name','last_name','student_code']
   when 'student_status' then array['student_id','status']
   when 'student_enroll' then array['student_id','location_id','starts_on','grade','class','homeroom']
   when 'student_transfer' then array['student_id','location_id','starts_on','grade','class','homeroom']
   when 'student_withdraw' then array['student_id','ends_on']
   when 'admin_prepare' then array['email']
   when 'admin_complete' then array['invitation_id','display_name']
   when 'admin_status' then array['membership_id','status']
   when 'sharing_set' then array['cafeteria_id','status','categories']
   when 'customer_set' then array['cafeteria_id','student_id','enabled'] end;
 if cap is null or allowed is null or exists(select 1 from jsonb_object_keys(p_payload) k where not(k=any(allowed))) then
   raise exception using errcode='22023',message='invalid_school_command'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_request_id::text,20261010));
 ctx:=pikas_private.require_school_admin(p_school_id,cap,true); a:=(ctx->>'account_id')::uuid; actor:=(ctx->>'actor_id')::uuid;
 fingerprint:=pikas_private.platform_request_fingerprint(jsonb_build_object('school',p_school_id,'operation',p_operation,'payload',p_payload));
 select * into prior from pikas_private.school_admin_requests where request_id=p_request_id;
 if found then
   if prior.actor_person_id<>actor or prior.actor_auth_id<>auth.uid() or prior.school_id<>p_school_id or prior.fingerprint<>fingerprint then
     raise exception using errcode='23505',message='school_request_conflict'; end if;
   return prior.response;
 end if;
 if p_operation like 'student_%' and p_operation<>'student_create' or p_operation='customer_set' then
   perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_payload->>'student_id',0));
   select * into student from public.students where id=(p_payload->>'student_id')::uuid and account_id=a and school_id=p_school_id for update;
   if not found then raise exception using errcode='42501',message='student_outside_school'; end if;
   target:=student.id; person:=student.person_id;
   -- Acquire the same student/enrollment advisory locks before mutation and keep authority locked.
   perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(student.id::text,0));
 end if;
 if p_operation in ('student_create','student_enroll','student_transfer') then
   if (p_payload->>'location_id')::uuid is not null then
     perform 1 from public.school_locations where id=(p_payload->>'location_id')::uuid and account_id=a and school_id=p_school_id and status='active' for share;
     if not found then raise exception using errcode='42501',message='location_outside_school'; end if;
   end if;
 end if;
 if p_operation in ('sharing_set','customer_set') then
   target:=(p_payload->>'cafeteria_id')::uuid;
   perform 1 from public.cafeterias where id=target and account_id=a and school_id=p_school_id for update;
   if not found then raise exception using errcode='42501',message='cafeteria_outside_school'; end if;
   -- Stabilize the cafeteria's parent campus across eligibility/relationship lock waits.
   perform 1 from public.school_locations l join public.cafeterias c on c.school_location_id=l.id
     where c.id=target and l.account_id=a and l.school_id=p_school_id for share of l;
 end if;
 perform pikas_private.require_school_admin(p_school_id,cap,true);
 if p_operation='student_create' then
   person:=public.create_school_person(a,p_school_id,btrim((p_payload->>'first_name')||' '||(p_payload->>'last_name')),'student');
   target:=public.create_student(a,p_school_id,person,p_payload->>'student_code',p_payload->>'first_name',p_payload->>'last_name',btrim((p_payload->>'first_name')||' '||(p_payload->>'last_name')));
   enrollment:=public.enroll_student(a,p_school_id,target,(p_payload->>'starts_on')::date,(p_payload->>'location_id')::uuid,p_payload->>'grade',p_payload->>'class',p_payload->>'homeroom');
   result:=jsonb_build_object('student_id',target,'enrollment_id',enrollment);
 elsif p_operation='student_update' then
   update public.students set first_name=btrim(p_payload->>'first_name'),last_name=btrim(p_payload->>'last_name'),display_name=btrim((p_payload->>'first_name')||' '||(p_payload->>'last_name')),student_code=btrim(p_payload->>'student_code') where id=student.id;
   result:=jsonb_build_object('student_id',student.id);
 elsif p_operation='student_status' then
   if p_payload->>'status' is null then raise exception using errcode='22023',message='status_required'; end if;
   perform public.set_student_status(a,p_school_id,student.id,p_payload->>'status'); result:=jsonb_build_object('student_id',student.id);
 elsif p_operation='student_enroll' then
   enrollment:=public.enroll_student(a,p_school_id,student.id,(p_payload->>'starts_on')::date,(p_payload->>'location_id')::uuid,p_payload->>'grade',p_payload->>'class',p_payload->>'homeroom');
   result:=jsonb_build_object('enrollment_id',enrollment);
 elsif p_operation in ('student_transfer','student_withdraw') then
   select id into enrollment from public.student_enrollments where student_id=student.id and status='active' for update;
   if not found then raise exception using errcode='23514',message='active_enrollment_required'; end if;
   if p_operation='student_transfer' then
     target:=public.transfer_student_campus(a,p_school_id,enrollment,(p_payload->>'starts_on')::date,(p_payload->>'location_id')::uuid,p_payload->>'grade',p_payload->>'class',p_payload->>'homeroom');
   else perform public.withdraw_student_enrollment(a,p_school_id,enrollment,(p_payload->>'ends_on')::date); target:=enrollment; end if;
   result:=jsonb_build_object('enrollment_id',enrollment);
 elsif p_operation='sharing_set' then
   if p_payload->>'status' is null or jsonb_typeof(p_payload->'categories') is distinct from 'array' then raise exception using errcode='22023',message='invalid_sharing'; end if;
   if p_payload->>'status'='active' and not pikas_private.scope_active(a,p_school_id,target) then raise exception using errcode='42501',message='active_cafeteria_required'; end if;
   select coalesce(array_agg(value),'{}'::text[]) into categories from jsonb_array_elements_text(p_payload->'categories');
   target:=public.set_school_cafeteria_sharing(a,p_school_id,target,p_payload->>'status',categories); result:=jsonb_build_object('share_id',target);
 elsif p_operation='customer_set' then
   if p_payload->'enabled' is null or jsonb_typeof(p_payload->'enabled')<>'boolean' then raise exception using errcode='22023',message='enabled_required'; end if;
   perform 1 from public.school_cafeteria_shares where cafeteria_id=target for update;
   if (p_payload->>'enabled')::boolean then
     perform 1 from public.persons where id=student.person_id and status='active' for share;
     if not found or not pikas_private.scope_active(a,p_school_id,(p_payload->>'cafeteria_id')::uuid) then raise exception using errcode='23514',message='active_student_and_sharing_required'; end if;
     select id into target from public.cafeteria_customers where cafeteria_id=(p_payload->>'cafeteria_id')::uuid and student_id=student.id order by (status='active') desc,created_at desc,id limit 1 for update;
     if target is null then target:=public.create_cafeteria_customer(a,p_school_id,(p_payload->>'cafeteria_id')::uuid,student.id,null);
     else
       -- Existing inactive eligibility can only be re-enabled with current active enrollment/sharing.
       if student.status<>'active' or not exists(select 1 from public.student_enrollments where student_id=student.id and status='active') or not exists(select 1 from public.school_cafeteria_shares sh join public.school_cafeteria_share_categories sc on sc.share_id=sh.id and sc.category='basic_identification' and sc.enabled where sh.cafeteria_id=(p_payload->>'cafeteria_id')::uuid and sh.status='active') then raise exception using errcode='23514',message='active_student_and_sharing_required'; end if;
       update public.cafeteria_customers set status='active' where id=target;
     end if;
   else
     select id into target from public.cafeteria_customers where cafeteria_id=target and student_id=student.id and status='active' order by id limit 1 for update;
     if target is null then raise exception using errcode='23503',message='customer_not_found'; end if;
     perform public.deactivate_cafeteria_customer(a,p_school_id,target);
   end if;
   result:=jsonb_build_object('customer_id',target);
 elsif p_operation='admin_prepare' then
   if length(btrim(p_payload->>'email')) not between 3 and 254 or position('@' in btrim(p_payload->>'email'))<2 or p_payload->>'email' is null then raise exception using errcode='22023',message='invalid_admin_email'; end if;
   -- Serialize pending intentions per school/email, including different request keys.
   perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_school_id::text||lower(btrim(p_payload->>'email')),20261011));
   select id into target from public.invitations where account_id=a and school_id=p_school_id and role_code='school_admin' and email_key=lower(btrim(p_payload->>'email')) and status='pending' and expires_at>clock_timestamp() order by id limit 1 for update;
   if target is null then
     insert into public.invitations(account_id,school_id,scope_kind,role_code,intended_email,token_hash,invited_by,expires_at)
     values(a,p_school_id,'school','school_admin',btrim(p_payload->>'email'),encode(extensions.digest(gen_random_uuid()::text||gen_random_uuid()::text,'sha256'),'hex'),actor,clock_timestamp()+interval '7 days') returning id into target;
   end if;
   result:=jsonb_build_object('invitation_id',target,'status','pending'); target_type_value:='invitations';
 elsif p_operation='admin_complete' then
   select * into invite from public.invitations where id=(p_payload->>'invitation_id')::uuid and account_id=a and school_id=p_school_id and scope_kind='school' and role_code='school_admin' for update;
   if not found or invite.status<>'pending' or invite.expires_at<=clock_timestamp() then raise exception using errcode='23514',message='pending_school_invitation_required'; end if;
   select count(*) into eligible_count from auth.users u where lower(btrim(u.email))=invite.email_key;
   if eligible_count<>1 then raise exception using errcode='23514',message='confirmed_identity_pending'; end if;
   begin
     select u.id into strict auth_id from auth.users u where lower(btrim(u.email))=invite.email_key and u.confirmed_at is not null
      and (not(to_jsonb(u)?'email_confirmed_at') or to_jsonb(u)->>'email_confirmed_at' is not null)
      and (to_jsonb(u)->>'banned_until' is null or (to_jsonb(u)->>'banned_until')::timestamptz<=clock_timestamp())
      and to_jsonb(u)->>'deleted_at' is null and coalesce((to_jsonb(u)->>'is_anonymous')::boolean,false)=false for share;
   exception when no_data_found or too_many_rows then raise exception using errcode='23514',message='confirmed_identity_pending'; end;
   select id into person from public.persons where auth_user_id=auth_id for update;
   if auth_id=auth.uid() or exists(select 1 from pikas_private.platform_memberships where person_id=person)
    or exists(select 1 from public.account_memberships where person_id=person and account_id<>a)
    or exists(select 1 from public.school_memberships where person_id=person and account_id<>a)
    or exists(select 1 from public.cafeteria_memberships where person_id=person and account_id<>a) then raise exception using errcode='42501',message='tenant_identity_required'; end if;
   if person is not null and not exists(select 1 from public.persons where id=person and status='active' and auth_user_id=auth_id) then raise exception using errcode='23514',message='active_person_required'; end if;
   if nullif(btrim(p_payload->>'display_name'),'') is null or length(btrim(p_payload->>'display_name'))>200 then raise exception using errcode='22023',message='display_name_required'; end if;
   perform pikas_private.require_school_admin(p_school_id,cap,true);
   if invite.expires_at<=clock_timestamp() then raise exception using errcode='23514',message='pending_school_invitation_required'; end if;
   if person is null then insert into public.persons(auth_user_id,display_name) values(auth_id,btrim(p_payload->>'display_name')) returning id into person; end if;
   select * into member from public.school_memberships where account_id=a and school_id=p_school_id and person_id=person and role_code='school_admin' for update;
   if found and member.status<>'active' then raise exception using errcode='23505',message='existing_membership_not_active'; end if;
   perform pikas_private.require_school_admin(p_school_id,cap,true);
   if invite.expires_at<=clock_timestamp() then raise exception using errcode='23514',message='pending_school_invitation_required'; end if;
   if member.id is null then insert into public.school_memberships(account_id,school_id,person_id,role_code) values(a,p_school_id,person,'school_admin') returning id into target; else target:=member.id; end if;
   update public.invitations set status='accepted',accepted_person_id=person,accepted_at=clock_timestamp() where id=invite.id;
   result:=jsonb_build_object('membership_id',target,'status','accepted'); target_type_value:='school_memberships';
 elsif p_operation='admin_status' then
   select * into member from public.school_memberships where id=(p_payload->>'membership_id')::uuid and account_id=a and school_id=p_school_id and role_code='school_admin' for update;
   if not found or member.person_id=actor then raise exception using errcode='42501',message='manageable_school_membership_required'; end if;
   status_value:=p_payload->>'status';
   if status_value is null or status_value not in ('active','suspended') then raise exception using errcode='22023',message='invalid_membership_status'; end if;
   perform 1 from public.persons p join auth.users u on u.id=p.auth_user_id where p.id=member.person_id and p.status='active' and u.confirmed_at is not null
     and (not(to_jsonb(u)?'email_confirmed_at') or to_jsonb(u)->>'email_confirmed_at' is not null)
     and (to_jsonb(u)->>'banned_until' is null or (to_jsonb(u)->>'banned_until')::timestamptz<=clock_timestamp())
     and to_jsonb(u)->>'deleted_at' is null and coalesce((to_jsonb(u)->>'is_anonymous')::boolean,false)=false for share of p,u;
   if status_value='active' and not found then raise exception using errcode='23514',message='active_authenticated_person_required'; end if;
   if status_value='active' and exists(select 1 from pikas_private.platform_memberships where person_id=member.person_id) then raise exception using errcode='42501',message='tenant_identity_required'; end if;
   perform pikas_private.require_school_admin(p_school_id,cap,true);
   update public.school_memberships set status=status_value where id=member.id;
   target:=member.id; result:=jsonb_build_object('membership_id',target); target_type_value:='school_memberships';
 end if;
 insert into pikas_private.school_admin_requests(request_id,actor_person_id,actor_auth_id,account_id,school_id,fingerprint,response)
 values(p_request_id,actor,auth.uid(),a,p_school_id,fingerprint,result);
 insert into public.audit_events(actor_person_id,authenticated_user_id,actor_role,actor_scope_kind,account_id,school_id,action,target_type,target_id,request_id,outcome,after_metadata)
 values(actor,auth.uid(),ctx->>'role',case when ctx->>'role'='account_admin' then 'account' else 'school' end,a,p_school_id,'school_admin_'||p_operation,target_type_value,coalesce(target,p_school_id),p_request_id,'succeeded',jsonb_build_object('operation',p_operation));
 return result;
end $$;
revoke all on function public.get_school_admin_context(),public.school_admin_read(uuid,text,text,text,uuid,integer),public.school_admin_command(uuid,uuid,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.get_school_admin_context(),public.school_admin_read(uuid,text,text,text,uuid,integer),public.school_admin_command(uuid,uuid,text,jsonb) to authenticated;
commit;
