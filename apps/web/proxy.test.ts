import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { posContext } from "./lib/pos/access-context.test-fixtures";

const mocks = vi.hoisted(() => ({
  demo: vi.fn(), school: vi.fn(), cafeteria:vi.fn(), access: vi.fn(), identity: vi.fn(), appRole: vi.fn(), createClient: vi.fn(),
}));
vi.mock("@/lib/env", () => ({ isDemoMode: mocks.demo }));
vi.mock("@/lib/auth/cafeteria-access",()=>({resolveCafeteriaAccess:mocks.cafeteria}));
vi.mock("@/lib/auth/school-access", () => ({ resolveSchoolAccess: mocks.school }));
vi.mock("@/lib/auth/pos-access", () => ({ resolvePosAccess: mocks.access }));
vi.mock("@/lib/auth/pikas-context", () => ({ resolvePikasIdentity: mocks.identity, hasAppRole: mocks.appRole }));
vi.mock("@/lib/supabase/config", () => ({ getSupabasePublicConfig: () => ({ url: "https://example.invalid", anonKey: "public" }) }));
vi.mock("@supabase/ssr", () => ({ createServerClient: mocks.createClient }));

import { proxy } from "./proxy";
const request = (path: string, cookie?: string) => new NextRequest(`http://localhost${path}`, {
  headers: cookie ? { cookie } : undefined,
});
beforeEach(() => {
  vi.resetAllMocks();
  mocks.demo.mockReturnValue(false);
  mocks.createClient.mockReturnValue({});
  mocks.access.mockResolvedValue({ status: "authorized", context: posContext() });
});

describe("POS proxy gate", () => {
  it.each(["/pos", "/pos/caja"])("lets a DB-authorized POS request reach %s", async (path) => {
    const response = await proxy(request(path));
    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(response.headers.get("location")).toBeNull();
    expect(mocks.access).toHaveBeenCalledOnce();
    expect(mocks.identity).not.toHaveBeenCalled();
  });
  it("keeps ordinary tenant POS access on /pos", async () => {
    mocks.access.mockResolvedValue({ status: "authorized", context: posContext(false) });
    expect((await proxy(request("/pos"))).headers.get("location")).toBeNull();
  });
  it.each([
    ["unauthenticated", "/login?next=%2Fpos"],
    ["forbidden", "/login?error=pos_authority"],
    ["unavailable", "/login?error=pos_unavailable"],
  ])("fails closed for %s", async (status, destination) => {
    mocks.access.mockResolvedValue({ status });
    expect((await proxy(request("/pos"))).headers.get("location")).toBe(`http://localhost${destination}`);
  });
  it("preserves refreshed Auth cookies when allowing or denying POS", async () => {
    mocks.createClient.mockImplementation((_url, _key, options) => {
      options.cookies.setAll([{ name: "refreshed-auth", value: "session", options: { httpOnly: true } }]);
      return {};
    });
    expect((await proxy(request("/pos"))).cookies.get("refreshed-auth")?.value).toBe("session");
    mocks.access.mockResolvedValue({ status: "forbidden" });
    expect((await proxy(request("/pos"))).cookies.get("refreshed-auth")?.value).toBe("session");
  });
  it("preserves the demo POS cookie gate without calling the DB", async () => {
    mocks.demo.mockReturnValue(true);
    expect((await proxy(request("/pos", "pikas_demo_role=pos"))).headers.get("location")).toBeNull();
    expect(mocks.access).not.toHaveBeenCalled();
    expect(mocks.createClient).not.toHaveBeenCalled();
  });
});

describe("school proxy gate", () => {
  it.each(["/admin/escuela", "/admin/escuela/estudiantes", "/admin/escuela/administradores", "/admin/escuela/cafeterias", "/admin/escuela/actividad"])("permits DB-authorized school request %s", async path => {
    mocks.school.mockResolvedValue({ status: "authorized", context: {} });
    expect((await proxy(request(path))).headers.get("x-middleware-next")).toBe("1");
    expect(mocks.identity).not.toHaveBeenCalled();
  });
  it.each(["forbidden", "unavailable", "unauthenticated"])("fails closed for %s", async status => {
    mocks.school.mockResolvedValue({ status });
    expect((await proxy(request("/admin/escuela/administradores"))).headers.get("location")).toContain("/login?");
  });
});

describe("cafeteria proxy gate",()=>{
 it.each(["/admin/cafeteria","/admin/cafeteria/productos","/admin/cafeteria/menus/turnos","/admin/cafeteria/personal","/admin/cafeteria/cajas","/admin/cafeteria/configuracion"])("allows DB-authorized %s",async path=>{mocks.cafeteria.mockResolvedValue({status:"authorized"});expect((await proxy(request(path))).headers.get("x-middleware-next")).toBe("1");expect(mocks.identity).not.toHaveBeenCalled();});
 it.each(["forbidden","unavailable","unauthenticated"])("fails closed for %s",async status=>{mocks.cafeteria.mockResolvedValue({status});expect((await proxy(request("/admin/cafeteria"))).headers.get("location")).toContain("/login?");});
});
