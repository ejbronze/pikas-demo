# Phase 6A Auth bootstrap boundary

The pilot has no application tenant or controlled Auth identity yet. The web
application therefore has no public signup, self-provisioning endpoint, service
role, or automatic administrator assignment.

To establish the first controlled administrator, the project owner must:

1. Select the named human operator and have them accept an invitation created
   from the Supabase Auth dashboard for `pikas-pilot`
   (`xrqunrqovcynseqcjfmf`). Do not use demo credentials.
2. Decide the initial account, school, location, and cafeteria names and
   business codes. The application does not create this hierarchy in Phase 6A.
3. Have an authorized database owner create the hierarchy, insert one `persons`
   row linked to the invited Auth UUID, and insert exactly the intended
   `account_memberships`, `school_memberships`, and/or
   `cafeteria_memberships` rows with the narrowest role and scope.
4. Verify the operator through `/api/auth/context` and `/pilot/connected`.

The Auth invitation alone grants no application access. The membership write
must be reviewed and executed by an authorized owner using the Supabase SQL
Editor or an approved privileged maintenance procedure. Do not grant
`service_role` to the application, create a generic bootstrap endpoint, assign
an account-wide role by default, or run the removed legacy seeder.

Required owner inputs before provisioning: the operator's intended Auth email,
the initial tenant hierarchy and codes, and the exact scope/role they should
receive. No Auth user, Person, tenant, or membership was created as part of
Phase 6A.
