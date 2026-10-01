-- SYNTHETIC LOCAL FIXTURES ONLY. Not a production bootstrap or real Auth invitation.
begin;
insert into auth.users(id,aud,role,email) values ('00000000-0000-0000-0000-000000002001','authenticated','authenticated','foundation-1@example.invalid');
insert into auth.users(id,aud,role,email) values ('00000000-0000-0000-0000-000000002002','authenticated','authenticated','foundation-2@example.invalid');
insert into auth.users(id,aud,role,email) values ('00000000-0000-0000-0000-000000002003','authenticated','authenticated','foundation-3@example.invalid');
insert into auth.users(id,aud,role,email) values ('00000000-0000-0000-0000-000000002004','authenticated','authenticated','foundation-4@example.invalid');
insert into auth.users(id,aud,role,email) values ('00000000-0000-0000-0000-000000002005','authenticated','authenticated','foundation-5@example.invalid');
insert into auth.users(id,aud,role,email) values ('00000000-0000-0000-0000-000000002006','authenticated','authenticated','foundation-6@example.invalid');
insert into auth.users(id,aud,role,email) values ('00000000-0000-0000-0000-000000002007','authenticated','authenticated','foundation-7@example.invalid');
insert into auth.users(id,aud,role,email) values ('00000000-0000-0000-0000-000000002008','authenticated','authenticated','foundation-8@example.invalid');
insert into auth.users(id,aud,role,email) values ('00000000-0000-0000-0000-000000002009','authenticated','authenticated','foundation-9@example.invalid');
insert into auth.users(id,aud,role,email) values ('00000000-0000-0000-0000-000000002010','authenticated','authenticated','foundation-10@example.invalid');
insert into public.accounts(id,code,name) values ('00000000-0000-0000-0000-000000000001','SYNTHETIC-A','SYNTHETIC-A');
insert into public.accounts(id,code,name) values ('00000000-0000-0000-0000-000000000002','SYNTHETIC-B','SYNTHETIC-B');
insert into public.schools(id,account_id,code,name) values ('00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000001','A1','Synthetic school A1');
insert into public.schools(id,account_id,code,name) values ('00000000-0000-0000-0000-000000000012','00000000-0000-0000-0000-000000000001','A2','Synthetic school A2');
insert into public.schools(id,account_id,code,name) values ('00000000-0000-0000-0000-000000000021','00000000-0000-0000-0000-000000000002','B1','Synthetic school B1');
-- School A1 has two campuses; A2 and B1 preserve school/account isolation coverage.
insert into public.school_locations(id,account_id,school_id,code,name) values ('00000000-0000-0000-0000-000000000211','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011','L1','Synthetic campus A1-C1');
insert into public.cafeterias(id,account_id,school_id,school_location_id,code,name) values ('00000000-0000-0000-0000-000000000111','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000211','CAF','Synthetic cafeteria A1-C1');
insert into public.school_locations(id,account_id,school_id,code,name) values ('00000000-0000-0000-0000-000000000213','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011','L2','Synthetic campus A1-C2');
insert into public.cafeterias(id,account_id,school_id,school_location_id,code,name) values ('00000000-0000-0000-0000-000000000113','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000213','CAF','Synthetic cafeteria A1-C2');
insert into public.school_locations(id,account_id,school_id,code,name) values ('00000000-0000-0000-0000-000000000212','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000012','L1','Synthetic campus A2-C1');
insert into public.cafeterias(id,account_id,school_id,school_location_id,code,name) values ('00000000-0000-0000-0000-000000000112','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000012','00000000-0000-0000-0000-000000000212','CAF','Synthetic cafeteria A2-C1');
insert into public.school_locations(id,account_id,school_id,code,name) values ('00000000-0000-0000-0000-000000000221','00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000021','L1','Synthetic campus B1-C1');
insert into public.cafeterias(id,account_id,school_id,school_location_id,code,name) values ('00000000-0000-0000-0000-000000000121','00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000021','00000000-0000-0000-0000-000000000221','CAF','Synthetic cafeteria B1-C1');
insert into public.persons(id,auth_user_id,display_name,status) values ('00000000-0000-0000-0000-000000001001','00000000-0000-0000-0000-000000002001','Synthetic person 1','active');
insert into public.persons(id,auth_user_id,display_name,status) values ('00000000-0000-0000-0000-000000001002','00000000-0000-0000-0000-000000002002','Synthetic person 2','active');
insert into public.persons(id,auth_user_id,display_name,status) values ('00000000-0000-0000-0000-000000001003','00000000-0000-0000-0000-000000002003','Synthetic person 3','active');
insert into public.persons(id,auth_user_id,display_name,status) values ('00000000-0000-0000-0000-000000001004','00000000-0000-0000-0000-000000002004','Synthetic person 4','active');
insert into public.persons(id,auth_user_id,display_name,status) values ('00000000-0000-0000-0000-000000001005','00000000-0000-0000-0000-000000002005','Synthetic person 5','active');
insert into public.persons(id,auth_user_id,display_name,status) values ('00000000-0000-0000-0000-000000001006','00000000-0000-0000-0000-000000002006','Synthetic person 6','active');
insert into public.persons(id,auth_user_id,display_name,status) values ('00000000-0000-0000-0000-000000001007','00000000-0000-0000-0000-000000002007','Synthetic person 7','active');
insert into public.persons(id,auth_user_id,display_name,status) values ('00000000-0000-0000-0000-000000001008','00000000-0000-0000-0000-000000002008','Synthetic person 8','active');
insert into public.persons(id,auth_user_id,display_name,status) values ('00000000-0000-0000-0000-000000001009','00000000-0000-0000-0000-000000002009','Synthetic person 9','suspended');
insert into public.persons(id,auth_user_id,display_name,status) values ('00000000-0000-0000-0000-000000001010','00000000-0000-0000-0000-000000002010','Synthetic person 10','active');
insert into public.account_memberships(id,account_id,person_id,role_code) values ('00000000-0000-0000-0000-000000003001','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000001001','account_admin');
insert into public.school_memberships(id,account_id,school_id,person_id,role_code) values ('00000000-0000-0000-0000-000000003101','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000001002','school_admin');
insert into public.school_memberships(id,account_id,school_id,person_id,role_code) values ('00000000-0000-0000-0000-000000003102','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000001005','school_admin');
insert into public.school_memberships(id,account_id,school_id,person_id,role_code) values ('00000000-0000-0000-0000-000000003103','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000012','00000000-0000-0000-0000-000000001005','school_admin');
insert into public.school_memberships(id,account_id,school_id,person_id,role_code) values ('00000000-0000-0000-0000-000000003104','00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000021','00000000-0000-0000-0000-000000001006','school_admin');
insert into public.school_memberships(id,account_id,school_id,person_id,role_code) values ('00000000-0000-0000-0000-000000003105','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000001009','school_admin');
insert into public.school_memberships(id,account_id,school_id,person_id,role_code) values ('00000000-0000-0000-0000-000000003106','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000001010','school_admin');
insert into public.cafeteria_memberships(id,account_id,school_id,cafeteria_id,person_id,role_code) values ('00000000-0000-0000-0000-000000003201','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000111','00000000-0000-0000-0000-000000001003','cafeteria_admin');
insert into public.cafeteria_memberships(id,account_id,school_id,cafeteria_id,person_id,role_code) values ('00000000-0000-0000-0000-000000003202','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000012','00000000-0000-0000-0000-000000000112','00000000-0000-0000-0000-000000001004','cafeteria_admin');
insert into public.cafeteria_memberships(id,account_id,school_id,cafeteria_id,person_id,role_code) values ('00000000-0000-0000-0000-000000003203','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000111','00000000-0000-0000-0000-000000001007','pos_operator');
insert into public.invitations(id,account_id,school_id,scope_kind,role_code,intended_email,token_hash,invited_by,expires_at) values ('00000000-0000-0000-0000-000000004001','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011','school','school_admin','foundation-8@example.invalid',repeat('a',64),'00000000-0000-0000-0000-000000001002',now()+interval '7 days');
-- Independent cafeteria memberships, not a school-wide role.
insert into auth.users(id,aud,role,email) values ('00000000-0000-0000-0000-000000002011','authenticated','authenticated','foundation-11@example.invalid');
insert into public.persons(id,auth_user_id,display_name) values ('00000000-0000-0000-0000-000000001011','00000000-0000-0000-0000-000000002011','Synthetic multi-cafeteria person');
insert into public.cafeteria_memberships(id,account_id,school_id,cafeteria_id,person_id,role_code) values ('00000000-0000-0000-0000-000000003204','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000111','00000000-0000-0000-0000-000000001011','cafeteria_admin');
insert into public.cafeteria_memberships(id,account_id,school_id,cafeteria_id,person_id,role_code) values ('00000000-0000-0000-0000-000000003205','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000113','00000000-0000-0000-0000-000000001011','cafeteria_admin');

