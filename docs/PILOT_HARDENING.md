# PIKAS Pilot Hardening

Local milestone, 2026-10-25. It is the final readiness work before a controlled real pilot. **Not deployed.**

- **Baseline:** production app `f309062`, DB 76/76, finance dormant.
- **Customers:**
  - CEPOINT is a real customer and stays financially inactive.
  - Horizonte is the sandbox.

**Operational documents:**

- [Financial activation runbook](FINANCIAL_ACTIVATION_RUNBOOK.md)
- [Incident response](INCIDENT_RESPONSE.md)
- [Support operations](SUPPORT_OPERATIONS.md)
- [Pilot readiness checklist](PILOT_READINESS_CHECKLIST.md)
- [Privacy draft](legal/PRIVACY_NOTICE_DRAFT.md) and [terms draft](legal/TERMS_OF_SERVICE_DRAFT.md), for legal review only

## Migrations (additive, one reason each)

| Migration | Why |
|---|---|
| `202611240001_school_business_date_guards` | Enrollment, placement, transfer, withdrawal and bulk checks compare with the school's America/Santo_Domingo date (`pikas_private.school_business_date`), not the session's `current_date` (UTC in production, so «tomorrow» after 20:00 AST) |
| `202611240002_business_date_defaults` | `starts_on` defaults on guardian, family, staff and dietary rows use the Santo Domingo date |
| `202611240003_private_function_acl_hardening` | The six private functions that kept PUBLIC EXECUTE are revoked; `can_read_school_person` keeps `authenticated` only (it backs an RLS policy) |
| `202611240004_school_wallet_rows` | School PIKAS Cash list and attention rows read through the same POV-aware authority as the summary |
| `202611240005_school_sharing_rows` | School share rows read through the same authority as the cafeterías read |
| `202611240006_support_tickets` | Support tickets, `platform:support:read` / `:manage` |
| `202611240007_support_ticket_context` | Ticket sede/caja/version/browser context; Demo flag for sandbox-tenant reports; the shared UX11 Demo guard on every support mutation |
| `202611240008_support_respects_customer_lifecycle` | A suspended or closed customer's staff neither report nor answer (memberships grant nothing); Platform still answers |

## Workstreams

### WS1 — Test clocks

Settlement and lifecycle suites failed between 20:00 and 24:00 AST because tests used `current_date` and «now + 8 days»
(UTC).

- **Fix:** tests now use the Santo Domingo date (`pg_temp.sd_today()`) and week-anchored instants
  (`pg_temp.after_week(k)`).
- **Coverage:** the whole suite is run under four session clocks: UTC, Pacific/Kiritimati (session a day ahead),
  Etc/GMT+12 (a day behind) and America/Santo_Domingo.

### WS2 — School new-student date

The form defaulted to the browser's UTC date. It now uses `businessDate()` (`lib/business-date.ts`, America/Santo_Domingo).

The same clock-boundary class of defect existed in the database guards and defaults, which WS1 exposed. It is fixed by
migrations 0001 and 0002, with a pgTAP test (`school_business_date_guards`) that moves the session clock across the
boundary both ways.

### WS3 — FIN4 #92

The failure was not reproduced:

- 10 serial runs;
- 4 runs concurrent with the suites that share its fixtures;
- 4 full runs under different session clocks.

The reversal trigger is deterministic, and no product defect was found. The assertion is stronger, not weaker: it now
checks the exact correction set (`reason:amount:debtor_is_clearing` = `cash_collection_reversal:200000:true`) and
prints what it saw if it ever differs.

### WS4 — Historical bootstrap tests

`phase6b3_sandbox_bootstrap`, `phase6b4_edwin_sandbox_operator` and `step4c_pilot_ready` replayed one-time production
bootstraps against today's schema. They are retired and replaced by `historical_bootstraps.test.sql` (11 assertions).
The new test pins the durable contracts those bootstraps established:

- the migrations are recorded;
- Horizonte has its fixed ids and is a sandbox;
- `tenant_kind` is immutable;
- a sandbox can never be activated;
- the Demo operator role grants only `pov:enter`.

### WS5 — Private PUBLIC-EXECUTE functions

Six were audited.

- **Five trigger functions:** all client grants revoked. Triggers never need EXECUTE for the caller; it is checked only
  at `CREATE TRIGGER`.
- **`can_read_school_person`:** keeps `authenticated` only, because the `persons.person_school_read` policy calls it.
- **Guard:** the migration fails closed if any private function is still executable by `PUBLIC`. Tested in
  `permission_helper_acl`.

### WS6 — Demo PIKAS Cash

