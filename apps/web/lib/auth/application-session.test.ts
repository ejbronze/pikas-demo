import { describe, expect, it } from "vitest";
import { applicationSessionSchema, protectedSurface, remainingSessionMs } from "./application-session";
const at = (n: number) => new Date(Date.UTC(2026, 9, 13, 0, n)).toISOString();
const session = applicationSessionSchema.parse({ session_id: crypto.randomUUID(), user_id: crypto.randomUUID(), server_now: at(0), started_at: at(0), last_active_at: at(0), idle_deadline: at(30), absolute_deadline: at(480), idle_seconds: 1800 });
describe("application session policy", () => {
  it.each(["/platform", "/platform/equipo", "/admin/escuela/estudiantes", "/admin/cafeteria/productos"])("admin surface %s", path => expect(protectedSurface(path)).toBe("admin"));
  it("uses POS policy and excludes authentication/activation", () => {
    expect(protectedSurface("/pos")).toBe("pos");
    for (const path of ["/login", "/backoffice/login", "/activar", "/reset-password", "/forgot-password"]) expect(protectedSurface(path)).toBeNull();
  });
  it("uses authoritative response time rather than the browser clock", () => {
    expect(remainingSessionMs(session)).toBe(30 * 60_000);
    expect(remainingSessionMs({ ...session, server_now: at(28) })).toBe(120_000);
    expect(remainingSessionMs({ ...session, server_now: at(31) })).toBe(0);
  });
  it("absolute expiry wins even with later idle activity", () => expect(remainingSessionMs({ ...session, server_now: at(479), idle_deadline: at(509) })).toBe(60_000));
  it("accepts only fixed server policy values", () => expect(applicationSessionSchema.safeParse({ ...session, idle_seconds: 86400 }).success).toBe(false));
});
