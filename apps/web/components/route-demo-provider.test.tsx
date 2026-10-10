import React from "react";
import { PassThrough } from "node:stream";
import { renderToPipeableStream } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { posContext } from "../lib/pos/access-context.test-fixtures";

(globalThis as { React?: typeof React }).React = React;
const mocks = vi.hoisted(() => ({ pathname: "/pos" as string | null, initialize: vi.fn(), load: vi.fn() }));
vi.mock("next/navigation", () => ({ usePathname: () => mocks.pathname }));
vi.mock("@/lib/env", () => import("../lib/env"));
vi.mock("./demo-provider", () => {
  mocks.load();
  return { DemoProvider: ({ children }: { children: React.ReactNode }) => {
    mocks.initialize();
    return <div data-demo-provider>{children}</div>;
  } };
});
import { RouteDemoProvider } from "./route-demo-provider";
import { PosDashboard } from "./pos-dashboard";

async function render(children: React.ReactNode = <p>Route content</p>) {
  return new Promise<string>((resolve, reject) => {
    const output = new PassThrough();
    let html = "";
    output.on("data", (chunk) => { html += chunk.toString(); });
    output.on("end", () => resolve(html));
    output.on("error", reject);
    const stream = renderToPipeableStream(<RouteDemoProvider>{children}</RouteDemoProvider>, {
      onAllReady() { stream.pipe(output); },
      onError: reject,
    });
  });
}

afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

describe("root route demo boundary", () => {
  it.each(["/pos", "/pos/caja", "/pos/receipt", null])("does not load or initialize demo state for connected %s", async (pathname) => {
    vi.stubEnv("NEXT_PUBLIC_PIKAS_DEMO_MODE", "false");
    mocks.pathname = pathname;
    const html = await render(<PosDashboard access={{ demo: false, context: posContext() }} />);
    expect(html.replace(/<!-- -->/g, "")).toContain("José Ramírez · Cajero");
    expect(html).not.toContain("data-demo-provider");
    expect(mocks.load).not.toHaveBeenCalled();
    expect(mocks.initialize).not.toHaveBeenCalled();
  });
  it.each(["/admin/escuela", "/admin/escuela/estudiantes", "/admin/escuela/administradores", "/admin/escuela/cafeterias", "/admin/escuela/actividad", "/admin/cafeteria", "/admin/cafeteria/productos", "/admin/cafeteria/menus", "/admin/cafeteria/personal", "/admin/cafeteria/cajas", "/admin/cafeteria/configuracion"])("excludes demo initialization for connected school %s", async pathname => {
    vi.stubEnv("NEXT_PUBLIC_PIKAS_DEMO_MODE", "false"); mocks.pathname = pathname;
    expect(await render()).not.toContain("data-demo-provider");
    expect(mocks.load).not.toHaveBeenCalled(); expect(mocks.initialize).not.toHaveBeenCalled();
  });
  it.each(["/platform", "/platform/clientes", "/platform/clientes/nuevo", "/platform/demostracion"])("does not initialize demo state for authoritative %s", async (pathname) => {
    vi.stubEnv("NEXT_PUBLIC_PIKAS_DEMO_MODE", "false");
    mocks.pathname = pathname;
    expect(await render()).not.toContain("data-demo-provider");
    expect(mocks.initialize).not.toHaveBeenCalled();
  });
  it.each(["/familias", "/estudiante", "/pos-other"])("preserves the provider for existing %s routes", async (pathname) => {
    vi.stubEnv("NEXT_PUBLIC_PIKAS_DEMO_MODE", "false");
    mocks.pathname = pathname;
    expect(await render()).toContain("data-demo-provider");
    expect(mocks.initialize).toHaveBeenCalledOnce();
  });
  it.each(["/pos", "/pos/caja", "/admin/escuela", "/admin/escuela/estudiantes", "/admin/cafeteria"])("preserves the provider for demo-mode %s", async (pathname) => {
    vi.stubEnv("NEXT_PUBLIC_PIKAS_DEMO_MODE", "true");
    mocks.pathname = pathname;
    expect(await render()).toContain("data-demo-provider");
    expect(mocks.initialize).toHaveBeenCalledOnce();
  });
});
