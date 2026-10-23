import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ require: vi.fn(), read: vi.fn(), redirect: vi.fn() }));
vi.mock("@/lib/platform/customer-console", () => ({ requirePlatform: mocks.require, readPlatform: mocks.read }));
vi.mock("@/components/brand-logo", () => ({ BrandLogo: () => null }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh() {} }), usePathname: () => "/platform/clientes", redirect: mocks.redirect }));
(globalThis as { React?: typeof React }).React = React;
import PlatformLayout from "./layout";
import PlatformHomePage from "./page";
import DemoConflictPage from "./demostracion/salir/page";
import { DemoEnvironmentBar } from "../../components/demo-environment-bar";
import { ConnectedSchoolShell } from "../../components/connected-school-shell";
import { ConnectedCafeteriaShell } from "../../components/connected-cafeteria-shell";
import { cafeteriaRead, id } from "../../lib/cafeteria/test-fixtures";

const caps = ["platform:tenant:lifecycle:read", "platform:team:manage", "platform:identity:support", "platform:finance:read", "platform:sandbox:pov:enter"];
const demo = { sessionId: "5c300000-0000-4000-8000-000000000001", povCode: "cafeteria_admin" as const, accountId: id, schoolId: id, cafeteriaId: id, accountName: "Colegio Horizonte", cafeteriaName: "Cafetería Escolar", personaName: "Marta Demo", expiresAt: "2030-01-01T00:00:00Z" };
const session = (d: typeof demo | null) => ({ identity: { person: { id, displayName: "Operadora ficticia" } }, supabase: {}, capabilities: caps, demo: d });
const navHrefs = (html: string) => [...(html.match(/<nav class="mt-6[^>]*>([\s\S]*?)<\/nav>/)?.[1] ?? "").matchAll(/href="([^"]+)"/g)].map(x => x[1]);
class Redirected extends Error { constructor(public to: string) { super("NEXT_REDIRECT"); } }
beforeEach(() => { vi.clearAllMocks(); mocks.require.mockResolvedValue(session(null)); mocks.read.mockResolvedValue({ kind: "ready", value: [] }); mocks.redirect.mockImplementation((to: string) => { throw new Redirected(to); }); });

describe("6–11. Platform shell modes", () => {
  it("6. normal mode keeps the capability-driven navigation and no Demo chrome", async () => {
    const html = renderToStaticMarkup(await PlatformLayout({ children: "x" }));
    expect(navHrefs(html)).toEqual(["/platform", "/platform/clientes", "/platform/equipo", "/platform/finanzas", "/platform/identidades", "/platform/demostracion"]);
    expect(html).not.toContain("Demo activo"); expect(html).not.toContain("Entorno Demo"); expect(html).toContain("Plataforma PIKAS");
  });
  it("7–11. Demo mode: real destinations leave the navigation; the indicator, persona and global exit appear", async () => {
    mocks.require.mockResolvedValue(session(demo));
    const html = renderToStaticMarkup(await PlatformLayout({ children: "x" }));
    expect(mocks.require).toHaveBeenCalledWith({ demo: "allow" });
    expect(navHrefs(html)).toEqual(["/platform/demostracion"]);
    for (const absent of ["/platform/clientes", "/platform/equipo", "/platform/identidades", "/platform/finanzas", 'href="/platform"']) expect(html).not.toContain(absent);
    for (const present of ["Demo activo", "Demo Lab", "Administrador de cafetería", "· Administrador de cafetería · Marta Demo · Colegio Horizonte", "Colegio Horizonte", "Salir del Demo", 'aria-label="Entorno Demo"', "Operador de PIKAS · Demo"]) expect(html).toContain(present);
    expect(html).toContain("Cerrar sesión");
  });
  it("the Platform home redirects to the Demo workspace while Demo is active, and stays the cockpit otherwise", async () => {
    mocks.require.mockResolvedValue(session(demo));
    await expect(PlatformHomePage()).rejects.toMatchObject({ to: "/platform/demostracion" });
    mocks.require.mockResolvedValue(session(null));
    expect(renderToStaticMarkup(await PlatformHomePage())).toContain("PIKAS Admin");
  });
});

describe("12–14, 21–22. Demo conflict screen", () => {
  const open = (next?: string) => DemoConflictPage({ searchParams: Promise.resolve(next === undefined ? {} : { next }) });
  it("explains the mode and offers exit-and-continue to the validated route, or returning to the Demo", async () => {
    mocks.require.mockResolvedValue(session(demo));
    const html = renderToStaticMarkup(await open("/platform/clientes/" + id + "/gestion/cafeterias/" + id + "?seccion=cajas"));
    expect(html).toMatch(/<h1[^>]*>Estás en modo Demo<\/h1>/); expect(html).toContain("Sal del Demo para trabajar con clientes reales.");
    expect(html).toContain("Salir del Demo y continuar"); expect(html).toContain('href="/platform/demostracion"'); expect(html).toContain("Volver al Demo");
    expect(html).toContain("Demo activo · Administrador de cafetería · Colegio Horizonte"); expect(html).not.toContain("No encontramos");
  });
  it("22. an unsafe next target never reaches the exit button", async () => {
    mocks.require.mockResolvedValue(session(demo));
    const html = renderToStaticMarkup(await open("https://evil.invalid/platform"));
    expect(html).not.toContain("evil.invalid"); expect(html).toContain("Salir del Demo y continuar");
  });
  it("without a current Demo there is no conflict: continue at once to the validated route", async () => {
    await expect(open("/platform/finanzas")).rejects.toMatchObject({ to: "/platform/finanzas" });
    await expect(open("//evil.invalid")).rejects.toMatchObject({ to: "/platform" });
  });
});

describe("23–26. Demo indicator inside tenant experiences", () => {
  const pov = { session_id: "5c300000-0000-4000-8000-000000000001", pov_code: "school_admin" as const, operator_person_id: id, operator_name: "Edwin Ficticio", expires_at: "2030-01-01T00:00:00Z" };
  const school = { school_id: id, account_id: id, school_name: "Escuela Ficticia", account_name: "Cuenta Ficticia", tenant_kind: "sandbox" as const };
  it("the shared bar states the mode in text, names the experience and exits globally", () => {
    const html = renderToStaticMarkup(<DemoEnvironmentBar pov={{ session_id: pov.session_id, pov_code: "cashier" }} context="José Ramírez" />);
    expect(html).toContain("Demo activo"); expect(html).toContain('role="status"'); expect(html).toContain("· Cajero · José Ramírez"); expect(html).toContain("Salir del Demo"); expect(html).toContain("Cambiar experiencia");
  });
  it("23. Demo School shell shows the indicator and exit, never logout", () => {
    const html = renderToStaticMarkup(<ConnectedSchoolShell schoolId={id} context={{ person_id: id, display_name: "Operador", pov, schools: [school] }}>x</ConnectedSchoolShell>);
    expect(html).toContain("Demo activo"); expect(html).toContain("Salir del Demo"); expect(html).toContain("Datos ficticios"); expect(html).not.toContain("Cerrar sesión");
  });
  it("24. Demo Cafetería shell shows the indicator and exit", () => {
    const data = cafeteriaRead();
    const html = renderToStaticMarkup(<ConnectedCafeteriaShell cafeteriaId={id} context={{ person_id: id, display_name: "Operador", pov: { ...pov, pov_code: "cafeteria_admin" }, cafeterias: [data.scope] }}>x</ConnectedCafeteriaShell>);
    expect(html).toContain("Demo activo"); expect(html).toContain("· Administrador de cafetería"); expect(html).toContain("Salir del Demo"); expect(html).not.toContain("Cerrar sesión");
  });
  it("26. a real tenant experience shows no Demo indicator", () => {
    const html = renderToStaticMarkup(<ConnectedSchoolShell schoolId={id} context={{ person_id: id, display_name: "Directora", schools: [{ ...school, tenant_kind: "customer" }] }}>x</ConnectedSchoolShell>);
    expect(html).not.toContain("Demo activo"); expect(html).not.toContain("Entorno Demo"); expect(html).toContain("Cerrar sesión");
  });
});
