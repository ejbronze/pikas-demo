import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh() {}, replace() {}, push() {} }), usePathname: () => "/platform/demostracion" }));
vi.mock("@pikas/ui/mascot", () => ({ PikasMascot: () => null }));
(globalThis as { React?: typeof React }).React = React;
import { DemoLab, DemoLabIntro } from "./demo-lab";
import { sandbox } from "../../lib/platform/demo-lab.test";

// Demo Lab server markup: sandbox card, persona cards with "Abrir como {nombre}", staff created inside the Demo,
// reset only for those who may, active Demo card. No technical ids, no passwords, no deletion vocabulary.
const active = { sessionId: "7c000000-0000-4000-8000-000000000099", povCode: "cafeteria_admin" as const, accountId: sandbox().account_id, schoolId: sandbox().school!.school_id, cafeteriaId: "7c000000-0000-4000-8000-000000000004", accountName: "Colegio Horizonte", cafeteriaName: "Cafetería Escolar", personaName: "Bruno Mars", expiresAt: "2030-01-01T00:00:00Z" };
describe("DemoLab", () => {
  it("sandbox card: scenario, readiness, data, personas with scoped Abrir como, no ids", () => {
    const html = renderToStaticMarkup(<DemoLab sandboxes={[sandbox()]} active={null} canReset={false} operatorName="Operadora" />);
    expect(html).toContain("Colegio Horizonte"); expect(html).toContain("Listo para demostrar"); expect(html).toContain("4 estudiantes · 4 habilitados"); expect(html).toContain("6 productos · 1 cajas activas · 0 ventas");
    for (const p of ["María Carey", "Bruno Mars", "José Ramírez"]) expect(html).toContain(p);
    expect(html).toContain('aria-label="Abrir como José Ramírez"'); expect(html).toContain(">Abrir como José<"); expect(html).toContain(">Abrir como María<"); expect(html).toContain("Caja: Caja demo Horizonte");
    expect(html).toContain("Administradora escolar"); expect(html).toContain("Administrador de cafetería"); expect(html).toContain("Cajero");
    expect(html.replace(/<[^>]+>/g, " ")).not.toContain("7c000000"); expect(html).not.toMatch(/contraseña|password|Eliminar sandbox/i); expect(html).not.toContain("Restaurar escenario inicial");
    expect(html).toContain("no tienen inicio de sesión propio");
  });
  it("reset only with the capability, disabled while a Demo is active; active Demo card offers Continuar and Salir", () => {
    const html = renderToStaticMarkup(<DemoLab sandboxes={[sandbox()]} active={null} canReset operatorName="Operadora" />);
    expect(html).toContain("Restaurar escenario inicial"); expect(html).toContain("Solo afecta este sandbox"); expect(html).not.toContain("Sal del Demo para restaurar");
    const withActive = renderToStaticMarkup(<DemoLab sandboxes={[sandbox()]} active={active} canReset operatorName="Operadora" />);
    expect(withActive).toContain("Estás dentro como Bruno Mars"); expect(withActive).toContain(">Continuar como Bruno<"); expect(withActive).toContain("Salir de demostración"); expect(withActive).toContain("Demo activo con esta persona");
    expect(withActive).toContain("Sal del Demo para restaurar"); expect(withActive).toMatch(/<button[^>]*disabled=""[^>]*>Restaurar escenario inicial</);
  });
  it("personas that are not valid cannot be opened; staff created inside the Demo is listed with its .demo username", () => {
    const s = sandbox({ sandbox_staff: [{ person_id: "7c000000-0000-4000-8000-000000000050", display_name: "Carla Demo", role_code: "pos_cashier", status: "active", cafeteria_name: "Cafetería Escolar", username: "carla.demo", has_login: true }] });
    s.personas[2] = { ...s.personas[2], valid: false, membership_status: "suspended" };
    const html = renderToStaticMarkup(<DemoLab sandboxes={[s]} active={null} canReset={false} operatorName="Operadora" />);
    expect(html).toContain("Personas no disponibles"); expect(html).toContain("No disponible · acceso suspendido"); expect(html).toMatch(/<button[^>]*disabled=""[^>]*aria-label="Abrir como José Ramírez"/);
    expect(html).toContain("Personal creado en el Demo"); expect(html).toContain("Carla Demo"); expect(html).toContain("Usuario carla.demo"); expect(html).toContain("Restaurar el escenario lo retira");
  });
  it("intro states the purpose and the operator attribution", () => {
    const html = renderToStaticMarkup(<DemoLabIntro />); expect(html).toContain("sin afectar operaciones reales"); expect(html).toContain("Demo activo");
  });
});