-- Phase 2 synthetic people: students, guardians, and staff do not need Auth identities.
insert into auth.users(id,aud,role,email) values ('00000000-0000-0000-0000-000000002012','authenticated','authenticated','staff@example.invalid');
insert into public.persons(id,auth_user_id,display_name) values ('00000000-0000-0000-0000-000000005101',null,'Sofia Demo');
insert into public.persons(id,auth_user_id,display_name) values ('00000000-0000-0000-0000-000000005102',null,'Mateo Demo');
insert into public.persons(id,auth_user_id,display_name) values ('00000000-0000-0000-0000-000000005103',null,'Guardian Demo');
insert into public.persons(id,auth_user_id,display_name) values ('00000000-0000-0000-0000-000000005104','00000000-0000-0000-0000-000000002012','Teacher Demo');
insert into public.persons(id,auth_user_id,display_name) values ('00000000-0000-0000-0000-000000005105',null,'Second Guardian Demo');
insert into public.students(id,account_id,school_id,person_id,student_code,first_name,last_name,display_name)
values ('00000000-0000-0000-0000-000000005201','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000005101','STU-001','Sofia','Demo','Sofia Demo');
insert into public.students(id,account_id,school_id,person_id,student_code,first_name,last_name,display_name)
values ('00000000-0000-0000-0000-000000005202','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000005102','STU-002','Mateo','Demo','Mateo Demo');
insert into public.student_enrollments(id,account_id,school_id,student_id,starts_on,ends_on,status)
values ('00000000-0000-0000-0000-000000005301','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000005201','2025-08-01','2026-01-05','completed');
insert into public.student_campus_placements(id,account_id,school_id,enrollment_id,school_location_id,grade_label,class_label,starts_on,ends_on,status)
values ('00000000-0000-0000-0000-000000005401','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000005301','00000000-0000-0000-0000-000000000211','Grade 4','4-A','2025-08-01','2026-01-05','ended');
insert into public.student_enrollments(id,account_id,school_id,student_id,starts_on)
values ('00000000-0000-0000-0000-000000005302','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000005201','2026-01-05');
insert into public.student_campus_placements(id,account_id,school_id,enrollment_id,school_location_id,grade_label,class_label,starts_on)
values ('00000000-0000-0000-0000-000000005402','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000005302','00000000-0000-0000-0000-000000000213','Grade 5','5-A','2026-01-05');
insert into public.student_enrollments(id,account_id,school_id,student_id,starts_on)
values ('00000000-0000-0000-0000-000000005303','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000005202','2025-08-01');
insert into public.student_campus_placements(id,account_id,school_id,enrollment_id,school_location_id,grade_label,class_label,starts_on)
values ('00000000-0000-0000-0000-000000005403','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000005303','00000000-0000-0000-0000-000000000211','Grade 2','2-B','2025-08-01');
insert into public.families(id,account_id,school_id,family_code)
values ('00000000-0000-0000-0000-000000006001','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011','FAM-001');
insert into public.families(id,account_id,school_id,family_code)
values ('00000000-0000-0000-0000-000000006002','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011','FAM-002');
insert into public.family_student_relationships(id,account_id,school_id,family_id,student_id,is_primary)
values ('00000000-0000-0000-0000-000000006101','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000006001','00000000-0000-0000-0000-000000005201',true);
insert into public.family_student_relationships(id,account_id,school_id,family_id,student_id,is_primary)
values ('00000000-0000-0000-0000-000000006102','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000006002','00000000-0000-0000-0000-000000005201',false);
insert into public.family_student_relationships(id,account_id,school_id,family_id,student_id,is_primary)
values ('00000000-0000-0000-0000-000000006103','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000006001','00000000-0000-0000-0000-000000005202',true);
insert into public.family_guardians(id,account_id,school_id,family_id,person_id,relationship_type)
values ('00000000-0000-0000-0000-000000006201','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000006001','00000000-0000-0000-0000-000000005103','guardian');
insert into public.family_guardians(id,account_id,school_id,family_id,person_id,relationship_type)
values ('00000000-0000-0000-0000-000000006202','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000006001','00000000-0000-0000-0000-000000005105','other');
insert into public.student_guardians(id,account_id,school_id,student_id,person_id,relationship_type)
values ('00000000-0000-0000-0000-000000006301','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000005201','00000000-0000-0000-0000-000000005103','guardian');
insert into public.school_person_contacts(id,account_id,school_id,person_id,contact_type,contact_value)
values ('00000000-0000-0000-0000-000000006401','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000005103','email','guardian@example.invalid');
insert into public.school_staff_affiliations(id,account_id,school_id,person_id,staff_category,employee_code)
values ('00000000-0000-0000-0000-000000006501','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000005104','teacher','EMP-001');
insert into public.staff_campus_affiliations(id,account_id,school_id,staff_affiliation_id,school_location_id)
values ('00000000-0000-0000-0000-000000006601','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000006501','00000000-0000-0000-0000-000000000213');
insert into public.student_dietary_restrictions(id,account_id,school_id,student_id,restriction_type,restriction_code,display_label)
values ('00000000-0000-0000-0000-000000006701','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000005201','allergen','peanut','Peanut');
insert into public.school_cafeteria_shares(id,account_id,school_id,cafeteria_id,status)
values ('00000000-0000-0000-0000-000000006801','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000111','active');
insert into public.school_cafeteria_share_categories(account_id,school_id,cafeteria_id,share_id,category,enabled) values
('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000111','00000000-0000-0000-0000-000000006801','basic_identification',true),
('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000111','00000000-0000-0000-0000-000000006801','student_code',true),
('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000111','00000000-0000-0000-0000-000000006801','placement',true),
('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000111','00000000-0000-0000-0000-000000006801','dietary_restrictions',false);
insert into public.cafeteria_customers(id,account_id,school_id,cafeteria_id,student_id)
values ('00000000-0000-0000-0000-000000006901','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000111','00000000-0000-0000-0000-000000005201');
insert into public.cafeteria_customers(id,account_id,school_id,cafeteria_id,staff_affiliation_id)
values ('00000000-0000-0000-0000-000000006902','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000111','00000000-0000-0000-0000-000000006501');
commit;
