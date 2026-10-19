# Phase 6A: identity, credentials and user provisioning

Status: implemented and verified locally (migration `202610260001_identity_credentials.sql`).
Not pushed or deployed, and nothing is provisioned. No CEPOINT data and no production identities
exist in this milestone. This document is separate from `PHASE_6A_BOOTSTRAP.md` (Platform
bootstrap), which is an earlier milestone that shares the "6A" label.

## Identity model (unchanged core)

The chain is: one Supabase Auth user → one Person (`persons.auth_user_id`) → memberships
(account, school or cafeteria) → capabilities.

Phase 6A adds one optional credential row per Person in `pikas_private.login_identities`:
- **username**: unique and case-insensitive;
- **forced password change**: a flag plus the issuance baseline;
- **login suspension**: a flag;
- **pending email correction**: a pending value;
- **version**: an optimistic-concurrency counter.

A credential operation never creates a Person and never creates or changes a membership. It
does not create a second Auth user. No synthetic email addresses are used.

## Login: "Correo / Usuario"

- The tenant login (`/login`) accepts an email OR a PIKAS username in one text field. Backoffice
  login keeps email only.
- An identifier containing `@` is treated as an email. Anything else is normalized (trim, lowercase)
  and resolved server-side by `public.login_identifier_email(username)`. Only `service_role` can
  execute that function, so no client or anonymous endpoint can test whether a username exists.
- Both identifiers sign in the SAME Auth user with the same password and land on the same home.
- Malformed identifiers, unknown usernames, wrong passwords and suspended logins all receive the
  same generic `credentials` message.

## Username rules

- 3–40 characters: `a-z`, `0-9`, and the separators `.`, `_`, `-`. No leading or trailing
  separator, and no consecutive separators. A username can never be an email.
- Stored normalized lowercase, globally unique, enforced by a database unique constraint. A
  concurrent claim of the same username blocks on the index, and the second claim is rejected with
  `username_unavailable`. This was observed with `pg_blocking_pids`.
- Reserved names live in `pikas_private.reserved_usernames` (empty for now). Adding one rejects new
  claims and never renames an existing username.
- Changes are version-guarded: a stale screen gets `identity_version_changed`.
- Example usernames in tests are fictional and are not a naming convention.

## Email

The email is a login identifier, the Auth email and the recovery address. A correction is
Platform-only, requires a reason, and runs in three steps:

1. `identity_begin_email_change` authorizes the request, rejects an email held by another Auth user
   (`email_unavailable`), and records the pending value and the audit entry.
2. The server updates the SAME Auth user through the Auth admin API, as a confirmed email.
3. `identity_finish_email_change` succeeds only if Auth now holds that email, and then audits it.

If Auth cannot apply the change, nothing is confirmed and the identity is unchanged. The Person,
its memberships and its username are preserved.

## Temporary access and forced password change

1. `identity_begin_temporary_access` (Platform or tenant scope):
   - sets the forced-change flag;
   - ends the person's live PIKAS application sessions;
   - from that moment `current_person_id()` returns null, so the person holds no PIKAS authority.
2. The server generates a random 14-character password and sets it on the SAME Auth user.
3. `identity_finish_temporary_access` records a SHA-256 baseline of the stored hash (never the
   password itself).

The password appears once, in the operator's task, over a `no-store` response. It is never
logged, stored, audited or shown again. If step 2 or step 3 fails, no password is returned and the
identity stays gated until access is reissued (fail closed).

On login with the temporary password, the person is sent to `/actualizar-contrasena?motivo=temporal`.
`identity_complete_password_change` clears the flag only when the new stored hash differs from the
baseline. Self-service email recovery also completes a pending change.

## Login suspension

Platform-only and requires a reason. It does three things:
- sets an authoritative PIKAS flag, so `current_person_id()` returns null and login is refused
  generically;
- ends live application sessions;
- mirrors the flag as an Auth ban, lifted on reactivation.

Memberships and history are untouched. Tenant administrators keep using membership status
(Personal POS "Cambiar acceso").

