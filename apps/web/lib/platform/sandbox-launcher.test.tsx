import { posContext } from "../pos/access-context.test-fixtures";
import { describe, expect, it, vi } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

// The project transform uses the classic JSX runtime for imported components.
(globalThis as { React?: typeof React }).React = React;

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import type { PikasIdentity } from "@/lib/auth/pikas-context";
import { SandboxLauncher } from "../../app/platform/sandbox-launcher";
import { loadSandboxLauncherState } from "./sandbox-launcher";

const A = "03e71159-69e9-4387-9b3b-65799d49faf0";
const C = "b9496342-5079-46ae-83b8-05c39bcbd7fe";
const S = posContext().pov!.session_id;

function identity(role: string, capabilities: string[]) {
  return {
    status: "ready",
    user: { id: "u" },
    person: { id: "p", displayName: "Operador" },
    memberships: [],
    platform: { role, roles: [role], capabilities },
  } as unknown as PikasIdentity;
}
const sandbox = identity("platform_sandbox_operator", ["platform:sandbox:pov:enter"]);
const admin = identity("platform_admin", ["platform:audit:read"]);

const targetRow = {
  account_id: A,
  account_name: "Colegio X",
  cafeteria_id: C,
  cafeteria_name: "Cafetería Y",
  pov_code: "cashier",
  persona_display_name: "Persona Z",
};
const activeRow = {
  session_id: S,
  account_id: A,
  account_name: "Colegio X",
  cafeteria_id: C,
  cafeteria_name: "Cafetería Y",
  pov_code: "cashier",
  persona_display_name: "Persona Z",
  expires_at: "2099-01-01T00:00:00Z",
};

function client(map: Record<string, { data: unknown; error: unknown }>) {
  const rpc = vi.fn(async (name: string) => map[name]);
  return { rpc } as unknown as Parameters<typeof loadSandboxLauncherState>[0] & {
    rpc: typeof rpc;
  };
}
const ok = (data: unknown) => ({ data, error: null });

describe("sandbox launcher state", () => {
  it("is hidden and calls nothing for platform_admin without the capability", async () => {
    const c = client({});
    expect(await loadSandboxLauncherState(c, admin)).toEqual({ kind: "hidden" });
    expect(c.rpc).not.toHaveBeenCalled();
    expect(renderToStaticMarkup(<SandboxLauncher state={{ kind: "hidden" }} />)).toBe("");
  });

  it("lists targets for a sandbox-capable operator and renders friendly text without internals", async () => {
    const c = client({
      platform_get_active_sandbox_pov: ok(null),
      platform_list_sandbox_pov_targets: ok([targetRow]),
    });
    const state = await loadSandboxLauncherState(c, sandbox);
    expect(state.kind).toBe("targets");
    const html = renderToStaticMarkup(<SandboxLauncher state={state} />);
    expect(html).toContain("Demostración");
    expect(html).toContain("Colegio X");
    expect(html).toContain("Persona Z · Cajero");
    expect(html).toContain("Entrar como Cajero");
    for (const hidden of [A, C, "cashier", "platform:", "pov_code"]) {
      expect(html).not.toContain(hidden);
    }
  });

  it("gives active POV precedence over the target list", async () => {
    const c = client({
      platform_get_active_sandbox_pov: ok(activeRow),
      get_pos_access_context: ok(posContext()),
      platform_list_sandbox_pov_targets: ok([targetRow]),
    });
    const state = await loadSandboxLauncherState(c, sandbox);
    expect(state.kind).toBe("active");
    expect(c.rpc).not.toHaveBeenCalledWith("platform_list_sandbox_pov_targets");
    const html = renderToStaticMarkup(<SandboxLauncher state={state} />);
    expect(html).toContain("Modo demostración");
    expect(html).toContain("Estás demostrando PIKAS como");
    expect(html).toContain("Persona Z · Cajero");
    expect(html).toContain("Salir de demostración");
    expect(html).not.toContain("Entrar como Cajero");
    expect(html).toMatch(/<a[^>]*href="\/pos"[^>]*>Abrir POS/);
    expect(html).not.toContain("Acceso POS sin confirmar");
    expect(html).not.toContain(S);
  });

  it("renders a calm empty state when there are no targets", async () => {
    const c = client({
      platform_get_active_sandbox_pov: ok(null),
      platform_list_sandbox_pov_targets: ok([]),
    });
    const html = renderToStaticMarkup(
      <SandboxLauncher state={await loadSandboxLauncherState(c, sandbox)} />,
    );
    expect(html).toContain("Todavía no hay demostraciones disponibles");
    expect(html).not.toContain("Entrar como Cajero");
  });

  it.each([
    ["active read error", { platform_get_active_sandbox_pov: { data: null, error: { code: "x" } } }],
    ["malformed active", { platform_get_active_sandbox_pov: ok({ bogus: 1 }) }],
    [
      "target error",
      {
        platform_get_active_sandbox_pov: ok(null),
        platform_list_sandbox_pov_targets: { data: null, error: { code: "x" } },
      },
    ],
    [
      "malformed targets",
      {
        platform_get_active_sandbox_pov: ok(null),
        platform_list_sandbox_pov_targets: ok([{ ...targetRow, pov_code: "admin" }]),
      },
    ],
  ])("fails safe without a fake active state: %s", async (_n, map) => {
    const state = await loadSandboxLauncherState(client(map), sandbox);
    expect(state).toEqual({ kind: "unavailable" });
    const html = renderToStaticMarkup(<SandboxLauncher state={state} />);
    expect(html).not.toContain("Demostración activa");
    expect(html).not.toContain("Entrar como Cajero");
  });

  it("treats a dual-role operator as launcher-capable", async () => {
    const dual = identity("platform_admin", ["platform:audit:read", "platform:sandbox:pov:enter"]);
    const c = client({
      platform_get_active_sandbox_pov: ok(null),
      platform_list_sandbox_pov_targets: ok([]),
    });
    expect((await loadSandboxLauncherState(c, dual)).kind).toBe("targets");
  });
});

it.each([null, { ...posContext(), pov: null }, { ...posContext(), pov: { ...posContext().pov!, session_id: "99999999-9999-4999-8999-999999999999" } }])("keeps POS disabled without matching authoritative cashier access", async (data) => {
 const state = await loadSandboxLauncherState(client({ platform_get_active_sandbox_pov: ok(activeRow), get_pos_access_context: ok(data) }), sandbox);
 const html = renderToStaticMarkup(<SandboxLauncher state={state} />);
 expect(html).toMatch(/<button[^>]*disabled[^>]*>Abrir POS/); expect(html).not.toContain('href="/pos"');
});
it("rejects expired POV before enabling navigation", async () => {
 expect(await loadSandboxLauncherState(client({ platform_get_active_sandbox_pov: ok({ ...activeRow, expires_at: "2000-01-01T00:00:00Z" }) }), sandbox)).toEqual({ kind: "unavailable" });
});
