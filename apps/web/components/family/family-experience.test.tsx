import React from "react";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
(globalThis as { React?: typeof React }).React = React;
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh() {} }), usePathname: () => "/familias" }));
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));
import { guardianOverviewSchema, studentActivitySchema } from "../../lib/family/contracts";
import { guardianScenario, guardianScenarios, studentScenario, studentScenarios, type GuardianScenario, type StudentScenario } from "../../lib/family/demo-scenarios";
import { activitySpoken, activityTitle, childMarkers, remainingToday } from "../../lib/family/presentation";
import { GuardianActivity, GuardianHome, GuardianProfileView } from "./guardian-pages";
import { StudentHome, StudentProfileView, StudentPurchases } from "./student-experience";

const g = (s: GuardianScenario) => { const v = guardianScenario(s); return v ? { kind: "ready" as const, value: v } : { kind: "unavailable" as const }; };
const st = (s: StudentScenario) => { const v = studentScenario(s); return v ? { kind: "ready" as const, value: v } : { kind: "unavailable" as const }; };
const text = (node: React.ReactElement) => renderToStaticMarkup(node).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const html = (node: React.ReactElement) => renderToStaticMarkup(node);

describe("family-safe contracts and demo scenarios", () => {
  it("every scenario satisfies the strict contracts (no extra fields)", () => {
    for (const s of Object.keys(guardianScenarios) as GuardianScenario[]) { const v = guardianScenario(s); if (v) expect(guardianOverviewSchema.parse(v)).toEqual(v); }
    for (const s of Object.keys(studentScenarios) as StudentScenario[]) { const v = studentScenario(s); if (v) expect(studentActivitySchema.parse(v)).toEqual(v); }
  });
  it("contracts reject staff/internal fields", () => {
    const v = studentScenario("normal")!;
    expect(studentActivitySchema.safeParse({ ...v, student: { ...v.student, person_id: "x" } }).success).toBe(false);
    expect(studentActivitySchema.safeParse({ ...v, purchases: [{ ...v.purchases[0], operator_name: "Cajera" }] }).success).toBe(false);
    expect(studentActivitySchema.safeParse({ ...v, activity: [{ ...v.activity[0], request_id: "k", actor: "Admin" }] }).success).toBe(false);
    const serialized = JSON.stringify([guardianScenario("varios"), studentScenario("normal")]);
    for (const k of ["operator", "cashier", "actor", "request_id", "journal", "ledger", "auth_user", "person_id"]) expect(serialized).not.toContain(k);
  });
  it("movement labels and spoken direction never rely on a sign", () => {
    const a = studentScenario("normal")!.activity;
    expect(a.map(activityTitle)).toEqual(["Compra en Cafetería Norte", "Reembolso de compra #1017", "Compra en Cafetería Norte", "Reembolso de compra #1003", "Compra en Cafetería Norte", "Recarga de PIKAS Cash", "Corrección de saldo"]);
    expect(activitySpoken(a[5], "el")).toBe("Recarga de PIKAS Cash, aumentó el saldo en RD$ 2,000.00. Saldo después: RD$ 2,205.00.");
    expect(activitySpoken(a[0], "tu")).toContain("disminuyó tu saldo en RD$ 185.00");
    expect(activityTitle({ ...a[5], type: "replenishment_reversal" })).toBe("Recarga revertida");
  });
  it("markers and today's remaining amount come from the read, never from guesses", () => {
    const [mateo, sofia, lucas, valentina, camila] = guardianScenario("varios")!.children.map(c => c.student);
    expect(childMarkers(mateo)).toEqual([]); expect(remainingToday(mateo)).toBe("11500");
    expect(childMarkers(sofia).map(m => m.label)).toEqual(["Alcanzó el límite de hoy"]); expect(remainingToday(sofia)).toBe("0");
    expect(childMarkers(lucas).map(m => m.label)).toEqual(["Sin PIKAS Cash todavía"]); expect(remainingToday(lucas)).toBeNull();
    expect(childMarkers(valentina).map(m => m.label)).toEqual(["PIKAS Cash pausado"]);
    expect(childMarkers(camila).map(m => m.label)).toEqual(["No disponible"]);
  });
});

