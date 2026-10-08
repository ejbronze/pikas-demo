# Phase 6A.1 platform and pilot bootstrap boundary

Phase 6A.1 adds a private platform authorization model in
`202610080001_platform_authority.sql`. It does not create an operator, tenant,
or Auth user. This guide describes the owner-controlled first-admin operation
and the subsequent onboarding workflow; it is not authorization to perform
those actions.

## Authority boundaries

Platform authority is independent of tenant roles. Platform authorization
resolves `auth.uid()` to an active `persons` row and then to an active
`platform_memberships` row, role, and explicit platform capability. It does not
use Auth metadata. The initial role is `platform_admin`, with only:

- `platform:tenant:provision`
- `platform:identity:link`
- `platform:customer_admin:provision`
- `platform:tenant:lifecycle:read`
- `platform:audit:read`

These permissions do not grant access to student/family records, wallets,
balances, ledger entries, purchases, tenders, refunds, receipts, staff
receivables, or cafeteria operations. Existing tenant RLS and
`pikas_private.has_capability` remain authoritative. Platform context is
returned separately from tenant `memberships` by `/api/auth/context`; platform
authority never satisfies `/pilot/connected` or a tenant route guard.

## First platform administrator: owner-only root operation

1. The project owner invites Edwin through the Supabase Auth dashboard for the
   approved pilot project. Public signup remains disabled.
2. Edwin accepts the invitation and completes the Auth password setup. The
   owner verifies that the invited Auth identity is confirmed and records its
   Auth UUID and exact email. Edwin must not provide a password to an agent.
3. Before proceeding, the owner confirms the Auth UUID/email belong to Edwin
   and checks that the Auth user is not already linked to a Person.
4. A database owner reviews and executes one transaction in the pilot SQL
   Editor to create the active Person, independent `platform_admin`
   membership, and root-bootstrap audit event. Replace the three marked
   placeholders with verified values. This SQL is illustrative and is not a
   self-service function or a reusable provisioning endpoint:

```sql
begin;
do $bootstrap$
declare
  v_auth_user_id uuid := 'REPLACE_WITH_VERIFIED_AUTH_UUID'::uuid;
  v_email text := lower(btrim('REPLACE_WITH_VERIFIED_EDWIN_EMAIL'));
  v_display_name text := 'Edwin';
  v_person_id uuid;
begin
  if not exists (
    select 1 from auth.users u
    where u.id = v_auth_user_id
      and lower(btrim(u.email)) = v_email
      and u.confirmed_at is not null
  ) then
    raise exception 'confirmed_auth_identity_mismatch';
  end if;

  if exists (select 1 from public.persons p where p.auth_user_id = v_auth_user_id)
     or exists (
       select 1 from pikas_private.platform_memberships m
       join public.persons p on p.id = m.person_id
       where p.auth_user_id = v_auth_user_id
     ) then
    raise exception 'auth_identity_already_linked';
  end if;

  if exists (
    select 1 from pikas_private.platform_memberships
  ) then
    raise exception 'first_platform_admin_already_bootstrapped';
  end if;

  insert into public.persons(auth_user_id, display_name, status)
  values (v_auth_user_id, v_display_name, 'active')
  returning id into v_person_id;

  insert into pikas_private.platform_memberships(person_id, role_code, status)
  values (v_person_id, 'platform_admin', 'active');

  insert into pikas_private.platform_audit_events(
    actor_kind, capability, action, target_person_id, outcome,
    reason_code, metadata
  ) values (
    'owner_root_bootstrap', 'owner:platform_admin:bootstrap',
    'first_platform_admin_bootstrapped', v_person_id, 'succeeded',
    'owner_root_bootstrap', '{}'::jsonb
  );
end
$bootstrap$;
commit;
```

The membership insert must fail if the approved migration has not created the
`platform_admin` role. Do not add a root-bootstrap RPC, self-service platform
signup, Auth-metadata privilege, email-domain privilege, permanent bypass, or
service-role browser key. The transaction is intentionally a one-time
root-of-trust operation. Keep its owner-reviewed execution record outside
application-visible audit data as required by the project’s change-control
process.

## Tenant and customer-admin onboarding after root setup

Once Edwin's platform identity has been positively verified:

1. Call `platform_provision_tenant` with a fresh UUID request ID and the
   reviewed Account, School, School Location/Campus, and Cafeteria codes/names.
   The hierarchy is created atomically and the RPC returns only the four IDs.
   Repeating the same request ID and exact payload returns the original IDs;
   reusing it for a different actor or payload is rejected.
2. Prepare the customer-admin onboarding intent with
   `platform_prepare_customer_admin`. The role/scope allow-list is
   `account_admin` at Account, `school_admin` at School, or `cafeteria_admin`
   at Cafeteria. POS cashier/supervisor and platform roles are not grantable by
   this workflow. The intent binds the intended normalized email, tenant
   scope, role, and expiry.
3. The intended human accepts an owner-created Supabase Auth invitation. Auth
   invitation delivery and acceptance remain Auth-dashboard operations, not
   database RPC behavior.
4. Call `platform_link_customer_admin_identity` with the intent ID, Auth UUID,
   and display name. It requires a confirmed Auth email matching the intent.
   It links that Auth UUID to one active Person, or creates a Person if none is
   already linked. It cannot change an existing Person's Auth link.
5. Call `platform_grant_customer_admin` for the linked intent. It creates only
   the explicitly requested scoped customer membership. Tenant RLS remains
   responsible for the resulting customer access.
6. Verify tenant context separately from platform context. A platform-only
   operator can use platform provisioning APIs but does not receive a pilot
   tenant session merely because they are a platform administrator.

Edwin's pilot `cafeteria_admin` membership is a deliberate customer grant, not
an automatic consequence of `platform_admin`. The same Edwin Person and Auth
identity may be linked through a separate cafeteria-admin intent for the
specific pilot cafeteria. Platform and tenant memberships remain independently
revocable.

## Audit and failures

Successful provisioning, identity linking, and customer-admin grants append a
sanitized platform audit event in the same transaction as the mutation. Audit
events are not client-writable or mutable. The bounded `platform_read_audit`
RPC requires `platform:audit:read`.

An in-transaction audit insert for a denied operation would roll back with the
failed transaction. Failed/denied requests must therefore be observed through
the application's ordinary server-side request/error logging; do not claim
that a rolled-back database audit event persists. Never put student, family,
financial, purchase, wallet, or credential contents in platform audit
metadata.

## Validation boundary

The local `phase6a1_platform_authority.test.sql` suite uses synthetic local
Auth identities and transactions that roll back. It does not create a pilot
identity or tenant in the remote project. Do not run remote push/reset/link
operations for Phase 6A.1.
