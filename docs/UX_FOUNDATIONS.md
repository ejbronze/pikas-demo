# PIKAS — UX foundations (pre-Phase 5D)

**Status:** established by UX Foundation A. These rules are binding for new and changed
surfaces, including all Phase 5D reporting work. They do not resolve the wider
[UX/UI audit](UX_UI_AUDIT_PRE_PHASE_5D.md); most of its findings remain deferred.

## 1. Financial value semantics

Use the shared helper `apps/web/lib/money-semantics.ts` (`moneyText`, `moneyTone`) or
its renderer `apps/web/components/money-value.tsx` (`<MoneyValue minor intent />`).
Amounts are always integer minor units (strings); formatting stays `RD$ 25.00`.

The caller declares **intent**. A positive number is never assumed to be "good".

| Intent | Meaning | Example | Treatment |
| --- | --- | --- | --- |
| `movement` | Signed ledger change | Recarga `+RD$ 25.00`; Reversión de recarga `−RD$ 25.00` | `+` positive (green); `−` negative (red); zero neutral |
| `balance` | Current or resulting Saldo | `RD$ 25.00`; `−RD$ 25.00` | Neutral; negative balance shows `−` and red |
| `amount` | Price, total or amount without direction | `RD$ 125.00` | Always neutral |

- Meaning never depends on color alone: the sign and a contextual label ("Saldo
  después", "Recarga", "Ajuste") stay visible.
- In use on: Cafeteria Admin PIKAS Cash balances, student PIKAS Cash balance and
  movements (School/Account Admin), and the adjustment dialog's signed amounts.
- Not yet migrated (deferred, adopt when touched): POS, receipts, refunds, register
  close, Transacciones. Do not hand-roll new sign/color logic; reuse the helper.
- **Phase 5D:** totals and summaries use `amount` or `balance`; per-event rows and net
  changes use `movement`. Report differences (for example, cash over/short) need an
  explicit label in addition to the sign.

## 2. Canonical Spanish terminology

| Term | Use for |
| --- | --- |
| **PIKAS Cash** | The student wallet product. Not "monedero" or "Saldo PIKAS". |
| **Saldo** | The current wallet balance ("Saldo PIKAS Cash"). |
| **Recarga** | Adding value to PIKAS Cash. Not "reposición" or "replenishment". |
| **Reembolso** | A purchase refund. |
| **Reversión de recarga** | Reversing an incorrect recarga. |
| **Ajuste administrativo** | An exceptional manual wallet correction. |
| **Movimientos** | Wallet-level financial history. |
| **Transacciones** | Sale and payment records, where already established (for example, Cafeteria Admin "Transacciones"). |
| **Caja** | POS register operational context. |
| **Actividad** | Chronological "what happened?" view. |
| **Reportes** | Analytical "what does the data tell me?" view. |

- No internal, RPC, database or roadmap terms in the UI (role codes, `student_wallet`,
  "Auth", "Persona", "RLS", "Datos comprometidos").
- Tender label for wallet payments: "PIKAS Cash".
- Apply these terms opportunistically when a surface is touched; do not run bulk
  string replacements. Known remaining inconsistencies: POS "Saldo PIKAS" labels
  (`pos-tools.tsx`, `register-sessions.tsx`, POS dashboards) and "monedero" in POS
  refund copy. These are deferred to the POS redesign waves.

## 3. Information architecture: Actividad, Movimientos/Transacciones, Reportes

- **Actividad: "What happened?"** A chronological view of operational history: recent
  financial activity, operational events, actor/action context, and lookup of
  something that occurred. Where authority allows, it may link into legitimate
  follow-up actions (for example, the existing controlled refund workflow).
- **Movimientos / Transacciones:** used by context, not as two global categories.
  *Movimientos* is the wallet ledger history (PIKAS Cash). *Transacciones* is
  sale/payment records. Do not add duplicate top-level navigation for the same data.
- **Reportes: "What does the data tell me?"** Analytical and summarized views: totals,
  trends, reconciliation, product performance, tender mix, exports and comparisons.
- Reportes must never be the only way to find or act on a specific recent transaction.
- Phase 5D decides per role where Reportes lives. No report navigation, placeholder
  dashboards or "today" redesign exist yet; none should be added ahead of 5D.

## 4. Navigation

- Cafeteria Admin: **PIKAS Cash** (`/admin/cafeteria/escuelas?cafeteria=…`), in the
  sidebar after Transacciones and in the mobile "Más" menu. It appears only when the
  server-derived cafeteria read grants `cafeteria:wallets:read` for a customer tenant,
  the same condition that mounts the balance lookup. Authority is unchanged. Without
  it, the route stays "Escuelas conectadas" and is not listed.

## 5. Locked owner decisions for future UX work

1. **Cashier expected cash:** never show the expected closing amount before the
   cashier enters the counted cash (blind count). Operational register information
   while the register is open remains allowed.
2. **Refund discovery (future):** authorized users find a refundable sale from recent
   activity or history and enter the existing controlled refund workflow.
3. **Payment method:** never preselect Efectivo or PIKAS Cash; choosing the tender is
   an intentional action.
4. **POS-only staff (future):** users whose effective role is only Cashier/POS land
   directly in their POS workspace.
5. **Spending limits (future):** the existing backend capability gets a discoverable UI.
6. **Session return (future, security review required):** after re-authentication,
   return to a safe internal destination when possible. Never replay a financial
   submission automatically.
7. **Reporting:** Actividad and Reportes are distinct (section 3).
8. **Terminology:** PIKAS Cash and Recarga are canonical (section 2).
