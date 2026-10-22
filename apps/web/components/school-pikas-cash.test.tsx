import React from "react";
import { describe, expect, it, vi } from "vitest";
vi.mock("next/image", () => ({ default: (p: { alt: string }) => React.createElement("img", { alt: p.alt }) }));
(globalThis as { React?: typeof React }).React = React;
import { renderToStaticMarkup } from "react-dom/server";
import { SchoolPikasCash } from "./school-pikas-cash";
import type { WalletStudent } from "../lib/school/wallets";

const school = "4d700000-0000-4000-8000-000000000001", ana = "4d700000-0000-4000-8000-000000000101";
const overview = { wallet_count: 3, active: 2, frozen: 1, negative: 1, total_balance_minor: "24500", with_movement: 2, from: "2026-10-15", to: "2026-10-21" };
const row = (p: Partial<WalletStudent> = {}): WalletStudent => ({ id: ana, name: "Ana Ficticia", code: "EST-1", status: "active", wallet: { status: "active", balance_minor: "15000" }, ...p });
const html = (p: Partial<Parameters<typeof SchoolPikasCash>[0]> = {}) => renderToStaticMarkup(<SchoolPikasCash schoolId={school} schoolName="Colegio Ficticio" overview={overview}
  students={[row()]} view="todos" attentionCount={0} query="" paged={false} nextCursor={null} {...p} />);
const text = (h: string) => h.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

describe("School PIKAS Cash", () => {
  it("shows wallet administration with explicit-period movement and no commerce vocabulary", () => {
    const h = html(), t = text(h);
    expect(t).toContain("PIKAS Cash"); expect(t).toContain("Monederos con movimiento"); expect(t).toContain("15/10 al 21/10");
    expect(t).toContain("Todo en orden"); expect(t).toMatch(/Ana Ficticia.*Código EST-1.*Activo/);
    expect(t).not.toMatch(/Usaron PIKAS Cash|Compradores|compraron|ventas|Ventas|caja|producto|recibo|ranking/i);
    expect(h).not.toContain(`>${ana}<`); expect(t).not.toContain(ana);
  });
  it("connects to the student workspace and to the wallet detail with a way back", () => {
    const h = html();
    expect(h).toContain(`href="/admin/escuela/estudiantes/${ana}?school=${school}"`);
    expect(h).toContain(`href="/admin/escuela/estudiantes/${ana}/pikas-cash?school=${school}&amp;from=pikas-cash"`);
  });
  it("attention names frozen and negative wallets and links to them", () => {
    const h = html({ attentionCount: 2, students: [row({ wallet: { status: "frozen", balance_minor: "-500" } })] }), t = text(h);
    expect(t).toContain("Requiere atención · 2"); expect(t).toContain("2 monederos están congelados o tienen saldo negativo");
    expect(t).toContain("Congelado · saldo negativo"); expect(h).toContain("data-attention=\"true\""); expect(h).toContain("vista=atencion");
  });
  it("students without a wallet, zero balance, suspended and long names stay readable", () => {
    const long = "María de los Ángeles Fernández-Rodríguez de la Altagracia Ficticia";
    const t = text(html({ students: [row({ wallet: null }), row({ id: "4d700000-0000-4000-8000-000000000102", name: long, status: "suspended", wallet: { status: "active", balance_minor: "0" } })] }));
    expect(t).toContain("Sin monedero"); expect(t).toContain(long); expect(t).toContain("Suspendido"); expect(t).toMatch(/RD\$\s?0\.00|0\.00/);
  });
  it("low-data states: no wallets, no students, empty search, empty attention, load errors", () => {
    expect(text(html({ overview: { ...overview, wallet_count: 0, active: 0, frozen: 0, negative: 0, total_balance_minor: "0", with_movement: 0 } }))).toContain("Aún no hay monederos de PIKAS Cash");
    expect(text(html({ students: [] }))).toContain("Aún no hay estudiantes en este colegio");
    expect(text(html({ students: [], query: "zz" }))).toContain("No encontramos estudiantes");
    expect(text(html({ students: [], view: "atencion" }))).toContain("Ningún monedero requiere atención");
    const err = text(html({ overview: null, students: null, attentionCount: null }));
    expect(err).toContain("No pudimos cargar el resumen"); expect(err).toContain("No pudimos cargar los monederos"); expect(err).not.toContain("Todo en orden");
  });
  it("offers no wallet actions on the list; period reporting lives in Reportes, not on this page", () => {
    const h = html(), t = text(h);
    expect(t).not.toMatch(/Recargar|Congelar|Descongelar|Ajustar|Revertir/); expect(h).not.toContain("<form method=\"post\"");
    expect(h).not.toContain("<details"); expect(t).not.toMatch(/Movimientos del período|Recargas netas|Movimiento neto/);
    expect(h).toContain(`href="/admin/escuela/reportes/pikas-cash?school=${school}"`); expect(t).toContain("Ver reportes de PIKAS Cash");
  });
  it("Monederos con movimiento opens the PIKAS Cash report for the same seven days", () => {
    expect(html()).toContain(`href="/admin/escuela/reportes/pikas-cash?school=${school}&amp;period=last_7_days"`);
  });
  it("search and paging keep the school", () => {
    const h = html({ query: "Ana", paged: true, nextCursor: ana });
    expect(h).toContain(`name="school" value="${school}"`); expect(h).toContain("Primera página"); expect(h).toContain(`after=${ana}`);
  });
});