describe("Parent presentation", () => {
  it("home: one card per child, no combined family balance, no Recargar, distinct wallet states", () => {
    const t = text(<GuardianHome read={g("varios")} scenario="varios" />);
    expect(t).not.toMatch(/combinad|Saldo familiar|Recarg(ar|a demo)|Preorden|Pedidos|Añadir|Archivar/i);
    for (const n of ["Mateo Alejandro Rodríguez Peña de los Santos", "Sofía Rosario", "Lucas Rosario", "Valentina Rosario", "Camila Rosario"]) expect(t).toContain(n);
    expect(t).toContain("Saldo PIKAS Cash de Mateo Alejandro Rodríguez Peña de los Santos: RD$ 1,940.00");
    expect(t).toContain("Saldo PIKAS Cash de Sofía Rosario: RD$ 0.00");
    expect(t).toContain("Aún no tiene PIKAS Cash"); expect(t).toContain("PIKAS Cash pausado"); expect(t).toContain("Alcanzó el límite de hoy");
    expect(t).toContain("Este estudiante no está disponible en este momento.");
    expect((html(<GuardianHome read={g("varios")} scenario="varios" />).match(/<h1/g) ?? []).length).toBe(1);
  });
  it("one child and no children", () => {
    expect(text(<GuardianHome read={g("uno")} scenario="uno" />)).toContain("Tu estudiante");
    expect(text(<GuardianHome read={g("sin-estudiantes")} scenario="sin-estudiantes" />)).toContain("Tu escuela aún no vinculó estudiantes a tu cuenta.");
  });
  it("a load failure is an error state, never RD$0.00", () => {
    const t = text(<GuardianHome read={g("error")} scenario="error" />);
    expect(t).toContain("No pudimos cargar la información de tus estudiantes."); expect(t).not.toContain("RD$");
  });
  it("activity: the URL only selects among the guardian's children; an unknown id reveals nothing", () => {
    const t = text(<GuardianActivity read={g("varios")} scenario="varios" studentParam="00000000-0000-0000-0000-000000000099" />);
    expect(t).toContain("No encontramos ese estudiante en tu cuenta."); expect(t).not.toContain("RD$");
    const inactive = text(<GuardianActivity read={g("varios")} scenario="varios" studentParam="d-s-camila" />);
    expect(inactive).toContain("No encontramos ese estudiante en tu cuenta.");
  });
  it("child summary: switcher marks the selected child; controls are read-only and school-managed", () => {
    const h = html(<GuardianActivity read={g("varios")} scenario="varios" studentParam="d-s-sofia" />);
    expect(h).toMatch(/aria-current="true"[^>]*>.*Sofía.*\(seleccionado\)/);
    const controls = h.slice(h.indexOf("Configuración del estudiante"));
    expect(controls).toContain("Administrada por la escuela.");
    expect(controls.slice(0, controls.indexOf("</section>"))).not.toMatch(/<(button|input|select|textarea)/);
  });
  it("purchases: Compras terminology, refunds, and cash does not touch PIKAS Cash", () => {
    const t = text(<GuardianActivity read={g("varios")} scenario="varios" studentParam="d-s-mateo" viewParam="compras" />);
    expect(t).toContain("Compra en Cafetería Norte"); expect(t).toContain("Recibo #1048");
    expect(t).toContain("Reembolsada · RD$ 60.00 devuelto"); expect(t).toContain("Reembolso parcial · RD$ 80.00 devuelto"); expect(t).toContain("(1 reembolsado)");
    expect(t).toContain("Pagada con Efectivo"); expect(t).toContain("Pagada en efectivo: su saldo PIKAS Cash no cambió.");
    expect(t).not.toMatch(/Pedido|Preorden/);
  });
  it("PIKAS Cash activity uses plain labels, balance after and spoken direction; no-wallet stays distinct from RD$0", () => {
    const t = text(<GuardianActivity read={g("varios")} scenario="varios" studentParam="d-s-mateo" viewParam="saldo" />);
    expect(t).toContain("Recarga de PIKAS Cash"); expect(t).toContain("Corrección de saldo"); expect(t).toContain("Saldo después: RD$ 1,940.00");
    expect(t).toContain("aumentó el saldo en RD$ 80.00");
    expect(t).not.toMatch(/ledger|débito|crédito|liquidaci|journal/i);
    expect(text(<GuardianActivity read={g("varios")} scenario="varios" studentParam="d-s-lucas" viewParam="saldo" />)).toContain("Aún no tiene PIKAS Cash.");
    expect(text(<GuardianActivity read={g("varios")} scenario="varios" studentParam="d-s-sofia" />)).toContain("RD$ 0.00");
  });
  it("profile is read-only", () => {
    const h = html(<GuardianProfileView read={g("varios")} scenario="varios" />);
    expect(h).toContain("ana.rosario"); expect(h).toContain("Para cambiar estos datos, comunícate con tu escuela.");
    expect(h.slice(h.indexOf("guardian-data"))).not.toMatch(/<(button|input|textarea)/);
  });
});

