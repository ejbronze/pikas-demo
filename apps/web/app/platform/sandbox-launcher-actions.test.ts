import { beforeEach, describe, expect, it, vi } from "vitest";
import * as ReactModule from "react";

// Minimal hook stand-ins so the client buttons can be exercised without a DOM or new dependencies.
const { refresh, slots, cursor } = vi.hoisted(() => ({
  refresh: vi.fn(),
  slots: [] as unknown[],
  cursor: { i: 0 },
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useState: (initial: unknown) => {
      const index = cursor.i++;
      if (!(index in slots)) slots[index] = initial;
      return [
        slots[index],
        (value: unknown) => {
          slots[index] = value;
        },
      ];
    },
  };
});

// The project transform uses the classic JSX runtime for imported components.
(globalThis as { React?: unknown }).React = ReactModule;

import { EnterCashierButton, ExitDemoButton } from "./sandbox-launcher-actions";

type El = { type?: unknown; props?: { children?: unknown; [k: string]: unknown } };

function render(component: () => unknown): El {
  cursor.i = 0;
  return component() as El;
}

function find(node: unknown, predicate: (el: El) => boolean): El | null {
  if (!node || typeof node !== "object") return null;
  const el = node as El;
  if (predicate(el)) return el;
  const children = el.props?.children;
  for (const child of Array.isArray(children) ? children : [children]) {
    const hit = find(child, predicate);
    if (hit) return hit;
  }
  return null;
}

const alertText = "No se pudo completar la acción. Inténtalo de nuevo.";
const ids = {
  accountId: "03e71159-69e9-4387-9b3b-65799d49faf0",
  cafeteriaId: "b9496342-5079-46ae-83b8-05c39bcbd7fe",
};

describe.each([
  ["enter", () => EnterCashierButton(ids), "/api/platform/sandbox-pov/enter"],
  ["exit", () => ExitDemoButton(), "/api/platform/sandbox-pov/exit"],
] as const)("%s button", (_name, component, url) => {
  beforeEach(() => {
    vi.clearAllMocks();
    slots.length = 0;
  });

  async function click() {
    const button = find(render(component), (e) => e.type === "button");
    await (button?.props?.onClick as () => Promise<void>)();
  }

  it.each([
    ["a non-OK response", () => vi.fn().mockResolvedValue({ ok: false })],
    ["a network error", () => vi.fn().mockRejectedValue(new Error("offline"))],
  ])("does not refresh and shows the inline error after %s", async (_n, makeFetch) => {
    const fetchMock = makeFetch();
    vi.stubGlobal("fetch", fetchMock);
    await click();
    expect(fetchMock.mock.calls[0][0]).toBe(url);
    expect(refresh).not.toHaveBeenCalled();
    const alert = find(render(component), (e) => e.props?.role === "alert");
    expect(alert?.props?.children).toBe(alertText);
  });

  it("refreshes the server state only after success, with no error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
    await click();
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(find(render(component), (e) => e.props?.role === "alert")).toBeNull();
  });
});
