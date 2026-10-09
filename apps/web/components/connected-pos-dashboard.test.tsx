import React from "react";
import { renderToStaticMarkup, renderToPipeableStream } from "react-dom/server";
import { PassThrough } from "node:stream";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { posContext } from "../lib/pos/access-context.test-fixtures";

(globalThis as { React?: typeof React }).React = React;
const mocks = vi.hoisted(() => ({ demoHook: vi.fn(), access: vi.fn(), registers: vi.fn() }));
vi.mock("./demo-provider", () => ({ usePosDemo: mocks.demoHook }));
vi.mock("./pos-tools", () => ({ PosHistory: () => null, PurchaseDetail: () => null, posMoney: String }));
vi.mock("./pos-calculator", () => ({ PosCalculator: () => null }));
vi.mock("./register-sessions", () => ({ RegisterSessions: mocks.registers }));
vi.mock("@/components/register-sessions", () => ({ RegisterSessions: mocks.registers }));
vi.mock("@/components/pos-dashboard", () => import("./pos-dashboard"));
vi.mock("@/components/connected-pos-dashboard", () => import("./connected-pos-dashboard"));
vi.mock("@/lib/auth/pos-access", () => ({ requirePosAccess: mocks.access }));

import { PosDashboard } from "./pos-dashboard";
import PosPage from "../app/pos/page";
import CajaPage from "../app/pos/caja/page";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.demoHook.mockImplementation(() => { throw new Error("demo-hook-mounted"); });
  mocks.registers.mockImplementation(() => { throw new Error("demo-registers-mounted"); });
  mocks.access.mockResolvedValue({ demo: false, context: posContext() });
});

describe("connected POS access boundary", () => {
  it("renders the authoritative sandbox identity and persistent banner", async () => {
    const html = renderToStaticMarkup(await PosPage());
    expect(html).toContain("Modo demostración · Sandbox");
    expect(html).toContain("José Ramírez · Cajero");
    expect(html).toContain("Colegio Horizonte · Cafetería Escolar");
    expect(html).toContain("sticky top-0");
    expect(html).toContain("pos-surface");
    expect(html).toContain("¿A quién atendemos?");
    expect(mocks.demoHook).not.toHaveBeenCalled();
  });
  it("blocks sales until readiness is loaded and never mounts demo financial actions", async () => {
    const html = renderToStaticMarkup(await PosPage());
    const buttons = [...html.matchAll(/<button([^>]*)>(.*?)<\/button>/g)];
    expect(buttons.length).toBe(8);
    for (const [, attributes, label] of buttons) {
      if (!["Salir", "Verificar caja y catálogo", "Venta", "Caja"].includes(label)) expect(attributes).toContain("disabled");
    }
    expect(html).not.toContain('href="/pos/caja"');
    expect(html).not.toContain('action="/api/pos');
    expect(html).toContain('action="/api/auth/logout"');
    expect(html).not.toContain("Caja 1");
    expect(html).not.toContain("Caja Demo");
    expect(html).not.toContain("Sofía");
    expect(html).not.toContain("RD$");
    expect(mocks.demoHook).not.toHaveBeenCalled();
  });
  it("shows server-provided ordinary cashier identity without a sandbox banner", async () => {
    const context = posContext(false);
    context.actor.display_name = "Actual tenant cashier";
    context.memberships[0].account_name = "Actual tenant";
    context.memberships[0].cafeteria_name = "Actual cafeteria";
    mocks.access.mockResolvedValue({ demo: false, context });
    const html = renderToStaticMarkup(await PosPage());
    expect(html).toContain("Actual tenant cashier");
    expect(html).toContain("Actual cafeteria");
    expect(html).not.toContain("Modo demostración");
    expect(html).not.toContain("José Ramírez");
    expect(mocks.demoHook).not.toHaveBeenCalled();
  });
  it("does not mount demo register actions on a connected caja page", async () => {
    const html = renderToStaticMarkup(await CajaPage());
    expect(html).toContain("José Ramírez · Cajero");
    expect(html).toContain("Estado de caja sin confirmar.");
    expect(mocks.registers).not.toHaveBeenCalled();
  });
  it("still selects the existing demo presentation for explicit demo mode", async () => {
    await expect(new Promise<void>((resolve, reject) => {
      const output = new PassThrough();
      output.resume();
      output.on("end", resolve);
      const stream = renderToPipeableStream(<PosDashboard access={{ demo: true, context: null }} />, {
        onAllReady() { stream.pipe(output); },
        onError: reject,
      });
    })).rejects.toThrow("demo-hook-mounted");
    expect(mocks.demoHook).toHaveBeenCalledOnce();
  });
  it("does not render either POS page after the server access guard denies", async () => {
    mocks.access.mockRejectedValue(new Error("redirect:/login?error=pos_authority"));
    await expect(PosPage()).rejects.toThrow("pos_authority");
    await expect(CajaPage()).rejects.toThrow("pos_authority");
    expect(mocks.demoHook).not.toHaveBeenCalled();
    expect(mocks.registers).not.toHaveBeenCalled();
  });
});
