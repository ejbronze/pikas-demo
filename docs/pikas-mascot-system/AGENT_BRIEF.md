# PIKAS Mascot System — Agent Brief

You are integrating the PIKAS mascot system into the PIKAS app and public website. This brief is the operating guide; `docs/PIKAS-Mascot-System-Proposal.md` is the full rationale and wins on any detail this brief leaves out.

Status: **v0.1, approved by the owner (Edwin Jaquez) for integration on Oct 22, 2026.** All 35 catalog assets and 7 animations exist as SVG.

---

## 1. Ground rules

- **Do not replace or edit the approved PIKAS logo.** The mascot is a separate layer. `brand/mascot/master/pikas-mark-master.svg` is a vector redraw for reference, not a logo replacement.
- **Do not disrupt in-flight work** (UX12, Cafetería Admin). Add mascot moments as small, separate changes; never block a feature on mascot art.
- **The product is the hero; PIKAS is the guide.** The mascot explains a state or a next step. It never decorates the middle of a task.
- **Never put the mascot in serious money or security moments:** declined payments, failed transfers, insufficient balance, suspicious activity, permission errors, data loss. Those get plain text, an icon and the action.
- **Never redraw or restyle the art in code.** Use the SVG files as delivered. If a pose is missing, ask for one; do not improvise.

## 2. What's in this package

| Path | What it is |
| --- | --- |
| `brand/mascot/manifest.json` | Every asset: id, file, set, cap on/off, prop, contexts, use, size range, motion file, Spanish alt text when meaningful, where it must never appear |
| `brand/mascot/poses/<set>/` | 36 static SVG poses in 10 folders (foundation, success, onboarding, cafeteria, pos, finance, attention, support, empty-states, demo) |
| `brand/mascot/motion/` | 7 animated SVGs: loader, blink, wave, bounce-in, success pop, session countdown, walk cycle |
| `brand/mascot/master/` | Vector logo-mark redraw, the cap on its own, a small flower icon |
| `brand/mascot/tokens/` | Palette as JSON and as CSS custom properties |
| `docs/` | The full mascot system proposal |
| `previews/` | Review sheets, the catalog page, the valley scroll prototype (open the `.html` files in a browser) |
| `reference/react/` | Reference components (not drop-in; adapt to the codebase) |
| `source/` | The Python scripts that generate every SVG from shared parts |

Suggested placement in the app repo: copy `brand/mascot/` to `public/brand/mascot/` (Next.js serves it at `/brand/mascot/...`). Check the repo's conventions first.

## 3. Character rules that affect code

