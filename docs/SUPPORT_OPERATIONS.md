# PIKAS support operations

**For:** PIKAS staff who answer customers during the controlled pilot.
**Product:**

- Customers use «Reportar un problema» (`/soporte`).
- PIKAS staff use Plataforma · **Soporte** (`/platform/soporte`).
- Database: migration `202611240006_support_tickets.sql`.

## Who can report

| Person | Reports from | How they get there |
|---|---|---|
| Account Admin | Their customer | Shell menu · «Reportar un problema» |
| School Admin | Their school | Sidebar / account menu · «Reportar un problema» |
| Cafetería Admin | Their Cafetería | Sidebar / account menu · «Reportar un problema» |
| POS supervisor, cashier, operator | Their Cafetería | POS header · «Reportar un problema» (new tab, so a sale is never interrupted) |
| Families, students | Not yet | They contact their school; the school reports |
| PIKAS staff inside a Demo («Abrir como») | Never | The identity is the PIKAS operator; report outside the Demo as yourself |
| Staff of the sandbox (Horizonte) signed in directly | Their sandbox scope | Allowed for rehearsals; the ticket is marked **Demo** and hidden from Soporte unless «Incluir Demo» is chosen |
| Someone who cannot sign in | Not through the app | Contact channel below |

A reporter sees only their own reports. Platform staff appear to them as «Soporte PIKAS», never by name.

## Categories and statuses

**Categories:** Técnico · Acceso · Punto de venta · PIKAS Cash · Reporte / datos · Otro.

| Status | Meaning | Who moves it here |
|---|---|---|
| Recibido | New, not yet looked at | The report itself |
| En revisión | PIKAS is working on it | Reply, «Marcar en revisión», the customer answering a question, Reabrir |
| Necesitamos información | Waiting for the customer | «Pedir información» |
| Resuelto | PIKAS gave a resolution | «Resolver». If the customer answers, it returns to En revisión |
| Cerrado | Finished; no more customer answers | «Cerrar». A new problem needs a new report |

## Handling a ticket

1. Open **Soporte** («Abiertos» is the default filter) and sort out the oldest «Recibido» first.
2. Read the report and its context.
   - **Recorded by PIKAS:** customer, colegio, sede, cafetería, the caja of the reporter's open session, role, page,
     app version and browser. The context comes from the server, never from what the user typed.
   - **Access problems:** check the customer's state in Clientes.
3. Do one of the following:
   - **Responder:** visible to the customer.
   - **Nota interna:** PIKAS only. Use it for findings, links to logs, and who you asked.
   - **Pedir información:** a specific question, e.g. «¿Qué número de recibo y a qué hora?».
   - **Resolver:** say what was wrong and what changed. If money was involved, name the records (receipt, `REC-`,
     `LIQ-`).
   - **Cerrar:** after a resolution is confirmed, or for duplicates or spam (say why in a note).
   - **Reabrir:** with an internal reason.
4. Every action is idempotent. If the screen says it is unsure, use «Reintentar la misma operación»; it never
   duplicates.

**Escalate as an incident** ([INCIDENT_RESPONSE.md](INCIDENT_RESPONSE.md)) when money, personal data, access across
customers or a whole Cafetería is affected.

## What we never do

- **Never ask for passwords, codes or tokens.** The product refuses text that looks like one, from both sides. If a
  customer sends one anyway by another channel, treat it as leaked: tell them to change it.
- **Never paste personal data** that the ticket does not need. That includes dietary or health details, guardians'
  phone numbers and full rosters.
- **Never fix money with SQL.** Use refunds, reversals and settlement reviews.
- **Screenshots are not supported yet.** Ask for a description, the receipt number and the time instead. Attachments
  need private, authorized storage; that is deferred.

## Contact model (owner decision required)

The app ticket is the system of record. Every conversation about a pilot problem should end up in a ticket, including
one that started by phone or chat.

| Channel | For | Status |
|---|---|---|
| «Reportar un problema» | Anyone who can sign in | Built |
| Email | Cannot sign in; the public site «Contacto» | **Owner:** choose the address and set `NEXT_PUBLIC_PIKAS_CONTACT_EMAIL` |
| Phone / WhatsApp | SEV1 during service hours only | **Owner:** decide the number and who answers it |
| Service hours | When PIKAS answers | **Owner:** recommended: school days 6:30–16:00 America/Santo_Domingo, with a SEV1 line during service |
| Target response | First answer | **Owner:** recommended: SEV1 15 min, SEV2 2 h, SEV3 1 business day, within service hours |

When a ticket arrives by email or phone, a PIKAS staff member cannot file it as the customer: the database only
accepts reports from the customer's own account. Ask the customer to file it once they can sign in, or record it as an
internal incident note. Never create a fake ticket.

## Not built yet (candidates after the pilot)

- Email notifications when a ticket changes. Today the customer sees changes in «Mis reportes».
- Screenshots and attachments (private storage with per-ticket authorization).
- Families' reports.
- Assignment to a named agent and an SLA clock.
- Ticket search across message bodies (today: reference, subject, customer, reporter).