- **Cause:** the School list and the «Requiere atención» panel read `student_wallets` through the row policy, which
  evaluates the signed-in person. In a Demo POV that person is the PIKAS operator, so the list showed «Sin monedero» /
  «Todo en orden» while the summary (`school_wallet_report`, POV-aware) counted the wallets.
- **Second cause:** the per-student API refused every operation in a POV, including reads.
- **Fix:** `school_wallet_rows` (same authority as the summary). The wallet API lets a Demo POV **read**; every mutation
  still returns `demo_mode_active`.
- **Tests:**
  - pgTAP: list count equals summary count; attention list equals the summary's frozen and negative counts; no wallet
    changes.
  - Unit: API and page.

### WS7 — School Resumen

«Cafetería compartida · COMPLETO» came from `school_admin_read` (POV-aware), while each cafetería's label came from a
row-policy read, which is empty in a POV. That is how «Sin compartir todavía» appeared beside COMPLETO.

The single truthful source now works like this:

- **«Active»** comes only from the authoritative read.
- **The share rows** only tell «revocada» apart from «nunca compartida», and they are read through
  `school_sharing_rows` under the same authority.
- **States covered by tests:** never shared, active, revoked, unavailable (neutral «Sin compartición activa»), and an
  active share with an empty rows read.

### WS8 — Internal IDs

School «Ver detalle» ended with «Compra/Recarga/Revierte la recarga <uuid>». Those lines are removed: the detail
already names receipt, cafetería, reference and original reference. A browser test asserts that no UUID appears.
Platform CSVs already contained none (Reporting Consolidation).

### WS9 — Support tickets

See [SUPPORT_OPERATIONS.md](SUPPORT_OPERATIONS.md).

- **Reporter view:** «Reportar un problema» in the School and Cafetería shells (sidebar and account menu) and the POS
  header (opens in a new tab).
- **Platform view:** «Soporte» with filters (estado, categoría, búsqueda, Incluir Demo), detail, responses, internal
  notes, request info, review, resolve, close and reopen.
