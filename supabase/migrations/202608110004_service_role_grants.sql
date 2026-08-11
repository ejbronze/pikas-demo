-- Server-only development provisioning. Client access remains governed by RLS.
grant usage on schema public to service_role;
grant select, insert, update on table public.profiles to service_role;
grant select, update on table public.students to service_role;
grant select, insert on table public.family_members to service_role;
