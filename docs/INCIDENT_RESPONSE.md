# PIKAS incident response

**For:** the owner and whoever is on call for PIKAS during the controlled pilot.
**Production:**

- Vercel project `pikas-pilot` (branch `Pikas_demo`, domain https://pikas-pikas.app).
- Supabase production project (ref and credentials live only in the owner's password manager and dashboards).

## Rules that hold during every incident

1. **Never delete or rewrite financial history.** Purchases, ledger entries, obligations, settlements, receipts and
   audit are immutable. Corrections are new records: reversals, refunds, reviews.
2. **Retry an uncertain mutation only with its original request key and payload.** A failed retry does not prove the
   original write failed. Check the record first: receipt, `REC-` reference, settlement or ticket.
3. **No production SQL, migration, configuration change, push or deploy without the owner's explicit approval** for
   that action. Never `vercel --prod`.
4. **Never copy production data to a laptop or a local database.** Investigate in production with read-only queries
   the owner approves, or reproduce with fictional local fixtures.
5. **Contain first, explain later.** Use the narrowest control that stops the harm (table below).
6. **Write it down as you go:** times in America/Santo_Domingo, what you saw, what you did, who approved it.

## Severity

| Level | Meaning | Examples | Response |
|---|---|---|---|
| **SEV1** | Money, data or access is wrong or exposed, or the pilot cannot operate | Wrong balances or settlements; one customer sees another's data; site down during service hours; leaked secret | Owner engaged immediately; contain within 15 min; customer told the same day |
| **SEV2** | A core flow is broken for some users, with a workaround | One Cafetería cannot sell; logins failing for one school; reports wrong but money correct | Owner engaged within 1 h; fix or workaround the same day |
| **SEV3** | Degraded or cosmetic | Slow pages; a label is wrong; one export fails | Ticket in Soporte; next planned release |

## First 15 minutes

1. **Acknowledge.** Open or update the Soporte ticket (`SOP-…`), or start an incident note if no ticket exists.
2. **Scope it.**
   - Which customer, school, Cafetería, register and users are affected, and since when?
   - Is money involved? Is personal data involved?
3. **Decide the severity** (table above). If unsure, treat it as the higher level.
4. **Contain** with the narrowest control below.
5. **Tell the affected customer** what is happening and what to do meanwhile (templates below).

## Containment controls

| Control | Who | Where | Effect | Reversible |
|---|---|---|---|---|
| Suspend a customer | Platform Admin (`platform:tenant:lifecycle:manage`) | Plataforma · Clientes · customer · Suspender | All tenant access blocked; data preserved | Yes, Reactivar |
| Suspend a person's sign-in | Platform Admin (`platform:identity:support`) | Plataforma · Identidades | Login refused (Auth ban plus login suspension) | Yes |
| Disable a POS cashier | Cafetería Admin | Cafetería · Personal POS · change status | Cashier cannot open a register | Yes |
| End financial activation | Owner (backend) | [Financial activation runbook](FINANCIAL_ACTIVATION_RUNBOOK.md#part-d--rollback-and-deactivation) | New fee-era activity stops; existing obligations still settle | Re-activation is a new activation |
| Put a settlement in review | Finance operator | Finanzas · Liquidaciones · «Poner en revisión» | Payment confirmation paused; totals unchanged | Yes, «Resolver revisión» |
| Reverse a replenishment or collection | Finance operator | Finanzas · reference · Revertir | Correcting records; original preserved | No; it is a new record |
| Roll back the app | Owner | Vercel dashboard · pikas-pilot · Deployments · previous production deployment · Instant Rollback | Serves the previous build | Yes |
| Database | Owner | Forward-fix migration only. A point-in-time restore is the last resort and loses every write since the restore point | — | — |
| Restore the Demo | Platform Admin | Demo Lab · Restaurar escenario inicial | Sandbox only; real customers are never touched | — |

## Playbooks

### Site down or errors (5xx)

1. Check https://pikas-pikas.app, the Vercel deployment status and the Supabase status page.
2. **If a deploy happened in the last hours:** the owner rolls back (Instant Rollback) to the last good deployment,
   then you confirm login, POS and School load.
3. **If Supabase is degraded:** POS and admin pages fail closed (no partial sales). Tell Cafeterías to take sales by
   their manual fallback and register them only once service returns (each as a normal sale; never back-dated by
   SQL).
4. Post-incident: compare the build served with the expected commit (see [Release evidence](PILOT_HARDENING.md#ws20--vercel-403-and-release-evidence)).

### Login failures

1. Is it one person, one customer or everyone?
   - One person: Identidades (account status, suspension, recent password reset).
   - One customer: customer lifecycle (suspended?).
   - Everyone: Supabase Auth status.
2. Never ask for, receive or type a user's password. Use the password-reset flow.

### POS cannot sell, or a register is stuck

1. Confirm the register session state in Cafetería · Cajas y cierres.
2. **A closed session never reopens and never accepts sales** (by design). Open a new session on the register.
3. **A sale with an uncertain result:** the POS keeps the original request. Retry it from the same POS and check
   that the receipt appears before charging again.
4. Phase 5A follow-up: re-verify closed-register POS rejection during the first supervised pilot session with valid
   credentials. Never reopen or mutate BETA-01 for this.

### Wrong balance or money discrepancy (SEV1)

1. **Stop the flow, not the history.** If it may repeat, end financial activation for that customer, or put the
   affected settlement in review.
2. Identify the exact records: student, receipt numbers, `REC-` references, settlement `LIQ-` references.
3. Compare the wallet's ledger (School · PIKAS Cash · student · movements) with what the customer reports.
4. Correct only with product actions: refund, reversal or review. Never `UPDATE` a balance.
5. If a product defect is suspected, reproduce it locally with fictional fixtures before any fix.

### Suspected data exposure or unauthorized access (SEV1)

1. Contain:
   - suspend the person's sign-in;
   - suspend the customer if the exposure is ongoing;
   - if a secret may be exposed, the owner rotates it (Supabase keys, Vercel tokens, SMTP).
2. Preserve evidence: Platform audit (`platform:audit:read`), application sessions, Vercel and Supabase logs. Do not
   export personal data to personal devices.
3. The owner and legal decide on notification to the customer and any authority. Record who decided and when.

### A secret leaked (key, token, password in a chat, ticket or commit)

1. Rotate it first (owner), then remove where it appeared. Soporte refuses tickets that look like passwords or tokens,
   but treat any appearance as a leak.
2. A secret in git history requires rotation; deleting the commit is not enough.

## Customer messages (Spanish)

**Investigating**

> Estamos revisando un problema que afecta a {qué}. Mientras tanto, {qué hacer}. Te escribiremos de nuevo antes de las
> {hora}.

**Resolved**

> El problema con {qué} quedó resuelto a las {hora}. {Qué pasó, en una frase}. {Si aplica: «No se perdió ninguna venta
> ni movimiento de PIKAS Cash.»} Gracias por avisarnos.

Write the money sentence only when it is verified.

## After the incident

Within two business days, record:

- the timeline;
- the root cause;
- what contained it;
- the customer impact (users, sales, money);
- the follow-ups, each with an owner.

Link the Soporte ticket, then close it with the resolution.
