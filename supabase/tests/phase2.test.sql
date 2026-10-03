begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select no_plan();

select is((select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relkind='r' and c.relrowsecurity),39::bigint,
  'RLS is enabled on all Phase 1 through Phase 4C public tables');
select is((select count(*) from pg_policies where schemaname='public' and cmd<>'SELECT'),0::bigint,
  'No direct table mutation policies are defined');
select ok(not has_table_privilege('authenticated','public.students','INSERT') and
  not has_table_privilege('authenticated','public.school_person_contacts','UPDATE') and
  not has_table_privilege('authenticated','public.cafeteria_customers','DELETE'),
  'Authenticated clients have no direct Phase 2 write grants');
select ok(not has_table_privilege('anon','public.students','SELECT') and
  not has_table_privilege('service_role','public.students','SELECT') and
  not has_table_privilege('service_role','public.school_person_contacts','SELECT'),
  'Anonymous and service roles have no Phase 2 base-table read grants');
select ok((select count(*)=4 from pikas_private.role_capabilities where capability='cafeteria:customer:lookup'),
  'Only cafeteria admin and authorized POS roles receive customer lookup capability');
select is((select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname in ('public','pikas_private') and p.prosecdef
    and not ('search_path=""'=any(p.proconfig))),0::bigint,
  'Every Phase 2 SECURITY DEFINER function pins an empty search path');
select ok(not has_function_privilege('anon','public.create_student(uuid,uuid,uuid,text,text,text,text)','EXECUTE') and
  not has_function_privilege('anon','public.cafeteria_customer_projection(uuid,text)','EXECUTE') and
  not has_function_privilege('service_role','public.create_student(uuid,uuid,uuid,text,text,text,text)','EXECUTE'),
  'Anonymous and service roles cannot invoke Phase 2 mutation or projection RPCs');

select is((select count(*) from students where school_id='00000000-0000-0000-0000-000000000011'),2::bigint,
  'Synthetic school has two students');
select is((select count(*) from family_student_relationships where student_id='00000000-0000-0000-0000-000000005201' and status='active'),2::bigint,
  'Student supports simultaneous primary and additional family relationships');
select is((select count(*) from family_student_relationships where student_id='00000000-0000-0000-0000-000000005201' and status='active' and is_primary),1::bigint,
  'Student has exactly one active primary family');
select is((select count(*) from student_campus_placements where enrollment_id='00000000-0000-0000-0000-000000005302' and school_location_id='00000000-0000-0000-0000-000000000213' and status='active'),1::bigint,
  'Current placement reflects Sofia campus transfer');
select is((select count(*) from student_campus_placements where enrollment_id='00000000-0000-0000-0000-000000005301' and status='ended'),1::bigint,
  'Previous campus placement remains historical');
select is((select count(*) from family_guardians where family_id='00000000-0000-0000-0000-000000006001' and status='active'),2::bigint,
  'Family has multiple active guardians');
select ok((select auth_user_id is null from persons where id='00000000-0000-0000-0000-000000005103'),
  'Guardian person does not require Auth');
select ok((select auth_user_id is not null from persons where id='00000000-0000-0000-0000-000000005104'),
  'Staff person may be linked to Auth independently');
select throws_ok($$update students set status='inactive' where id='00000000-0000-0000-0000-000000005201'$$,
  '23514',null,'Student cannot be deactivated while a current enrollment remains');
select throws_ok($$update student_enrollments set status='withdrawn',ends_on=current_date
  where id='00000000-0000-0000-0000-000000005302'$$,
  '23514',null,'Enrollment cannot be ended while its current placement remains active');

select throws_ok($$insert into students(account_id,school_id,person_id,student_code,first_name,last_name,display_name)
  values('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011',
  '00000000-0000-0000-0000-000000001099',' stu-001 ','Duplicate','Code','Duplicate')$$,
  '23505',null,'Student code is normalized and unique within school');
select throws_ok($$update students set school_id='00000000-0000-0000-0000-000000000012'
  where id='00000000-0000-0000-0000-000000005201'$$,'23514',null,'Student ancestry is immutable');
select throws_ok($$insert into students(account_id,school_id,person_id,student_code,first_name,last_name,display_name)
  values('00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000011',
  '00000000-0000-0000-0000-000000005105','CROSS','Cross','School','Cross School')$$,
  '23503',null,'Student cannot combine account and school ancestry');