describe("Student presentation", () => {
  it("home: balance first, today's spending with a limit, latest purchase, no demo concepts", () => {
    const t = text(<StudentHome read={st("normal")} scenario="normal" />);
    expect(t).toContain("Tu saldo PIKAS Cash"); expect(t).toContain("Saldo PIKAS Cash de Mateo Alejandro Rodríguez Peña de los Santos: RD$ 1,940.00");
    expect(t).toContain("Hoy gastaste RD$ 185.00"); expect(t).toContain("Te queda hoy RD$ 115.00"); expect(t).toContain("Tu última compra");
    expect(t).not.toMatch(/QR|Mi plan|Menú|Pedidos|Preorden/);
  });
  it("edge states", () => {
    expect(text(<StudentHome read={st("sin-saldo")} scenario="sin-saldo" />)).toContain("Aún no tienes PIKAS Cash Tu familia o escuela puede recargarlo.");
    expect(text(<StudentHome read={st("cero")} scenario="cero" />)).toContain("RD$ 0.00");
    expect(text(<StudentHome read={st("pausado")} scenario="pausado" />)).toContain("Tu PIKAS Cash está pausado.");
    expect(text(<StudentHome read={st("inactivo")} scenario="inactivo" />)).toContain("Tu cuenta escolar no está activa.");
    expect(text(<StudentHome read={st("sin-cafeteria")} scenario="sin-cafeteria" />)).toContain("Tu escuela aún no habilitó compras en la cafetería.");
    expect(text(<StudentPurchases read={st("sin-saldo")} scenario="sin-saldo" />)).toContain("Todavía no hay compras.");
    const err = text(<StudentHome read={st("error")} scenario="error" />); expect(err).toContain("No pudimos cargar tu información."); expect(err).not.toContain("RD$");
  });
  it("purchases and PIKAS Cash views; profile read-only", () => {
    expect(text(<StudentPurchases read={st("normal")} scenario="normal" />)).toContain("Pagada en efectivo: tu saldo PIKAS Cash no cambió.");
    expect(text(<StudentPurchases read={st("normal")} scenario="normal" viewParam="saldo" />)).toContain("disminuyó tu saldo en RD$ 185.00");
    const h = html(<StudentProfileView read={st("normal")} scenario="normal" />);
    expect(h).toContain("Tu escuela administra estos datos."); expect(h).toContain("Alergia: Maní"); expect(h).toContain("RD$ 300.00");
    expect(h.slice(h.indexOf("student-data"))).not.toMatch(/<(button|input|textarea)/);
  });
});

describe("navigation and removed demo concepts", () => {
  it("shell destinations are exactly Inicio/Actividad/Perfil and Inicio/Compras/Perfil", () => {
    const src = readFileSync(resolve("components/app-shell.tsx"), "utf8");
    expect([...src.matchAll(/href: "(\/familias[^"]*)", label: "([^"]+)"/g)].map(m => `${m[1]} ${m[2]}`)).toEqual(["/familias Inicio", "/familias/actividad Actividad", "/familias/perfil Perfil"]);
    expect([...src.matchAll(/href: "(\/estudiante[^"]*)", label: "([^"]+)"/g)].map(m => `${m[1]} ${m[2]}`)).toEqual(["/estudiante Inicio", "/estudiante/compras Compras", "/estudiante/perfil Perfil"]);
  });
  it("old demo routes are gone and family/student surfaces use no native dialogs", () => {
    const files = (dir: string): string[] => readdirSync(dir).flatMap(f => { const p = join(dir, f); return statSync(p).isDirectory() ? files(p) : [p]; });
    const routes = [...files(resolve("app/familias")), ...files(resolve("app/estudiante"))].map(f => f.replace(resolve("app"), "")).sort();
    expect(routes).toEqual(["/estudiante/compras/page.tsx", "/estudiante/layout.tsx", "/estudiante/page.tsx", "/estudiante/perfil/page.tsx", "/familias/actividad/page.tsx", "/familias/layout.tsx", "/familias/page.tsx", "/familias/perfil/page.tsx"]);
    for (const f of [...files(resolve("components/family")).filter(f => !f.endsWith(".test.tsx")), resolve("components/app-shell.tsx")]) expect(readFileSync(f, "utf8")).not.toMatch(/\b(confirm|alert)\(/);
  });
});
