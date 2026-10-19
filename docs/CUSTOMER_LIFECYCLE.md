# Platform customer lifecycle (Clientes)

Status: implemented and verified locally (migration `202610280001_customer_lifecycle.sql`).
It has not been pushed or deployed. CEPOINT is not provisioned.

## States

| Internal code | UI label | Meaning |
|---|---|---|
| `active` | Activo | Normal operation. Tenant users act according to their existing memberships and capabilities. |
| `suspended` | Suspendido | Temporary operational hold. Tenant access is blocked. Everything is preserved and the state can be reversed. |
| `closed` | Cerrado | The customer relationship has ended. Tenant access is blocked. Everything is preserved. The customer stays visible to Platform and can be reopened. |

- **Where the state lives.** The authoritative state is the existing `public.accounts.status`. No
  parallel lifecycle table exists. `closed` was added to the existing check constraint.
  `inactive` remains valid for compatibility; it is unused and is not offered in the UI.
- **New customers.** They are created `active`, which is the column default. There is no separate
  onboarding state.
- **Sandbox tenants.** Sandbox (Demo) tenants have no customer lifecycle.

## Transitions (Platform only)

| From | Action | To | Audit event |
|---|---|---|---|
| Activo | Suspender | Suspendido | `customer_suspended` |
| Suspendido | Reactivar | Activo | `customer_reactivated` |
| Activo or Suspendido | Cerrar cliente | Cerrado | `customer_closed` |
| Cerrado | Reabrir cliente | Activo (the same customer id) | `customer_reopened` |

All transitions go through one function, `public.platform_set_customer_lifecycle(request_id,
account_id, expected_status, action, reason)`:

- **Authority.** It requires the new narrow capability `platform:tenant:lifecycle:manage`, which
  is granted only to `platform_admin`. `platform:tenant:lifecycle:read` keeps governing reads. The
  function is denied under a sandbox POV.
- **Reason.** A reason of 3 to 500 characters is required for every transition.
- **Expected state.** The caller must state the state they saw. A stale or concurrent action gets
  `lifecycle_state_changed`. The account row is locked, and concurrent attempts were observed
  blocking with `pg_blocking_pids`.
- **Invalid transitions.** No-op or invalid transitions (active→active, suspended→suspended,
  closed→closed, closed→suspended, closed→reactivate, reopen of a non-closed customer) get
  `invalid_lifecycle_transition`.
- **Retries.** The request is journaled in `platform_requests`: an exact retry replays the result,
  and the same key with another payload conflicts.
- **No tenant authority.** Holding the capability grants no tenant authority: no School, Cafeteria
  or POS access, no financial workspace and no impersonation.
- **Tenant roles are refused.** Account Admin, School Admin, Cafeteria Admin and cashiers cannot
  change the lifecycle, and there are no tenant-facing lifecycle controls.

## Access enforcement

Every tenant authority path already requires `accounts.status = 'active'`. These include:
- `pikas_private.scope_active`, and through it `has_capability` and RLS;
- `require_school_admin` and `require_cafeteria_admin`;
- the POS context and capabilities;
- the school and cafeteria admin contexts.

The block is therefore central and immediate:

- Memberships stay stored but grant nothing while the customer is suspended or closed.
- The block holds for bookmarked URLs, manually supplied IDs, stale browser state and direct RPC
  calls.
- Stale application sessions are blocked on their next request.
- No session is ended and no Auth user is banned. Customer lifecycle never uses the Phase 6A
  identity suspension.
- The block is scoped to the customer, not to the person. Someone who also serves another active
  customer keeps that other access.
- Tenant provisioning (staff, school administrators, delegation) is blocked while the customer is
  not active, because it relies on the same authority. Platform cannot prepare new tenant access
  for a suspended or closed customer either.
- Platform customer management (list, detail, lifecycle actions, history) remains available.

## What tenant users see

After authentication, the proxy, the shared denial redirect and the login route call
`public.tenant_lifecycle_state()`. This self-only function returns `suspended`, `closed` or null,
and it never returns a reason, an operator or another organization. The user then sees one of two
messages instead of a credentials or role error:

- **Suspended:** "El acceso de esta organización está temporalmente suspendido. Comunícate con el
  administrador de tu organización o con PIKAS para más información."
- **Closed:** "Esta cuenta de organización está cerrada y ya no tiene acceso operativo a PIKAS."

## Customer lifecycle vs. individual identity suspension

| | Customer lifecycle (this document) | Identity suspension (Phase 6A) |
|---|---|---|
| Scope | One customer (all of its tenant access) | One human login (all of their access) |
| Mechanism | `accounts.status` checked by tenant authority | `login_identities.login_suspended_at` plus an Auth ban |
| Sessions | Blocked on the next request; not ended | Ended |
| Interaction | Never changes identity flags. Reactivating a customer does not lift an individual suspension. | Never changes customer status. |

## Data preservation and financial non-effects

Suspending, reactivating, closing and reopening change only `accounts.status`, plus the audit
and journal rows. They never:

- delete or alter Persons, Auth users, memberships, schools, locations, cafeterias, register
  assignments or sessions;
- touch wallets or balances, wallet movements, purchases, cash sales, PIKAS Cash, refunds,
  adjustments, reconciliation, reports or receipts;
- perform settlement, refunds or balance zeroing.

Balances and obligations of a closed customer are preserved exactly as recorded. Reopening
recreates nothing: it is the same customer id, with the same structure, memberships and history.

## Audit

Every transition is written once to the append-only `pikas_private.platform_audit_events`, where
updates and deletes are rejected. Each entry records:
- the real Platform operator (Person and Auth user) and the request id;
- the customer;
- the `customer_*` reason code;
- metadata `{from, to, reason}`.

`public.platform_customer_lifecycle_history` (lifecycle:read) returns this history to Platform
operators only. Tenants never see reasons or audit.

## Clientes UI

- **List:** a lifecycle badge (Activo, Suspendido or Cerrado) and a filter with Todos, Activos,
  Suspendidos and Cerrados. Closed customers remain listed.
- **Detail:** an "Estado del cliente" panel showing the status, only the valid actions (when the
  operator has the capability) and the lifecycle history with operator and reason.
- **Actions:** each opens the shared modal task, with a required reason.
  - **Close** has the strongest copy (blocked access; no deletion; no balance or transaction
    change; no settlement; reopen only through Platform) and needs a deliberate acknowledgement.
  - **Reopen** confirms that the same customer returns to Activo.
  - An unconfirmed result is retried with exactly the same request.
- **Preparing access:** initial-administrator preparation is not offered while the customer is not
  active.

## Data retention & customer offboarding policy (future — not decided)

Closing a customer currently **preserves all existing customer data**. Closure triggers no
deletion, anonymization, purge, cold archival, balance change, or removal of financial, audit,
student or parent information.

**No retention duration has been selected yet.** A future *Data Retention & Customer Offboarding
Policy* must decide, by category:
- financial and accounting records;
- settlements;
- purchases, refunds and adjustments;
- audit and security history;
- operational tenant configuration;
- employee and staff identity information;
- student information;
- parent and guardian information;
- authentication and contact information;
- aggregate or anonymized product analytics.

It must weigh legitimate operational need, applicable legal and regulatory obligations (to be
established with evidence, not assumed), privacy, security, data minimization, and whether data can
be anonymized instead of retained identifiably. The future offboarding process will also resolve
outstanding balances and settlement obligations.