select throws_ok($$insert into student_enrollments(account_id,school_id,student_id,starts_on)
  values('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011',
  '00000000-0000-0000-0000-000000005201',current_date)$$,
  '23P01',null,'Student cannot have a second current enrollment');
select throws_ok($$insert into student_enrollments(account_id,school_id,student_id,starts_on,ends_on,status)
  values('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011',
  '00000000-0000-0000-0000-000000005201','2026-01-04','2026-01-06','completed')$$,
  '23P01',null,'Enrollment date ranges cannot overlap across re-enrollment');
insert into public.persons(id,display_name) values ('00000000-0000-0000-0000-000000005197','Placement Test Student');
insert into public.students(id,account_id,school_id,person_id,student_code,first_name,last_name,display_name)
values ('00000000-0000-0000-0000-000000005203','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011',
  '00000000-0000-0000-0000-000000005197','STU-003','Placement','Test','Placement Test Student');
select throws_ok($$insert into student_enrollments(account_id,school_id,student_id,starts_on)
  values('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011',
  '00000000-0000-0000-0000-000000005203',current_date+1)$$,
  '23514',null,'Future-dated enrollment cannot be marked current');
insert into public.student_enrollments(id,account_id,school_id,student_id,starts_on)
values ('00000000-0000-0000-0000-000000005304','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011',
  '00000000-0000-0000-0000-000000005203',current_date);
select throws_ok($$insert into student_campus_placements(account_id,school_id,enrollment_id,school_location_id,starts_on)
  values('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011',
  '00000000-0000-0000-0000-000000005304','00000000-0000-0000-0000-000000000211',current_date+1)$$,
  '23514',null,'Future-dated placement cannot be marked current');
select throws_ok($$insert into student_campus_placements(account_id,school_id,enrollment_id,school_location_id,starts_on,ends_on,status)
  values('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011',
  '00000000-0000-0000-0000-000000005304','00000000-0000-0000-0000-000000000221',current_date,current_date+1,'ended')$$,
  '23503',null,'Placement cannot use another account campus');
select throws_ok($$insert into student_campus_placements(account_id,school_id,enrollment_id,school_location_id,starts_on)
  values('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011',
  '00000000-0000-0000-0000-000000005302','00000000-0000-0000-0000-000000000211','2026-01-06')$$,
  '23P01',null,'Placement periods cannot overlap');
select throws_ok($$insert into families(account_id,school_id,family_code)
  values('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011',' fam-001 ')$$,
  '23505',null,'Family code is normalized and unique within school');
select lives_ok($$insert into families(account_id,school_id,family_code)
  values('00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000021','FAM-001')$$,
  'Same family code may exist in another school');
select throws_ok($$insert into family_student_relationships(account_id,school_id,family_id,student_id,is_primary)
  values('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011',
  '00000000-0000-0000-0000-000000006002','00000000-0000-0000-0000-000000005201',true)$$,
  '23505',null,'At most one active primary family is allowed');
select throws_ok($$insert into family_student_relationships(account_id,school_id,family_id,student_id)
  values('00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000011',
  (select id from families where school_id='00000000-0000-0000-0000-000000000021'),
  '00000000-0000-0000-0000-000000005201')$$,
  '23503',null,'Family/student ancestry cannot cross schools');
select throws_ok($$insert into student_guardians(account_id,school_id,student_id,person_id,relationship_type)
  values('00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000021',
  '00000000-0000-0000-0000-000000005202','00000000-0000-0000-0000-000000005105','guardian')$$,
  '23503',null,'Guardian relationship cannot cross schools');
select throws_ok($$insert into school_staff_affiliations(account_id,school_id,person_id,staff_category,employee_code)
  values('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011',
  '00000000-0000-0000-0000-000000005105','teacher',' emp-001 ')$$,
  '23505',null,'Staff code is normalized and school-scoped');
select throws_ok($$insert into staff_campus_affiliations(account_id,school_id,staff_affiliation_id,school_location_id)
  values('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011',
  '00000000-0000-0000-0000-000000006501','00000000-0000-0000-0000-000000000221')$$,
  '23503',null,'Staff campus affiliation must share school ancestry');
