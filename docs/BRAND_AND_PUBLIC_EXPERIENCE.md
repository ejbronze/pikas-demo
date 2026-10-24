# Brand & Public Experience

Practical reference for how PIKAS presents itself: the public website, the brand voice, and the branded loading
system inside the application. Code is the source of truth for exact copy (`apps/web/components/site/content.ts`).

## Positioning

**PIKAS is a connected operating platform for the school cafeteria.** It connects school, cafetería, students,
point of sale, PIKAS Cash, operations, reporting and financial operations, while keeping clear role boundaries.

- Brand line: **La cafetería escolar, por fin conectada.** (EN: *The school cafeteria, finally connected.*)
- Core sentence: **PIKAS conecta las personas, la operación y el dinero detrás de la cafetería escolar.**
  (EN: *PIKAS connects the people, operations, and money behind the school cafeteria.*)
- Operating principle: **Platform sees the network. School sees its students. Cafetería sees its business. POS runs
  the transaction.** In Spanish on the site: *PIKAS ve la red · El colegio ve a sus estudiantes · La cafetería ve su
  negocio · El punto de venta hace la venta.* Connected never means everyone sees everything.

Do not repeat the brand line mechanically on every surface. It appears in the hero, the login panel (production
mode), metadata, the social image and the footer.

### Messaging pillars

1. **Una sola operación conectada.** School, cafetería and POS work in one system.
2. **Cada quien ve lo que necesita.** Role boundaries are a feature.
3. **Una mejor experiencia en el punto de venta.** Fast, clear selling for the school line.
4. **PIKAS Cash.** A connected student wallet, described only as far as it is released.
5. **Trazabilidad que sirve.** Access, transactions, refunds, cash closes, activity, reports.

### What PIKAS is not positioned as

Not primarily: cashless, digital lunch money, a payment app, a generic school POS, an SIS, an ERP or an inventory
suite. Avoid generic SaaS words (revolucionar, sin fricciones, empoderar, de próxima generación, todo en uno) and
vague claims («tiempo real» when it is not, «seguro» without substance).

### Released versus not yet (truthfulness rule)

Only released behavior is described as available. PIKAS Cash today: balance and history per student, top-ups
recorded by the school with a verified reference, POS purchases with receipt, spending limits visible to the
cashier, reversals and adjustments with reason and actor. Said explicitly as **not available yet**: online top-ups
by families and card/transfer payments. Never imply production availability of settlement, fee processing, bank
integration, clearing or anything scheduled for FIN4 or later. Family/student apps, NFC, offline POS, inventory and
native apps are not mentioned as products.

## Voice

Modern, warm, capable, clear; Dominican/Latino-aware without folklore; operational rather than corporate;
trustworthy without sounding like a bank. Short sentences, concrete nouns from the product (caja, cierre, recibo,
monedero, matrícula), Spanish first. Write what a person can do and what is true today.

## Visual principles

Clean + warm + operational + approachable — not a sterile fintech dashboard, not cartoon-heavy school software.

- Tokens from `apps/web/app/globals.css`: navy `--primary` for text and primary actions, teal `--accent` for
  highlights and connections, yellow `--brand-yellow` only for attention and the brand-line highlight, cream
  `--brand-cream` for warm surfaces, `--background` for tinted sections.
- Type: Nunito 900 (`--font-display`) for headings and the brand line; Inter for text.
- Rounded shapes (cards 1.1–1.25rem, pill buttons), soft navy shadows, generous spacing.
- **The product is the hero.** Real screens in a quiet app frame (three dots, no browser chrome).
- **The mascot supports, never dominates.** Website set only: FND-06 (hero), FND-09 (PIKAS Cash note), FND-03 wave
  (contact, the only animated one). Decorative alt text; never beside amounts; follow
  `docs/pikas-mascot-system/AGENT_BRIEF.md`. The approved logo is used as delivered.

## Public website (`/`)

Single page, server-rendered (static). Client code only for the mobile menu and the product story.