- **One prop per pose.** Wallet = the PIKAS Cash account. Coin purse = today's spending money ("Para hoy"). Card = paying. Flower = what PIKAS collects (value, progress, loading).
- **Cap ("gorra PIKAS")** is on only in Onboarding, Cafetería and POS assets. The manifest's `cap` field says which. Don't mix capped and hatless assets on one screen.
- **Faces:** worried (ATT-01) and bored (ATT-02) are for session timeouts only. Bored is for student views only.
- **No thumb or finger gestures anywhere.** Approval is the check badge (SUC-01).
- **Sizes:** respect `sizePx` in the manifest. Nothing below 24 px. At 32–48 px use the head marks (FND-08 family).
- **Colors:** the warning amber in POS-03, SUP-03 and ATT badges is a placeholder (#F5A524). Swap it for the product's warning token, in the SVG or by CSS.

## 4. Where the mascot goes in the app

| Surface | Use | Assets |
| --- | --- | --- |
| Customer onboarding | Welcome, step headers, finish | FND-03, ONB-02, ONB-03, SUC-02 |
| Readiness checklists | Header; 100% state | ONB-01, SUC-03 |
| Empty lists | With a sentence saying what is empty and a create button | EMP-01 (products/menus), EMP-02 (everything else) |
| Saved / done | Small confirmation | SUC-01 (+ POP motion) |
| Search / support | No results, help centre | SUP-02, SUP-01 |
| Missing configuration | Recoverable warnings | SUP-03 |
| Cafetería Admin | Products, menus, Cajas, staff | CAF-01, CAF-02, CAF-03 |
| POS | Shift open, sale complete (1.5 s), offline | POS-01, POS-02, POS-03; head marks only, never on the product grid or cart |
| PIKAS Cash | Wallet intro, history header, top-up explainer, daily limit | FIN-04, FIN-02, FIN-03, FIN-05, FIN-01; never beside amounts |
| Session timeout | Idle check, then countdown | ATT-02 (students), ATT-01 + COUNTDOWN |
| App and screen loading | Waits over 1 s | LOAD-01 |
| Demo / sandbox | Banners, sandbox login | DEM-01 |

Full table with "never" rules: proposal section 6.

## 5. Accessibility (required)

- Mascot images are **decorative by default**: `alt=""` (or `aria-hidden="true"` on inline SVG). The heading and body text must already say what the state is.
- Use `altWhenMeaningful` from the manifest only when the picture adds information that the text doesn't (mainly on the website).
- The mascot never replaces a status word, an error message or a color.
- Every animation already stops under `prefers-reduced-motion`. Don't add JS animation that ignores it.
- Loops never run beside an active form field; one animated mascot per screen at most.
- Loader: keep a `role="status"` text ("Cargando…") present for screen readers; switch to visible text after 10 s.
- Countdown: the time left is always shown as text.

## 6. Motion

All motion is CSS inside the SVG files; no Lottie or other player is needed.

- **As `<img>`:** loops and one-shots play on their own. To replay a one-shot, reset `src`.
- **Countdown needs inline SVG** so `--countdown` (seconds left) can be set from the page. Import it as a component (e.g. SVGR in Next.js) and set `--countdown` (the seconds left, fixed once when the warning opens) and `--countdown-repeat: 1` on a wrapper, so the sand drains once and stays empty. Without those variables it loops every 8 s, which is only for previews. See `reference/react/PikasSessionCountdown.tsx`.
- Timings, uses and fallbacks: manifest `motion` entries and proposal section 8.

## 7. Public website: El valle de PIKAS

The site is one continuous scroll through a flower valley: PIKAS walks the valley collecting flowers, and at each stop a flower cluster blends into a real product screen. Proposal section 7 has the full chapter table; `previews/el-valle-de-pikas-prototype.html` is a working prototype of chapters 0–1 and shows the technique:

- a tall scroll track with one `position: sticky` 100vh stage;
- layers (sky, far hills, mid hills, path) translated at different rates from scroll progress;
- PIKAS's x position driven by scroll; the walk cycle plays while moving, then switches to a still pose;
- objects (flowers) interpolated from scene positions to elements in the product screen (list rows).

To build: chapters 2 (Families, coin purse), 3 (Cafetería, tray), 4 (POS, card tap), 5 (PIKAS Cash, wallet), 6 (pull-back over the connected valley). Use real product captures, never redrawn screens. Keep the demo disclaimer as visible text. Reduced motion = static illustrated panels. GSAP ScrollTrigger or CSS scroll-driven animations are both fine; match the repo.

## 8. Known limits of v0.1

- Art was generated from code. A human illustrator polish pass is welcome but not required to ship.
- The cap is drawn front-facing only; there is no three-quarter capped pose yet.
- Walk cycle exists only in three-quarter facing right; mirror the element (CSS `scale(-1,1)`) for leftward walks.
- The warning amber is a placeholder (section 3).

## 9. Regenerating or editing art

`source/build_poses.py` composes every pose from shared parts (head, body, arms, props). Edit a part once and every pose updates. Run from a folder containing the current SVGs:

```
pip install cairosvg pillow
python3 build_poses.py && python3 build_motion.py && python3 build_catalog.py
```

## 10. Done when

- [ ] `brand/mascot/` is served by the app, and the manifest is importable.
- [ ] A `PikasMascot` component (see `reference/react/`) renders any asset by id with decorative alt by default.
- [ ] Loader, empty states, done confirmations and session timeout use the mascot as mapped in section 4.
- [ ] No mascot appears on any screen in the "never" lists.
- [ ] Reduced motion is verified on the loader, countdown and website.
- [ ] Website chapters follow section 7, with real product captures.