select throws_ok($$insert into cafeteria_customers(account_id,school_id,cafeteria_id,student_id,staff_affiliation_id)
  values('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011',
  '00000000-0000-0000-0000-000000000111','00000000-0000-0000-0000-000000005201','00000000-0000-0000-0000-000000006501')$$,
  '23514',null,'Customer must reference exactly one source identity');
select throws_ok($$insert into cafeteria_customers(account_id,school_id,cafeteria_id)
  values('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011',
  '00000000-0000-0000-0000-000000000111')$$,'23514',null,'Unidentified sales do not require a customer row');
select throws_ok($$insert into cafeteria_customers(account_id,school_id,cafeteria_id,student_id)
  values('00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000021',
  '00000000-0000-0000-0000-000000000121','00000000-0000-0000-0000-000000005201')$$,
  '23503',null,'Customer source and cafeteria must share tenant ancestry');
select ok(not exists(select 1 from audit_events where target_type='student_dietary_restrictions'
  and before_metadata ?| array['restriction_code','display_label','contact_value']
  or after_metadata ?| array['restriction_code','display_label','contact_value']),
  'Audit metadata omits contact and restriction payloads');

insert into public.persons(id,display_name) values ('00000000-0000-0000-0000-000000005199','Test Student');
insert into public.persons(id,display_name) values ('00000000-0000-0000-0000-000000005198','Test Guardian');
insert into public.cafeterias(id,account_id,school_id,school_location_id,code,name)
values ('00000000-0000-0000-0000-000000000114','00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000211','SECOND','Synthetic same-campus sibling');
reset role;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002002',true);
set local role authenticated;
select is((select count(*) from students),3::bigint,'School Admin reads students in own school');
select is((select count(*) from students where school_id='00000000-0000-0000-0000-000000000012'),0::bigint,
  'School Admin cannot read a sibling school');
select is((select count(*) from school_person_contacts),1::bigint,'School Admin can read school-managed contacts');
select lives_ok($$select public.create_student('00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000005199',
  'TEST-001','Test','Student','Test Student')$$,'School Admin creates student through controlled RPC');
select is((select count(*) from students where code_key='test-001'),1::bigint,'Created student is visible in authorized school');
select lives_ok($$select public.create_student('00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000011',public.create_school_person(
  '00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011','No Login Student','student'),
  'TEST-002','No Login','Student','No Login Student')$$,
  'School Admin creates a business person without Auth and links the student');
select ok(exists(select 1 from students s join persons p on p.id=s.person_id
  where s.code_key='test-002' and p.auth_user_id is null),'Student identity is independent of Auth');
select ok(exists(select 1 from audit_events where target_type='students' and action='insert'
  and actor_person_id='00000000-0000-0000-0000-000000001002' and actor_role='school_admin'
  and school_id='00000000-0000-0000-0000-000000000011'),
  'Successful mutation is atomically attributed to school administrator');
select throws_ok($$select public.create_student('00000000-0000-0000-0000-000000000002',
  '00000000-0000-0000-0000-000000000021','00000000-0000-0000-0000-000000005198',
  'DENIED','Denied','Student','Denied Student')$$,'42501',null,'School Admin cannot mutate a different account');
select is((select count(*) from audit_events where target_type='students' and action='insert'),5::bigint,
  'Rejected cross-tenant student creation produces no successful audit event');
reset role;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002006',true);
set local role authenticated;
select throws_ok($$select public.set_school_cafeteria_sharing('00000000-0000-0000-0000-000000000002',
  '00000000-0000-0000-0000-000000000021','00000000-0000-0000-0000-000000000111','revoked',
  array['basic_identification'])$$,'42501',null,
  'Account B School Admin cannot target Account A cafeteria through share upsert');
reset role;
select is((select status from school_cafeteria_shares where cafeteria_id='00000000-0000-0000-0000-000000000111'),
  'active','Rejected cross-tenant share request leaves target sharing unchanged');
select is((select enabled from school_cafeteria_share_categories where share_id='00000000-0000-0000-0000-000000006801' and category='student_code'),
  true,'Rejected cross-tenant request cannot change target share categories');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002002',true);
