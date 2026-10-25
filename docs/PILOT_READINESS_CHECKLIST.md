# PIKAS pilot readiness checklist

**Use:** copy this template once per pilot customer, fill it in, and keep it with the pilot record. It is a template:
it describes no real customer and changes nothing.

- **CEPOINT** is a real customer and is financially inactive. Filling this checklist for CEPOINT is a reading
  exercise; it never authorizes activating, restructuring or mutating CEPOINT.
- **Horizonte** is the sandbox. Use it for every rehearsal.

Customer: ____________ · Pilot start (America/Santo_Domingo): ____________ · Owner sign-off: ____________

## 1. Platform and release

| # | Item | Evidence | ✓ |
|---|---|---|---|
| 1.1 | Production app commit equals the approved release commit | GitHub deployment status, plus the build served at pikas-pikas.app (see [release evidence](PILOT_HARDENING.md#ws20--vercel-403-and-release-evidence)) | |
| 1.2 | Production migrations equal the repository chain (count and last version) | Read-only `supabase_migrations.schema_migrations` query, owner-approved | |
| 1.3 | No finance role, member, activation, entry, obligation or settlement exists unless the owner approved it | Read-only fingerprint | |
| 1.4 | Demo (Horizonte) restored to its initial scenario before the pilot | Demo Lab | |
| 1.5 | Support: «Soporte» visible to the staff who answer; contact channel published | [SUPPORT_OPERATIONS.md](SUPPORT_OPERATIONS.md) | |
| 1.6 | Incident on-call named for pilot hours | [INCIDENT_RESPONSE.md](INCIDENT_RESPONSE.md) | |
| 1.7 | Backups / point-in-time recovery confirmed in Supabase | Dashboard | |

## 2. Customer structure (Platform · Clientes · customer)

| # | Item | ✓ |
|---|---|---|
| 2.1 | Customer is `active`, and its name and code are correct | |
| 2.2 | Colegio(s) and sede(s) active, with business time zone America/Santo_Domingo | |
| 2.3 | Cafetería(s) active in an active sede («Cafetería en operación») | |
| 2.4 | Account or School Admin activated their access (not just invited) | |
| 2.5 | Cafetería Admin activated | |
| 2.6 | Cajas created; every caja that will sell has active POS staff assigned | |
| 2.7 | Products available; turnos enabled if the Cafetería uses them | |
| 2.8 | Platform Reportes · Red y adopción shows each Cafetería «Lista para operar» | |

## 3. School readiness (School · Resumen)

| # | Item | ✓ |
|---|---|---|
| 3.1 | Students loaded (CSV or one by one) and active; enrollment dates are the school's dates | |
| 3.2 | The school shares with each Cafetería with «Identificación básica»; Resumen shows «Cafetería compartida · COMPLETO» and «Compartición activa» | |
| 3.3 | Students enabled at each Cafetería («Estudiantes habilitados») | |
| 3.4 | Dietary restrictions entered only where the school has the guardians' authorization | |
| 3.5 | PIKAS Cash: if used before financial activation, the School knows that «Recargar» is the pre-activation model | |

## 4. First-day rehearsal (in Horizonte first, then supervised with the customer)

| # | Step | Expected | ✓ |
|---|---|---|---|
| 4.1 | Cashier signs in on the POS device | Lands on Caja; no admin destinations | |
| 4.2 | Open a register session | One open session per register and operator | |
| 4.3 | Cash sale, PIKAS Cash sale, mixed tender | Receipts with numbers; balances move once | |
| 4.4 | Uncertain network on a sale | Retry replays the same sale; no duplicate | |
| 4.5 | Refund (partial) | Refund linked to the receipt; wallet credited if paid with PIKAS Cash | |
| 4.6 | Close the register with a count | Expected vs counted; the difference is recorded | |
| 4.7 | Closed session | Cannot reopen or sell (Phase 5A follow-up: verify in the supervised session) | |
| 4.8 | Cafetería reports for the day | Ventas, Métodos de pago, Cajas y cierres agree with the receipts | |
| 4.9 | School PIKAS Cash | List, attention panel and summary agree | |
| 4.10 | «Reportar un problema» from School, Cafetería and POS | Ticket reaches Platform Soporte; reply visible to the reporter | |

## 5. Gate 0 — legal and accounting

Required **only before financial activation**: the pilot can run without it while the customer is not activated. These
are questions, not answers. The owner records each answer, its source and its date. The details are in the
[financial activation runbook, Part A](FINANCIAL_ACTIVATION_RUNBOOK.md#part-a--gate-0-legal-and-accounting).

| # | Question | Answer · source · date |
|---|---|---|
| 5.1 | Custody of stored value: entity, account, segregation | |
| 5.2 | Licence or registration for prepaid balances (Dominican Republic) | |
| 5.3 | Fee invoicing and tax (ITBIS, NCF) | |
| 5.4 | Cafetería as collection agent: contract clause | |
| 5.5 | Settlement terms, late payment | |
| 5.6 | Unused-balance and refund policy | |
| 5.7 | Retention periods for financial and personal data | |
| 5.8 | Bank accounts and who confirms payments | |
| 5.9 | Bank reconciliation owner and frequency | |
| 5.10 | Customer contract covers fee, custody, settlement and data processing | |

## 6. Privacy and terms (owner and legal)

| # | Item | ✓ |
|---|---|---|
| 6.1 | Privacy notice reviewed by legal from [the draft](legal/PRIVACY_NOTICE_DRAFT.md), approved and published | |
| 6.2 | Terms of service reviewed by legal from [the draft](legal/TERMS_OF_SERVICE_DRAFT.md), approved and published | |
| 6.3 | Data processing terms agreed with the school (the school is responsible for its students' data) | |
| 6.4 | Guardians informed as the school's agreement requires | |

## 7. Go / no-go

| Decision | Who | Date |
|---|---|---|
| Pilot may start without financial activation | Owner | |
| Financial activation may be scheduled (sections 1–6 complete, plus runbook Part C prechecks) | Owner | |