| Section | Anchor | Purpose |
| --- | --- | --- |
| Hero | — | Brand line, plain explanation, «Ver cómo funciona» / «Solicitar información», what PIKAS connects, real Hoy + POS screens |
| Cómo funciona | `#como-funciona` | One platform, different responsibilities; the four roles and what flows between them |
| Producto | `#producto` | Scroll story: Colegio → Cafetería → Punto de venta → Seguimiento → Control, with a sticky real screen on desktop |
| Colegios / Cafeterías | `#colegios`, `#cafeterias` | What each one controls; the school does not operate the cafetería |
| PIKAS Cash | `#pikas-cash` | What it does today and, explicitly, what it does not do yet |
| Trazabilidad | `#trazabilidad` | The history that answers questions |
| Contacto | `#contacto` | Request information (see below) |

Navigation: Producto · Cómo funciona · Colegios · Cafeterías · PIKAS Cash · Contacto, plus «Iniciar sesión» (`/login`).
The PIKAS Admin entrance (`/backoffice/login`) stays reachable only from the login page. Footer: logo, brand line,
section links, sign-in, «© 2026 PIKAS» and «Diseñado y desarrollado por Palmchat Innovations LLC.» No legal pages are
linked until they exist.

**Contact.** There is no lead backend. Setting `NEXT_PUBLIC_PIKAS_CONTACT_EMAIL` (build-time) turns the section into a
mailto action with the address shown as text. Without it, the section says to write to the existing PIKAS contact;
no form collects data with nowhere to go.

**Motion.** Scroll-driven reveals (CSS `animation-timeline: view()`, progressive enhancement) and the story's
cross-fade. No scroll-jacking or parallax. `prefers-reduced-motion` removes all animation and transitions; every
element is visible and the story swaps screens instantly.

**SEO.** Title «PIKAS | La cafetería escolar, por fin conectada», positioning description, canonical
`https://pikas-pikas.app/`, Open Graph/Twitter cards, and `app/opengraph-image.tsx` (logo + brand line + sentence on brand
colors, generated at build). Existing favicon/app icons unchanged.

## Fictional-data rule

Every product image is a real PIKAS screen captured from a **local** staged build with the fictional Colegio Horizonte
sandbox (students Luna Castillo, Mateo Ventura, Alma Robles, Bruno Peña; products and Caja demo Horizonte). Demo
persona names, the operator identity and the Demo bar are hidden before capture, and the capture fails if any of
them is visible. Never use production data, real customers (CEPOINT), real identities, internal IDs or credentials.
Images live in `apps/web/public/site/` (WebP, 1600 px desktop / 780 px phone crops) with a generated manifest
`components/site/shots.generated.ts`. The page states: «Pantallas reales de PIKAS con datos ficticios del colegio de
demostración Colegio Horizonte.»

## Branded loading system («Pikando…»)

`apps/web/components/pikas-loading.tsx`.

- **PikasLoadingScreen** (route `loading.tsx`): a softened outline of the coming screen (`frame`: `app`, `workspace`
  with the administration sidebar, `content` inside the Platform shell, `page`) under a translucent veil, with the
  LOAD-01 mascot and **Pikando…** centered in the meaningful viewport.
- **PikasBusyRegion**: content that reloads in place (Cafetería Transacciones) stays visible but softened and
  `inert`; filters outside stay usable.
- Small waits stay quiet: the indicator appears after 400 ms; after 10 s a plain sentence says the wait is longer
  than usual. `role="status"` and `aria-busy` always; screen readers hear «Pikando…» plus what is loading.
- Placement: `app/loading.tsx` (app), `app/platform/loading.tsx` (content), `app/admin/escuela/loading.tsx` and
  `app/admin/cafeteria/loading.tsx` (workspace). Small button submissions keep their local busy state; tiny refreshes
  never block the screen. The loader never masks real slowness: it only renders while Next is waiting.
- Not used on security surfaces: the session verification and expiry panel keeps its own calm text.

## Platform Clientes default

`/platform/clientes` defaults to **Estado = Activos** in the select, the URL contract and the query; «Limpiar»
returns to Activos; Suspendidos, Cerrados and an explicit **Todos** (`status=all`) are honored; search runs within the
current Estado.