set local role authenticated;
select lives_ok($$select public.create_family('00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000011','TEST-FAM')$$,'School Admin creates family through controlled RPC');
select lives_ok($$select public.link_student_family('00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000011',(select id from students where code_key='test-001'),
  (select id from families where code_key='test-fam'),true)$$,'School Admin links student and primary family');
select lives_ok($$select public.link_student_family('00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000011',(select id from students where code_key='test-001'),
  (select id from families where code_key='test-fam'),true)$$,'Repeated family association request is idempotent');
select is((select count(*) from family_student_relationships r join students s on s.id=r.student_id
  join families f on f.id=r.family_id where s.code_key='test-001' and f.code_key='test-fam' and r.status='active'),1::bigint,
  'Idempotent family association does not duplicate active link');
select lives_ok($$select public.end_family_student_relationship('00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000011',(select r.id from family_student_relationships r join students s on s.id=r.student_id
  join families f on f.id=r.family_id where s.code_key='test-001' and f.code_key='test-fam' and r.status='active'),current_date+1)$$,
  'School Admin ends a family/student relationship without deleting history');
select is((select count(*) from family_student_relationships r join students s on s.id=r.student_id
  join families f on f.id=r.family_id where s.code_key='test-001' and f.code_key='test-fam' and r.status='ended'),1::bigint,
  'Ended family/student relationship remains historical');
select lives_ok($$select public.enroll_student('00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000011',(select id from students where code_key='test-001'),
  current_date-12,'00000000-0000-0000-0000-000000000211','Grade 1','1-A')$$,
  'School Admin creates enrollment and initial campus placement');
select lives_ok($$select public.enroll_student('00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000011',(select id from students where code_key='test-001'),
  current_date-12,'00000000-0000-0000-0000-000000000211','Grade 1','1-A')$$,
  'Identical enrollment retry returns the existing enrollment');
select throws_ok($$select public.set_student_status('00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000011',(select id from students where code_key='test-001'),'inactive')$$,
  '23514',null,'Student cannot be deactivated while enrolled');
select throws_ok($$select public.transfer_student_campus('00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000011',(select e.id from student_enrollments e join students s on s.id=e.student_id where s.code_key='test-001' and e.status='active'),
  current_date+1,'00000000-0000-0000-0000-000000000213','Grade 2','2-A')$$,
  '22023',null,'Future-effective transfer is rejected instead of replacing current placement early');
select throws_ok($$select public.withdraw_student_enrollment('00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000011',(select e.id from student_enrollments e join students s on s.id=e.student_id where s.code_key='test-001' and e.status='active'),
  current_date+1)$$,'22023',null,'Future-effective withdrawal is rejected');
select lives_ok($$select public.transfer_student_campus('00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000011',(select e.id from student_enrollments e join students s on s.id=e.student_id where s.code_key='test-001' and e.status='active'),
  current_date-10,'00000000-0000-0000-0000-000000000213','Grade 2','2-A')$$,
  'Campus transfer closes prior placement and starts a new placement');
select lives_ok($$select public.transfer_student_campus('00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000011',(select e.id from student_enrollments e join students s on s.id=e.student_id where s.code_key='test-001' and e.status='active'),
  current_date-10,'00000000-0000-0000-0000-000000000213','Grade 2','2-A')$$,
  'Identical campus transfer retry returns the current placement');
select is((select count(*) from student_campus_placements p join student_enrollments e on e.id=p.enrollment_id
  join students s on s.id=e.student_id where s.code_key='test-001' and p.status='active'),1::bigint,
  'Transfer retains exactly one current placement');
select lives_ok($$select public.withdraw_student_enrollment('00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000011',(select e.id from student_enrollments e join students s on s.id=e.student_id where s.code_key='test-001' and e.status='active'),
  current_date-8)$$,'Withdrawal closes active placement and enrollment');
select lives_ok($$select public.withdraw_student_enrollment('00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000011',(select e.id from student_enrollments e join students s on s.id=e.student_id where s.code_key='test-001' and e.status='withdrawn'),
  current_date-8)$$,'Identical withdrawal retry succeeds without changing history');
select lives_ok($$select public.enroll_student('00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000011',(select id from students where code_key='test-001'),
  current_date-6,null,'Grade 2')$$,'Re-enrollment preserves student identity');
select is((select count(*) from student_enrollments e join students s on s.id=e.student_id
  where s.code_key='test-001' and e.status='active'),1::bigint,'Re-enrolled student has one current enrollment');
