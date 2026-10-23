import { describe, expect, it } from "vitest";
import { activityLabel, recentCustomers, structureSummary, workspaceHref, personHref } from "./workspace";

describe("workspace hrefs", () => {
  const A = "7e00d000-0000-4000-8000-000000000001";
  it("sections are query params; Resumen is the bare route; older anchors land in their section", () => {
    expect(workspaceHref(A)).toBe(`/platform/clientes/${A}`);
    expect(workspaceHref(A, "resumen")).toBe(`/platform/clientes/${A}`);
    expect(workspaceHref(A, "estado")).toBe(`/platform/clientes/${A}?seccion=estado`);
    expect(workspaceHref(A, undefined, "puesta-en-marcha")).toBe(`/platform/clientes/${A}#puesta-en-marcha`);
    expect(workspaceHref(A, undefined, "customer-access")).toBe(`/platform/clientes/${A}?seccion=personas#customer-access`);
    expect(workspaceHref(A, "administrador-inicial")).toBe(`/platform/clientes/${A}?seccion=personas#administrador-inicial`);
    expect(workspaceHref(A, "estructura", "colegio-profile")).toBe(`/platform/clientes/${A}?seccion=estructura#colegio-profile`);
    expect(workspaceHref(A, "nonsense")).toBe(`/platform/clientes/${A}`);
    expect(personHref(A, "x")).toBe(`/platform/clientes/${A}?seccion=personas&persona=x`);
  });
  it("structure summary uses the Platform vocabulary and pluralises", () => {
    expect(structureSummary({ school_count: 1, location_count: 2, cafeteria_count: 3 })).toBe("1 colegio · 2 sedes · 3 cafeterías");
    expect(structureSummary({ school_count: 0, location_count: 1, cafeteria_count: 1 })).toBe("0 colegios · 1 sede · 1 cafetería");
  });
  it("recent customers: most recent audit event per customer, newest first, bounded; events without a customer are skipped", () => {
    const e = (id: string, at: string, acc: string | null) => ({ id, occurred_at: at, action: "x", target_account_id: acc });
    const recent = recentCustomers([e("1", "2026-10-20T10:00:00Z", "a"), e("2", "2026-10-22T10:00:00Z", "b"), e("3", "2026-10-23T10:00:00Z", "a"), e("4", "2026-10-23T11:00:00Z", null)], 1);
    expect(recent).toEqual([{ account_id: "a", last: e("3", "2026-10-23T10:00:00Z", "a") }]);
    expect(recentCustomers([e("1", "2026-10-20T10:00:00Z", "a"), e("2", "2026-10-22T10:00:00Z", "b")]).map(r => r.account_id)).toEqual(["b", "a"]);
    expect(activityLabel("customer_staff_completed")).toBe("Acceso de personal POS completado"); expect(activityLabel("zzz")).toBe("Actividad de plataforma");
  });
});