- **Ticket fields:**
  - from the reporter: title, description, category;
  - checked against the reporter's active memberships: customer, reporter, role, colegio and cafetería;
  - derived on the server: sede, caja (from the reporter's open session), page path (no query string), app version,
    browser user agent;
  - plus the Demo flag and timestamps.
- **Data safety:**
  - private tables reached only through functions;
  - request keys bound to the actor and payload;
  - append-only events;
  - text refused when it looks like a password or token, on both sides;
  - nothing captured automatically beyond the fields above;
  - 20 tickets per reporter per day;
  - only an active customer's staff may report or answer (0008). A suspended customer's staff use the contact channel.
- **Screenshots are deferred:** there is no private attachment storage yet, and no public file URL was improvised.
  Cross-customer access is impossible because no attachment path exists, and ticket reads are owner-only (pgTAP).

### WS10 — Sandbox history

**Decision: reset-only for the pilot.** `platform_reset_sandbox` («Restaurar escenario inicial») already does what a
compaction would:

- It needs `platform:sandbox:manage` (platform_admin only) and refuses any non-sandbox account.
- It deletes the sandbox's operational and financial rows (purchases, ledger, wallets, sessions, refunds and the like)
  and re-seeds the canonical baseline.
- It keeps the audit: POV sessions, operation links and platform audit.

An age- or count-based partial compaction would have to decide which sandbox purchases, ledger rows and wallet
balances to keep consistent with each other. That is ambiguous and risks a Demo state that does not reconcile. What
grows between resets is the audit only, which is small and must be kept.

### WS11 — Settlement scheduler

**Recommendation: A — manual Platform finance action during the pilot.**

| Criterion | Manual («Liquidar semanas cerradas») | Automatic |
|---|---|---|
| Reliability | One idempotent call; runs when finance is present | Needs a scheduler that is not in the stack today (no Vercel Cron or pg_cron configured) |
| Failure visibility | The operator sees the result or the refusal on screen | A silent failure unless alerting is built |
| Safe retry | Same request key replays | Same engine; it would need its own key per week |
| Staffing | Weekly task, a few minutes, Monday or Tuesday | — |
| Observability | Liquidaciones shows ready weeks | Needs monitoring |

Revisit after the pilot. If automation comes, the job calls `platform_finance_settlement_run` unchanged.

### WS12 — Register cash reconciliation

**Assessment; no code.**

- **What register close covers:** register close expects opening cash + cash sales + settlements − cash refunds per
  session.
- **What cash collections are:** FIN4 cash collections (`REC-`) are recorded by the Cafetería Admin and are **not tied
  to a register session**. So PIKAS cannot tell whether that cash went into a drawer.

| Can be reconciled now | Cannot |
|---|---|
| Each register session: expected vs counted, with the difference recorded | Collection cash vs a particular drawer |
| Collections per Cafetería and day (gross, fee, net) in «Recargas en efectivo» and Finanzas | Physical custody of collection cash between collection and settlement |
| Weekly settlement: collections (Cafetería → PIKAS) vs PIKAS Cash sales (PIKAS → Cafetería) | — |

**Pilot procedure:**

- Keep PIKAS Cash collections **out of the register drawer**, in a separate envelope or box.
- Each day, the Cafetería Admin counts it against the day's «Recargas en efectivo» gross.
- If collection cash ever goes into a drawer, the register close will show an overage equal to the gross. Record it
  with the close reason, never by editing the session.

A variance view would need a new link from collection to session, which changes financial semantics. **Owner
decision:** whether this must be automated before the pilot. Recommendation: no.

### WS13–WS15 — Finance role, activation, legal gate

See [FINANCIAL_ACTIVATION_RUNBOOK.md](FINANCIAL_ACTIVATION_RUNBOOK.md).

- **Finance role:**
  - dedicated `platform_finance_operator` role;
  - bundle: read + verify + reverse + settlement:manage, never `adjustments:fund`;
  - a named person, an auditable `granted_by`, removal by status change;
  - no Platform Admin inheritance.
- **Activation:** precheck, activation, postcheck, and rollback/deactivation (activation never "undoes"; financial
  history stays).
- **Gate 0:** ten legal and accounting questions, left unanswered on purpose.

### WS16 — Privacy and terms

These are drafts from the actual data architecture, with **[DECIDE]** markers. They are not published and not linked,
and they make no compliance claim.

### WS17–WS19

[Incident response](INCIDENT_RESPONSE.md), [support model](SUPPORT_OPERATIONS.md) and the
[readiness template](PILOT_READINESS_CHECKLIST.md). CEPOINT is not mutated.

### WS20 — Vercel 403 and release evidence

**Audit:**

- **The token:** the local Vercel API token returns 403 (stale or revoked). It belongs to the owner's account; it is not
  a project-reference error, because GitHub deployments for `pikas-pilot` succeed and pikas-pikas.app serves the
  expected builds.
- **Deployment URLs:** behind Vercel deployment protection.

**Accepted evidence chain (no Vercel API needed):**

1. `git rev-parse HEAD` equals `origin/Pikas_demo` after the push.
2. GitHub deployments for that SHA: `environment: Production – pikas-pilot`, `state: success`
   (`gh api repos/<repo>/deployments?sha=<sha>`, then `…/statuses`).
3. The live domain serves the new build: a route or label that exists only in the release responds at
   https://pikas-pikas.app.
4. Logged-out smoke: `/`, `/login`, `/backoffice/login` return 200, plus any protected route redirects to login.

**Recommendation:** the owner issues a new read-only Vercel token when convenient. It is not a pilot blocker, because
deployment state stays independently verifiable. Never `vercel --prod`.

## Pilot rehearsal (local, fictional; never CEPOINT)

**Script:** `rehearsal.py` (scratchpad), run against a fresh fictional customer, «Colegio Ficticio Las Palmas»
(accounts `f4f…`, people at `example.invalid`). Each action goes through the product RPCs as the right fictional
person. Activation and bank submission are the backend-only owner steps from the runbook. **Result: 72/72 checks.**

| Step | Result |
|---|---|
| 1–3 Customer, School, Cafetería | Active customer, 4 students, Las Palmas shared, operating with a staffed caja and products |
| 4–5 Caja, sharing | Register opened with RD$ 1,000.00; cash sale receipt #1, no obligation; POS search finds the 4 shared students (2+ characters by design) |
| 6 Activation | Opening liability RD$ 20,510.00 = sum of positive balances; replays by key; School «Recargar» withdrawn |
| 7 Cash collection | RD$ 1,000.00 → fee RD$ 30.00, wallet +RD$ 970.00; `cash_collection` RD$ 1,000.00 |
| 8–9 Sale, refund | RD$ 500.00 PIKAS Cash sale; refund RD$ 200.00 corrects the payable |
| 10 Bank transfer | Finance verifies RD$ 2,000.00 → +RD$ 1,940.00; no Cafetería obligation |
| 11–12 Settlement | W-1 nets Cafetería → PIKAS RD$ 700.00 (1,000 + 200 − 500); finalizes once; payment → settled; lines sum to the net |
| 13 Reporting | Ventas today: gross RD$ 550.00, refunds RD$ 200.00, net RD$ 350.00; finance report shows activation and both methods; no sandbox |
| 14 Support | Cashier ticket with caja/sede/version; info request, reply, internal note, resolve, close; reporter never sees the note |
| 15 Suspend | POS, collection, School wallet and support refused; finance still reads settlements; reactivation resumes |
| 16 Deactivation | Collection refused `FINANCIAL_POLICY_NOT_ACTIVE`; new PIKAS Cash sale creates no obligation |
| 17 Historical settlement | W-3 (RD$ 2,500.00 payout) finalized and settled after deactivation |
| 18 Historical refund | Refund of an activation-era sale corrects the payable (RD$ 100.00); a post-deactivation refund does not; W-4 nets RD$ 100.00 and settles |
| 19 Re-activation | New activation, opening = current positive balances, nothing duplicated; collection works again |
| Reconciliation | Every wallet = its ledger; every settlement = its lines; the only unsettled obligation is the deliberate open-week collection |
| 20 Cleanup | Fixture removed (orphan scan clean). Fingerprint equals the milestone start, except migrations 76 → 84 |

**Safety rehearsal (in the same run):**

- **Duplicate cash request:** replays the same `REC-`.
- **Stale retry with another amount:** `IDEMPOTENCY_CONFLICT`.
- **Wrong Cafetería:** `student_not_served_by_cafeteria`, both ways.
- **Frozen wallet:** `wallet_not_active`.
- **Demo POV cash collection:** `demo_mode_active`. The sandbox is never activated.
- **Cash reversal after spending:** `FINANCIAL_RESOLUTION_REQUIRED`. A reversal before spending offsets the collection.
- **Settlement discrepancy:** RD$ 90 against RD$ 100 goes to «En revisión». After the review is resolved, the full net
  is confirmed (no partial settlement).
- **Late week:** shows as overdue.
- **Suspended and closed customer:** POS, School and support refused; the history is preserved.
- **Wrong finance authority:** refused for School, finance (fund adjustment), Platform Admin without finance, and
  cashier.
- **Unauthorized export:** the Platform finance CSV gives 403 to a Cafetería Admin; a Cafetería CSV is not served to a
  School Admin.
- **Cross-customer ticket access:** `support_ticket_not_found`. No attachment store exists.

**Browser (staged production build, local):** `browser.mjs`, **40/40, no page errors.**

- **Demo PIKAS Cash:** 4 wallets, no «Sin monedero», the frozen wallet listed, the per-student page read-only.
- **Resumen:** consistent in Demo and real.
- **Movement detail:** no UUID.
- **Support:** «Reportar un problema» end to end (password stopped client-side, ticket in «Mis reportes», Platform
  request for information shown to the reporter).
- **Exports:** refused to the wrong roles.
- **390 px review:** no horizontal scroll and no control under 40 px on 17 views (School students and PIKAS Cash, movement
  detail, Demo POS, cash collection, transactions, Liquidaciones, reports, setup, support form and list, Platform
  Soporte and Reportes).

## Test gate (2026-10-25, final tree)

| Gate | Result |
|---|---|
| Full pgTAP, session clock UTC | 79 files, 4,491 assertions, 0 failures, 0 errors |
| Same under Pacific/Kiritimati, Etc/GMT+12, America/Santo_Domingo | Identical: 4,491 / 0 / 0 each |
| Full app tests (vitest, `--maxWorkers=4`) | 171 files, 1,851 tests passed |
| Typecheck, lint | Clean |
| Production build (staged, local env) | Passes; no production reference in the server bundle |
| Fictional rehearsal / browser acceptance | 72/72 and 40/40 |

**Runner note (explained, not a product failure).** With the default worker count on an 8-core machine, a full vitest
run can starve the Playwright-backed browser tests. The result is hook and test timeouts, in different files from run
to run, and never an assertion failure. Those files pass alone, and the whole suite passes with `--maxWorkers=4`. Run
the full suite with that flag. One genuinely slow test (three clock scenarios with reloads) now has its own 30 s
timeout.

## Owner decisions (recommendations, not assumptions)

| Decision | Recommendation |
|---|---|
| Settlement manual or automatic during the pilot | Manual (WS11) |
| Who receives production finance authority | One named person who is not the activator; bundle per runbook B0; assign only after Gate 0 |
| Pilot customer / is CEPOINT the pilot | Owner's choice. CEPOINT can be assessed with the checklist; nothing was changed |
| Legal / accounting approval | Required before any activation; Gate 0 is open |
| Public legal terms ready | No. Drafts exist for counsel |
| Register cash reconciliation automated before the pilot | No. Use the manual envelope procedure (WS12) |
| Support contact channel, hours and targets | Choose email and SEV1 phone; recommended targets in SUPPORT_OPERATIONS |
| Screenshot attachments | Defer until after the pilot |
| Vercel token | Re-issue a read-only token (not blocking) |