select lives_ok($$select public.add_student_guardian('00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000011',(select id from students where code_key='test-001'),
  '00000000-0000-0000-0000-000000005198','guardian')$$,'School Admin records guardian relationship without granting login');
select lives_ok($$select public.end_student_guardian_relationship('00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000011',(select g.id from student_guardians g join students s on s.id=g.student_id
  where s.code_key='test-001' and g.person_id='00000000-0000-0000-0000-000000005198' and g.status='active'),current_date+1)$$,
  'School Admin revokes a student-specific guardian relationship');
select is((select count(*) from student_guardians g join students s on s.id=g.student_id
  where s.code_key='test-001' and g.status='ended'),1::bigint,'Guardian revocation preserves its relationship history');
select lives_ok($$select public.add_school_person_contact('00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000005198',
  'email','test-guardian@example.invalid')$$,'School Admin adds school-scoped contact');
select lives_ok($$select public.deactivate_school_person_contact('00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000011',(select id from school_person_contacts where contact_value='test-guardian@example.invalid'))$$,
  'School Admin deactivates contact without deleting it');
select is((select count(*) from school_person_contacts where contact_value='test-guardian@example.invalid' and status='inactive'),1::bigint,
  'Inactive contact remains available as school history');
select lives_ok($$select public.create_school_staff_affiliation('00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000005198',
  'other_employee','TEST-STAFF')$$,'School Admin creates staff affiliation independently of membership');
select lives_ok($$select public.add_staff_campus_affiliation('00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000011',(select id from school_staff_affiliations where employee_code_key='test-staff'),
  '00000000-0000-0000-0000-000000000213')$$,'School Admin associates staff with a campus');
select lives_ok($$select public.deactivate_school_staff_affiliation('00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000011',(select id from school_staff_affiliations where employee_code_key='test-staff'),current_date+1)$$,
  'Staff deactivation closes active campus affiliations');
select is((select count(*) from staff_campus_affiliations c join school_staff_affiliations s on s.id=c.staff_affiliation_id
  where s.employee_code_key='test-staff' and c.status='ended'),1::bigint,'Staff campus history remains after affiliation ends');
select lives_ok($$select public.add_student_restriction('00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000011',(select id from students where code_key='test-001'),
  'allergen','tree-nut','Tree nut')$$,'School Admin records operational restriction');
select lives_ok($$select public.deactivate_student_restriction('00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000011',(select id from student_dietary_restrictions where code_key='tree-nut'),current_date+1)$$,
  'School Admin deactivates an outdated restriction');
select is((select count(*) from student_dietary_restrictions where code_key='tree-nut' and status='inactive'),1::bigint,
  'Inactive restriction remains historical');
select lives_ok($$select public.set_school_cafeteria_sharing('00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000111','active',
  array['basic_identification','student_code','placement'])$$,
  'School Admin enables explicit categories for one cafeteria');
select ok(exists(select 1 from audit_events where target_type='school_cafeteria_shares' and action='update'
  and actor_person_id='00000000-0000-0000-0000-000000001002' and actor_scope_kind='school'
  and school_id='00000000-0000-0000-0000-000000000011' and cafeteria_id is null),
  'School-authored sharing audit remains school-scoped');
select lives_ok($$select public.create_cafeteria_customer('00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000111',
  (select id from students where code_key='test-001'))$$,'School Admin creates student cafeteria customer link');
select lives_ok($$select public.deactivate_cafeteria_customer('00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000011',(select cc.id from cafeteria_customers cc join students s on s.id=cc.student_id
  where s.code_key='test-001' and cc.cafeteria_id='00000000-0000-0000-0000-000000000111'))$$,
  'School Admin deactivates customer identity link without deleting it');
select is((select count(*) from cafeteria_customers cc join students s on s.id=cc.student_id
  where s.code_key='test-001' and cc.status='inactive'),1::bigint,'Inactive cafeteria customer link remains historical');
select throws_ok($$select public.create_cafeteria_customer('00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000113',
  (select id from students where code_key='test-001'))$$,'42501',null,
  'Customer link cannot be created for cafeteria without sharing');
reset role;

