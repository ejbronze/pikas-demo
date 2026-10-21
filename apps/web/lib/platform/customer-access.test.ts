import { describe, expect, it } from "vitest";
import { accessStatus, customerAccessSchema, grantLabel, linkStatus, loginStatus, pendingStatus, roleLabel } from "./customer-access";

const login = { has_login: true, login_suspended: false, must_change_password: false, last_sign_in_at: "2026-10-20T12:00:00Z" };
describe("Usuarios y accesos derivations", () => {
  it("maps real roles to product labels and names the cafetería or colegio of scoped grants", () => {
    expect(["account_admin", "school_admin", "cafeteria_admin", "pos_supervisor", "pos_cashier", "pos_operator"].map(roleLabel)).toEqual([
      "Administrador del colegio", "Administrador escolar", "Administrador de cafetería", "Operador de caja · Supervisor", "Personal de caja", "Operador de caja"]);
    expect(grantLabel({ role_code: "cafeteria_admin", scope: "cafeteria", school_name: "Colegio", cafeteria_name: "Cafetería Tamboril" })).toBe("Administrador de cafetería · Cafetería Tamboril");
    expect(grantLabel({ role_code: "account_admin", scope: "account", school_name: null, cafeteria_name: null })).toBe("Administrador del colegio");
  });
  it("derives login status only from real flags, most restrictive first", () => {
    expect(loginStatus(login)).toBe("Activo");
    expect(loginStatus({ ...login, last_sign_in_at: null })).toBe("Nunca ha iniciado sesión");
    expect(loginStatus({ ...login, must_change_password: true })).toBe("Cambio de contraseña pendiente");
    expect(loginStatus({ ...login, must_change_password: true, login_suspended: true })).toBe("Inicio de sesión suspendido");
    expect(loginStatus({ ...login, has_login: false })).toBe("Sin inicio de sesión");
  });
  it("derives access from the Person and its grants", () => {
    const g = (status: string) => ({ status }) as never;
    expect(accessStatus({ person_status: "active", grants: [g("inactive"), g("active")] })).toBe("Activo");
    expect(accessStatus({ person_status: "active", grants: [g("suspended")] })).toBe("Suspendido");
    expect(accessStatus({ person_status: "inactive", grants: [g("active")] })).toBe("Inactivo");
  });
  it("presents pending activation without inventing states", () => {
    expect(pendingStatus({ kind: "initial_admin", request_expired: false, identity_state: "activation_pending" })).toBe("Pendiente de activación");
    expect(pendingStatus({ kind: "initial_admin", request_expired: false, identity_state: "ready" })).toBe("Contraseña guardada");
    expect(pendingStatus({ kind: "initial_admin", request_expired: true, identity_state: "ready" })).toBe("Solicitud vencida");
    expect(pendingStatus({ kind: "invitation", request_expired: false, identity_state: null })).toBe("Invitación pendiente");
    expect([linkStatus("active"), linkStatus("expired"), linkStatus("replaced"), linkStatus("none"), linkStatus(null)]).toEqual(["Enlace activo", "Enlace vencido", "Enlace reemplazado", "Sin enlace generado", null]);
  });
  it("the contract rejects malformed payloads", () => {
    expect(customerAccessSchema.safeParse({ account_id: "x", people: [], pending: [] }).success).toBe(false);
    expect(customerAccessSchema.safeParse({ account_id: "00000000-0000-4000-8000-000000000001", people: [], pending: [] }).success).toBe(true);
  });
});
