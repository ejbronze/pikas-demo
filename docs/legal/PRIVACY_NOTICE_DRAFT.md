# DRAFT — PIKAS privacy notice (for owner and legal review)

> **This is not a legal document and makes no legal claim.**
>
> - It lists what the PIKAS product actually collects and does today, as found in the code on 2026-10-25, so that legal
>   counsel can write the real notice.
> - Every **[DECIDE]** marker is a question only the owner or legal counsel can answer.
> - Do not publish it, link it or show it to customers until legal approves a final text.
> - Nothing here states compliance with any law.

## Who

- **Product:** PIKAS. **Company:** Palmchat Innovations LLC.
- **[DECIDE]** Legal entity responsible for the data, its address and the contact for privacy requests.
- **[DECIDE]** For student data: is the school the controller and PIKAS the processor? This needs a data-processing
  agreement with each school.

## What the product stores, by person

| Person | Data | Source | Why |
|---|---|---|---|
| School and Cafetería staff, POS staff | Name; username; email (optional for cashiers); role and scope; sign-in sessions (session id, start and last activity times) | The customer's administrators, PIKAS staff | Access control and audit |
| Students | First and last name; display name; student code; school, sede, grade and enrollment dates; status | The school (manual or CSV) | Identify the student at the Cafetería, school administration |
| Students: dietary restrictions | Restriction type and label (for example an allergy) with start and end dates | The school | Warn the Cafetería at the point of sale. **Health-related: [DECIDE] legal basis and consent from guardians** |
| Guardians / families | Name and relationship to the student | The school | Family access where enabled |
| Purchases | Receipt, items, amounts, tender (cash / PIKAS Cash), Cafetería, register, cashier, time | POS | Sales, refunds, reports, reconciliation |
| PIKAS Cash | Balance, every movement (replenishment, purchase, refund, adjustment, reversal) with who recorded it and when | School / Cafetería / PIKAS finance | Stored-value accounting |
| Support tickets | Category, subject, description, the page path it came from, replies, the reporter's name and role | The reporter, PIKAS staff | Answer the problem |
| Audit | Who did what, when, in which scope (including PIKAS staff acting in a Demo) | Automatic | Security and accountability |

### What the product does not do

- **Payments:** it does not process payment cards. PIKAS Cash is credited from cash or verified bank transfers.
- **Tracking:** it sets no advertising or analytics trackers. **[DECIDE]** Confirm before publishing, and recheck if
  analytics are added.
- **Hidden capture:** it does not capture screenshots, form contents, passwords or tokens in support tickets. Text
  that looks like a password or token is refused.
- **Demo data:** Demo (sandbox) data is fictional and never mixed into customer reporting.

## Where it is processed

- **Hosting:** the web application is on Vercel and the database and authentication are on Supabase.
- **[DECIDE]** The hosting regions and the subprocessors list, to be confirmed from the Vercel and Supabase account
  settings. They are not in the code.
- **[DECIDE]** Cross-border transfer basis if data leaves the Dominican Republic.

## How long

- **Financial records** (purchases, ledger, settlements, audit) are never deleted by the product.
  **[DECIDE]** The required retention period and what happens after it.
- **Deactivated people and students** are kept, with their history; the product deactivates and never erases.
  **[DECIDE]** A deletion or anonymization policy, and how it interacts with financial retention.
- **Support tickets** are kept. **[DECIDE]** A retention period.

## Access and security (facts to cite, not promises)

- **Authorization:** decided by the database for every request, by role and scope. A school sees its own students; a
  Cafetería sees only the students the school shares with it, and only the categories shared.
- **Staff access:** PIKAS staff access is limited by role. Demo sessions act only on fictional data.
- **Passwords:** handled by Supabase Auth. PIKAS staff never see them.

## People's rights

**[DECIDE]** Which rights apply (access, rectification, deletion, objection), how a request is made, who verifies
identity and the response time. For student data, requests normally go through the school.

## Changes

**[DECIDE]** How changes to the notice are communicated.