select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002001',true);
set local role authenticated;
select is((select count(*) from students),0::bigint,'Account Admin does not automatically read individual students');
select is((select count(*) from families),0::bigint,'Account Admin does not automatically read families');
reset role;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002012',true);
set local role authenticated;
select is((select count(*) from students),0::bigint,'Staff Auth identity without membership has no school data access');
select ok(not pikas_private.has_capability('school:students:read','00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000011'),'Staff affiliation grants no PIKAS authorization');
reset role;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002007',true);
set local role authenticated;
select is((select count(*) from cafeteria_customer_projection('00000000-0000-0000-0000-000000000111','STU-001')),1::bigint,
  'POS projection resolves only assigned cafeteria student');
select is((select count(*) from cafeteria_customer_projection('00000000-0000-0000-0000-000000000111','%%')),0::bigint,
  'LIKE wildcard input cannot enumerate the customer projection');
select is((select student_code from cafeteria_customer_projection('00000000-0000-0000-0000-000000000111','STU-001') limit 1),'STU-001',
  'Enabled student-code category is projected');
select is((select grade_label from cafeteria_customer_projection('00000000-0000-0000-0000-000000000111','Sofia Demo') limit 1),'Grade 5',
  'Enabled placement category is projected');
select is((select restrictions from cafeteria_customer_projection('00000000-0000-0000-0000-000000000111','Sofia Demo') limit 1),'[]'::jsonb,
  'Disabled dietary category is omitted');
select is((select count(*) from cafeteria_customer_projection('00000000-0000-0000-0000-000000000113','STU-001')),0::bigint,
  'Sibling cafeteria without explicit share receives no projection');
select is((select count(*) from cafeteria_customer_projection('00000000-0000-0000-0000-000000000114','STU-001')),0::bigint,
  'Same-campus sibling cafeteria receives no projection');
select is((select count(*) from cafeteria_customer_projection('00000000-0000-0000-0000-000000000112','STU-001')),0::bigint,
  'Other school in the same account receives no projection');
select is((select count(*) from cafeteria_customer_projection('00000000-0000-0000-0000-000000000121','STU-001')),0::bigint,
  'Other account receives no projection');
select is((select count(*) from school_person_contacts),0::bigint,'Cafeteria role cannot read guardian contacts');
select is((select count(*) from family_guardians),0::bigint,'Cafeteria role cannot read family or guardian records');
select is((select count(*) from cafeteria_customers),0::bigint,'Cafeteria role cannot read customer base table directly');
select is((select count(*) from cafeteria_customer_projection('00000000-0000-0000-0000-000000000111','Teacher Demo')),1::bigint,
  'POS projection supports identified staff customers');
reset role;

select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002002',true);
set local role authenticated;
select lives_ok($$select public.set_school_cafeteria_sharing('00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000111','active',
  array['basic_identification','student_code','placement','dietary_restrictions'])$$,
  'School can explicitly enable dietary category after default-deny');
reset role;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002007',true);
set local role authenticated;
select is((select jsonb_array_length(restrictions) from cafeteria_customer_projection(
  '00000000-0000-0000-0000-000000000111','Sofia Demo') limit 1),1,
  'Enabled dietary category returns only operational restriction details');
reset role;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002002',true);
set local role authenticated;
select lives_ok($$select public.set_school_cafeteria_sharing('00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000111','active',
  array['basic_identification','student_code','placement'])$$,
  'School can revoke only the dietary sharing category');
reset role;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002007',true);
set local role authenticated;
select is((select restrictions from cafeteria_customer_projection(
  '00000000-0000-0000-0000-000000000111','Sofia Demo') limit 1),'[]'::jsonb,
  'Previously enabled dietary data disappears when its category is disabled');
select is((select student_code from cafeteria_customer_projection(
  '00000000-0000-0000-0000-000000000111','Sofia Demo') limit 1),'STU-001',
  'Disabling dietary sharing preserves other enabled categories');
reset role;

update public.cafeteria_customers set status='inactive' where id='00000000-0000-0000-0000-000000006901';
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002007',true);
set local role authenticated;
select is((select count(*) from cafeteria_customer_projection('00000000-0000-0000-0000-000000000111','STU-001')),0::bigint,
  'Inactive customer link is excluded from lookup');
