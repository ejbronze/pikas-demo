-- PIKAS Pilot Hardening: relationship start dates default to the business date (local; not deployed).
--
-- Six columns defaulted starts_on to CURRENT_DATE — the database session's date, UTC in production. From about 20:00 to
-- 24:00 America/Santo_Domingo every family, guardian, staff, campus-staff or restriction record created without an
-- explicit date started TOMORROW, so ending or correcting it the same evening failed ("not found" / "end precedes start").
-- The default is now the America/Santo_Domingo calendar date — the PIKAS business timezone and the business_timezone of
-- every school (a column default cannot read the row's school). Explicit dates are unchanged; existing rows are untouched.
begin;

alter table public.family_guardians alter column starts_on set default ((pg_catalog.clock_timestamp() at time zone 'America/Santo_Domingo')::date);
alter table public.family_student_relationships alter column starts_on set default ((pg_catalog.clock_timestamp() at time zone 'America/Santo_Domingo')::date);
alter table public.school_staff_affiliations alter column starts_on set default ((pg_catalog.clock_timestamp() at time zone 'America/Santo_Domingo')::date);
alter table public.staff_campus_affiliations alter column starts_on set default ((pg_catalog.clock_timestamp() at time zone 'America/Santo_Domingo')::date);
alter table public.student_dietary_restrictions alter column starts_on set default ((pg_catalog.clock_timestamp() at time zone 'America/Santo_Domingo')::date);
alter table public.student_guardians alter column starts_on set default ((pg_catalog.clock_timestamp() at time zone 'America/Santo_Domingo')::date);

do $chk$
begin
  if exists (select 1 from information_schema.columns where table_schema in ('public','pikas_private') and column_default ~* '\mcurrent_date\M') then
    raise exception 'session_date_default_remains'; end if;
end $chk$;

commit;
