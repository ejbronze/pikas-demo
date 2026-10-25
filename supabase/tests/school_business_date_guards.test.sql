-- PIKAS Pilot Hardening: enrollment dates are the school's business date (202611240001). Fictional fixtures; rolls back.
-- The session clock is deliberately moved to UTC+14 and UTC-12 so the school's America/Santo_Domingo date and the
-- session's current_date disagree, as they do in production (UTC) every evening after 20:00 AST.
-- Foundation fixtures: account 1, school 11 (America/Santo_Domingo), campus 211, School Admin 2002, student 5202 (active enrollment since 2025-08-01).
begin;
create extension if not exists pgtap with schema extensions;
set search_path=public,extensions;
select no_plan();

create function pg_temp.attempt(sql text) returns text language plpgsql as $$declare m text; s text; begin execute sql; return 'ok';
 exception when others then get stacked diagnostics m=message_text, s=returned_sqlstate; return s||':'||m; end$$;
create function pg_temp.as_user(u text) returns void language plpgsql as $$begin
 execute 'reset role'; perform set_config('request.jwt.claim.sub',u,true); execute 'set local role authenticated'; end$$;
create function pg_temp.sd_today() returns date language sql as $$select (clock_timestamp() at time zone 'America/Santo_Domingo')::date$$;
grant execute on all functions in schema pg_temp to authenticated;
select set_config('t.e',(select id::text from student_enrollments where student_id='00000000-0000-0000-0000-000000005202' and status='active'),true);

select is(pikas_private.school_business_date('00000000-0000-0000-0000-000000000011'),pg_temp.sd_today(),'The school business date is its America/Santo_Domingo calendar date');
select ok(not has_function_privilege('authenticated','pikas_private.school_business_date(uuid)','execute') and not has_function_privilege('anon','pikas_private.school_business_date(uuid)','execute'),
 'The helper is private (owner only)');
select is((select count(*) from pg_proc where proname in ('guard_student_enrollment_period','guard_student_placement_period','student_bulk_check','transfer_student_campus','withdraw_student_enrollment')
 and prosrc ~* '\mcurrent_date\M'),0::bigint,'No enrollment guard reads the session date');

-- ── Session one day AHEAD of Santo Domingo (as UTC is after 20:00 AST) ─────────────────────────
set local timezone = 'Pacific/Kiritimati';
select ok(current_date > pg_temp.sd_today() or current_date = pg_temp.sd_today(),'(session date is ahead of or equal to the school date)');
select pg_temp.as_user('00000000-0000-0000-0000-000000002002');
select is(pg_temp.attempt($$select public.withdraw_student_enrollment('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011',
 current_setting('t.e')::uuid,pg_temp.sd_today()+1)$$),
 '22023:withdrawal_effective_date_cannot_be_future','Withdrawal dated tomorrow (school calendar) is refused even when the session date is already tomorrow');
select is(pg_temp.attempt($$select public.transfer_student_campus('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011',
 current_setting('t.e')::uuid,pg_temp.sd_today()+1,'00000000-0000-0000-0000-000000000211')$$),
 '22023:transfer_effective_date_cannot_be_future','Transfer dated tomorrow is refused');
reset role;
select is(pg_temp.attempt($$insert into student_campus_placements(account_id,school_id,enrollment_id,school_location_id,grade_label,starts_on)
 select account_id,school_id,id,'00000000-0000-0000-0000-000000000211','Synthetic grade',pg_temp.sd_today()+1 from student_enrollments
 where student_id='00000000-0000-0000-0000-000000005201' and status='active'$$),
 '23514:active_placement_cannot_start_in_future','An active placement starting tomorrow (school calendar) is refused by the table guard');
select pg_temp.as_user('00000000-0000-0000-0000-000000002002');
select is(pg_temp.attempt($$select public.withdraw_student_enrollment('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011',
 current_setting('t.e')::uuid,pg_temp.sd_today())$$),'ok','Withdrawal dated today (school calendar) is accepted');
select is(pg_temp.attempt($$select public.enroll_student('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000005202',pg_temp.sd_today()+1,'00000000-0000-0000-0000-000000000211',null,null,null)$$),
 '23514:active_enrollment_cannot_start_in_future','Re-enrollment starting tomorrow (school calendar) is refused');
reset role;

-- ── Session one day BEHIND Santo Domingo: today in the school stays valid ──────────────────────
set local timezone = 'Etc/GMT+12';
select pg_temp.as_user('00000000-0000-0000-0000-000000002002');
select ok((select public.enroll_student('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000005202',pg_temp.sd_today(),'00000000-0000-0000-0000-000000000211',null,null,null)) is not null,
 'Re-enrollment dated today (school calendar) is accepted even when the session date is still yesterday');
reset role;
select is((select starts_on from student_enrollments where student_id='00000000-0000-0000-0000-000000005202' and status='active'),pg_temp.sd_today(),'…and starts on the school date');

-- 202611240002: start-date defaults are the business date, never the session date.
select is((select count(*) from information_schema.columns where table_schema in ('public','pikas_private') and column_default ~* '\mcurrent_date\M'),0::bigint,'No column defaults to the session date');
set local timezone = 'Pacific/Kiritimati';
select is((select column_default from information_schema.columns where table_name='student_dietary_restrictions' and column_name='starts_on')::text ~ 'America/Santo_Domingo',true,
 'Restriction / guardian / family / staff start dates default to the America/Santo_Domingo date');
select * from finish();
rollback;
