import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
vi.mock("next/link", () => ({ default: ({ children, href, className }: { children: React.ReactNode; href: string; className?: string }) => <a href={href} className={className}>{children}</a> }));
// eslint-disable-next-line @next/next/no-img-element
vi.mock("next/image", () => ({ default: ({ alt, src }: { alt: string; src: string }) => <img alt={alt} src={src} /> }));
(globalThis as { React?: typeof React }).React = React;
import { LaunchChecklist, PlatformCockpit } from "./cockpit";
import { readinessFixture as fx, request } from "../../lib/platform/readiness-fixtures";
import type { Readiness } from "../../lib/platform/readiness";

const sold = { first_at: "2026-10-17T14:00:00Z", last_at: "2026-10-20T14:00:00Z" };
const cepointLike = fx(1, "empty", { name: "Manuel Polanco", code: "Cepoint01", administrators: { active: 0, requests: [request({ link_state: "expired" })] } });
const data = (customers: Readiness["customers"], sandbox: Readiness["sandbox"] = [{ account_id: "7e00d000-0000-4000-8000-0000000000aa", name: "Colegio Horizonte", status: "active" }]): Readiness => ({ customers, sandbox, truncated: false });
const cockpit = (d: Readiness, activity: { id: string; label: string; customer: string | null; when: string }[] | null = []) =>
  renderToStaticMarkup(<PlatformCockpit data={d} activity={activity} canAdd demoHref="/platform/demostracion" />);

describe("Platform cockpit", () => {
  it("summarises real customers by launch status, keeps Demo apart and leads with attention", () => {
    const html = cockpit(data([cepointLike, fx(2), fx(3, "configured", { name: "Academia Operando", sales: sold })]), [{ id: "1", label: "Perfil del cliente actualizado", customer: "Academia Operando", when: "20 oct 2026, 10:00" }]);
    expect(html).toMatch(/Clientes activos<\/dt><dd class="num-display">3</); expect(html).toMatch(/En configuración<\/dt><dd class="num-display">1</);
    expect(html).toMatch(/Listos para operar<\/dt><dd class="num-display">1</); expect(html).toMatch(/Operando<\/dt><dd class="num-display">1</);
    expect(html).toContain("Requiere atención · 1"); expect(html).toContain("El enlace de activación venció sin usarse");
    expect(html).toContain('<span class="net-more">+3 pendientes</span>'); expect(html).not.toContain("También pendiente");
    expect(html).toContain('href="/platform/clientes/7e00d000-0000-4000-8000-000000000001#puesta-en-marcha"');
    expect(html).toContain("Colegio Horizonte"); expect(html).toContain("Las demostraciones no se cuentan.");
    expect(html).toContain("Esperando la primera venta"); expect(html).toContain("Última venta:"); expect(html).toContain("2 de 7 listos");
    expect(html).toContain("Perfil del cliente actualizado<span class=\"text-slate-600\"> · Academia Operando");
    expect(html).not.toMatch(/RD\$|monto|saldo|%/i);
  });
  it("calm state when no active customer has open steps", () => {
    const html = cockpit(data([fx(2), fx(3, "configured", { sales: sold })]));
    expect(html).toContain("Todo en orden"); expect(html).toContain("Ningún cliente activo tiene pasos de puesta en marcha pendientes."); expect(html).not.toContain('class="net-attention"');
  });
  it("zero real customers (sandbox only): empty invitation, sandbox still apart, no zero-heavy lists", () => {
    const html = cockpit(data([]));
    expect(html).toContain("Todavía no hay clientes en la red."); expect(html).toMatch(/Clientes activos<\/dt><dd class="num-display">0</);
    expect(html).not.toContain("Requiere atención"); expect(html).toContain("Colegio Horizonte"); expect(html).toContain('href="/platform/clientes/nuevo"');
    expect(html).toMatch(/<img[^>]*alt=""[^>]*aria-hidden="true"[^>]*data-mascot="EMP-02"/); expect(cockpit(data([fx(2)]))).not.toContain("data-mascot"); // mascot Phase 1: only the empty network
  });
  it("suspended customers are not counted and never listed as needing setup", () => {
    const html = cockpit(data([fx(4, "empty", { status: "suspended" })]));
    expect(html).toMatch(/Clientes activos<\/dt><dd class="num-display">0</); expect(html).toContain("1 cliente suspendido o cerrado no se cuenta");
    expect(html).toContain("Todo en orden"); expect(html).toContain(">Suspendido<");
  });
  it("activity is secondary and honest about missing audit access", () => {
    expect(cockpit(data([fx(2)]), null)).toContain("Tu acceso no incluye el registro de actividad.");
    expect(cockpit(data([fx(2)]), [])).toContain("Todavía no hay actividad registrada.");
    const many = Array.from({ length: 5 }, (_, i) => ({ id: String(i), label: `Evento ${i}`, customer: null, when: "hoy" }));
    const html = cockpit(data([fx(2)]), many);
    expect(html).toContain("Evento 0"); expect(html).toContain("Evento 2"); expect(html).not.toContain("Evento 3");
    expect(cockpit(data([fx(2)]), many.slice(0, 2))).toContain("Evento 1");
  });
});

describe("Puesta en marcha", () => {
  it("partial setup: ordered steps with text states, next step highlighted, links only where incomplete", () => {
    const html = renderToStaticMarkup(<LaunchChecklist customer={cepointLike} />);
    expect(html).toContain('id="puesta-en-marcha"'); expect(html).toContain("2 de 7 listos"); expect(html).toContain("Siguiente paso: Administrador.");
    expect(html).toMatch(/data-state="attention" data-next="true"/); expect(html).toContain("Requiere atención");
    expect(html).toContain("Ver administrador"); expect(html).toContain('href="/platform/clientes/7e00d000-0000-4000-8000-000000000001#customer-access"');
    expect(html).not.toContain("Ver perfil"); expect(html).toContain("Se completa sola con la primera venta real en el POS.");
    expect(html).toContain("En configuración");
  });
  it("configured without a sale says only the first sale is missing", () => {
    const html = renderToStaticMarkup(<LaunchChecklist customer={fx(2)} />);
    expect(html).toContain("Todo listo: falta la primera venta real."); expect(html).toContain("Listo para operar"); expect(html).toContain("6 de 7 listos");
  });
  it("completed and operating: a quiet success with the steps folded away", () => {
    const html = renderToStaticMarkup(<LaunchChecklist customer={fx(3, "configured", { sales: sold })} />);
    expect(html).toMatch(/Completa\. Primera venta el /); expect(html).toContain("net-launch-done"); expect(html).toContain("<details"); expect(html).toContain("7 de 7 listos");
    expect(html).not.toContain("Siguiente paso");
  });
  it("inactive lifecycle pauses the launch without changing lifecycle wording", () => {
    const html = renderToStaticMarkup(<LaunchChecklist customer={fx(4, "empty", { status: "suspended" })} />);
    expect(html).toContain("El cliente no está activo: la puesta en marcha queda en pausa."); expect(html).toContain(">Suspendido<"); expect(html).not.toContain('data-next="true"');
  });
});