## Who may support an identity

The database decides support scope on every call, in `pikas_private.identity_support_scope`. A
target must be Auth-linked and hold no Platform membership; the actor is never the target. Nothing
is allowed under a sandbox POV.

- **Platform** support needs the new narrow capability `platform:identity:support`, granted to
  `platform_admin` (Edwin, Oscar). It allows exact lookup by email or username, plus the summary,
  username, email correction, temporary access, suspension and reactivation.
  - It is support only. It grants no tenant role and opens no tenant data.
  - `tenant_identity_required` is unchanged.
  - There is no impersonation.
  - Platform identities cannot be targeted.
- **Tenant** scope applies when EVERY non-inactive membership the target holds is managed by the
  actor. Each membership must be covered by one of:
  - an Account Admin of the same account;
  - a School Admin of that school (for school-cafeteria roles);
  - a Cafeteria Admin of that cafeteria (for POS roles only).

  Targets holding account memberships are excluded. A Cafeteria Admin therefore cannot touch
  someone who also works in another cafeteria, a peer administrator, or another customer. Tenant
  scope offers username and temporary access only.
- **Reissuing access:** pending identities keep the existing per-scope private activation-link
  flows. Active identities use temporary access.

## Audit

`pikas_private.identity_audit_events` is append-only (a trigger rejects any change). Each entry
records:
- the real operator (Person and Auth user) and the actor scope (`platform`, `tenant` or `self`);
- the target Person and target Auth user;
- the operation and timestamp;
- safe before/after metadata;
- the reason, where one is required.

A check constraint rejects the metadata keys `password`, `temporary_password`, `password_hash`,
`token`, `secret`, `otp` and `link`. The audit appears in the support views.

## Multi-cafeteria (one Person, several cafeterias)

This already works with existing contracts. The cafeteria selector lists only the cafeterias from
`get_cafeteria_admin_context`. The server rejects any `?cafeteria=` outside that list, and every
cafeteria RPC re-authorizes. Verified with a Cafeteria Admin of two cafeterias (pgTAP and browser).
There is no customer-specific logic.

## CEPOINT readiness (not provisioned)

The model supports these future identities, none of which is created here:
- Manuel as Cafeteria Admin of the Santiago and Tamboril cafeterias, not School Admin;
- each cashier scoped to her own cafeteria and register;
- an institutional onboarding identity that is never converted into a different human.

Provisioning happens later through the existing hierarchy and activation flows, with username
assignment afterwards. QA identities (`democafeteria`, `demoescuela`, `demopos`) are optional
local fixtures only, never production, and never mixed with the Platform Demo.

## Surfaces

- `/login`: "Correo / Usuario".
- `/actualizar-contrasena`: forced change after temporary access.
- `/platform/identidades`: Platform identity support.
- Personal POS → **Credenciales**: tenant scope.
- API: `/api/identity`, which is same-origin, authenticated and `no-store`.

## Deferred

These are recorded future work and are NOT implemented:

- **Username at activation:** an optional username at staff activation. Today it is assigned
  afterwards in Credenciales.
- **POS cash payment:** a focused cash-payment modal/task in the POS (amount received, change).
- **Clientes lifecycle:** customer lifecycle management (suspend, archive, reactivate) in Platform
  Clientes.
- **Bank-transfer replenishments:** PIKAS Cash replenishment by bank transfer (BHD, Banreservas)
  with proof via WhatsApp and operator verification before the credit.
- **Replenishment commission:** 3% of the replenishment only, paid by the person replenishing.
  Example: gross RD$2,000 → commission RD$60 → net credited RD$1,940. No commission on purchases.
- **Cash at the cafeteria:** the cafeteria collects the full amount and holds the RD$60 owed to
  PIKAS.
- **Weekly settlement** in two directions:
  - PIKAS pays cafeterias for PIKAS Cash purchases;
  - cafeterias pay PIKAS the commissions they collected in cash.
- **Card and payment-link fees:** a separate future decision.