reset role;
update public.cafeteria_customers set status='active' where id='00000000-0000-0000-0000-000000006901';
update public.student_campus_placements set status='ended',ends_on=current_date
  where id='00000000-0000-0000-0000-000000005402';
update public.student_enrollments set status='withdrawn',ends_on=current_date
  where id='00000000-0000-0000-0000-000000005302';
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002007',true);
set local role authenticated;
select is((select count(*) from cafeteria_customer_projection('00000000-0000-0000-0000-000000000111','STU-001')),0::bigint,
  'Withdrawn student is excluded from lookup');
reset role;
update public.staff_campus_affiliations set status='ended',ends_on=current_date+1
  where id='00000000-0000-0000-0000-000000006601';
update public.school_staff_affiliations set status='inactive',ends_on=current_date+1
  where id='00000000-0000-0000-0000-000000006501';
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002007',true);
set local role authenticated;
select is((select count(*) from cafeteria_customer_projection('00000000-0000-0000-0000-000000000111','Teacher Demo')),0::bigint,
  'Inactive staff affiliation is excluded from lookup');
reset role;
update public.school_staff_affiliations set status='active',ends_on=null
  where id='00000000-0000-0000-0000-000000006501';
update public.staff_campus_affiliations set status='active',ends_on=null
  where id='00000000-0000-0000-0000-000000006601';
update public.cafeteria_memberships set status='suspended' where id='00000000-0000-0000-0000-000000003203';
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002007',true);
set local role authenticated;
select is((select count(*) from cafeteria_customer_projection('00000000-0000-0000-0000-000000000111','Teacher Demo')),0::bigint,
  'Suspended cafeteria membership cannot use customer projection');
reset role;
update public.cafeteria_memberships set status='active' where id='00000000-0000-0000-0000-000000003203';
update public.school_locations set status='inactive' where id='00000000-0000-0000-0000-000000000211';
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002007',true);
set local role authenticated;
select is((select count(*) from cafeteria_customer_projection('00000000-0000-0000-0000-000000000111','Teacher Demo')),0::bigint,
  'Inactive parent campus blocks customer projection');
reset role;
update public.school_locations set status='active' where id='00000000-0000-0000-0000-000000000211';
update public.cafeterias set status='suspended' where id='00000000-0000-0000-0000-000000000111';
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002007',true);
set local role authenticated;
select is((select count(*) from cafeteria_customer_projection('00000000-0000-0000-0000-000000000111','Teacher Demo')),0::bigint,
  'Inactive cafeteria blocks customer projection');
reset role;
update public.cafeterias set status='active' where id='00000000-0000-0000-0000-000000000111';

delete from auth.users where id='00000000-0000-0000-0000-000000002012';
select is((select count(*) from persons where id='00000000-0000-0000-0000-000000005104' and auth_user_id is null),1::bigint,
  'Auth deletion unlinks staff person without deleting identity');
select is((select count(*) from school_staff_affiliations where id='00000000-0000-0000-0000-000000006501'),1::bigint,
  'Auth deletion preserves staff affiliation history');
select ok(not exists(select 1 from audit_events where target_type='school_person_contacts'
  and before_metadata ?| array['contact_value','value_key'] or after_metadata ?| array['contact_value','value_key']),
  'Audit does not copy contact details');

select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002002',true);
set local role authenticated;
select lives_ok($$select public.withdraw_student_enrollment('00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000011',(select e.id from student_enrollments e join students s on s.id=e.student_id
  where s.code_key='test-001' and e.status='active'),current_date-4)$$,
  'School Admin withdraws student before deactivation');
select lives_ok($$select public.set_student_status('00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000011',(select id from students where code_key='test-001'),'inactive')$$,
  'School Admin deactivates student after withdrawal');
select is((select count(*) from students where code_key='test-001' and status='inactive'),1::bigint,
  'Inactive student identity remains preserved');

reset role;
grant insert on public.students to authenticated;
set local role authenticated;
select throws_ok($$insert into public.students(account_id,school_id,person_id,student_code,first_name,last_name,display_name)
  values('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011',
  '00000000-0000-0000-0000-000000005198','BYPASS','Bypass','Attempt','Bypass Attempt')$$,
  '42501',null,'RLS denies direct insert even when SQL grant is broadened');
reset role;
revoke insert on public.students from authenticated;
select * from finish();
rollback;