import { describe, expect, it } from "vitest";
import { getLoginErrorMessage } from "./login-error";

describe("public login error messages", () => {
  it("UX 14: a POS denial explains who grants access; an unavailable check is a temporary failure", () => {
    expect(getLoginErrorMessage("pos_authority")?.title).toBe("No tienes acceso al POS"); expect(getLoginErrorMessage("pos_authority")?.body).toContain("administrador de la cafetería");
    expect(getLoginErrorMessage("pos_unavailable")?.body).toContain("Inténtalo de nuevo");
  });
  it("UX 12B closure: an expired temporary password is explained with the 15-minute rule and the way out", () => {
    const m = getLoginErrorMessage("temporary_expired"); expect(m?.title).toBe("Tu contraseña temporal venció"); expect(m?.body).toContain("15 minutos"); expect(m?.body).toContain("administrador de tu cafetería");
  });
  it("explains that a valid identity has no tenant access", () => {
    expect(getLoginErrorMessage("membership")).toEqual({
      title: "No tienes acceso a una cuenta de PIKAS",
      body: "Tu usuario no está asociado actualmente a ninguna escuela o cafetería. Si crees que esto es un error, comunícate con el administrador de tu institución.",
    });
  });

  it("keeps invalid credentials distinct from missing tenant access", () => {
    expect(getLoginErrorMessage("credentials")).toEqual({
      title: "No se pudo iniciar sesión",
      body: "Verifica tu correo o usuario y tu contraseña e inténtalo de nuevo.",
    });
    expect(getLoginErrorMessage("credentials")).not.toEqual(
      getLoginErrorMessage("membership"),
    );
  });

  it("does not reveal unknown authorization context in public errors", () => {
    expect(getLoginErrorMessage("platform")).toBeNull();
    expect(getLoginErrorMessage("unknown")).toBeNull();
  });
});

it('explains explicit cafeteria authority without suggesting login grants roles',()=>{expect(getLoginErrorMessage('cafeteria_authority')?.body).toContain('Administración escolar');});

it('organization lifecycle messages are distinct from credentials and reveal no reason', () => {
  expect(getLoginErrorMessage('organization_suspended')?.body).toContain('temporalmente suspendido');
  expect(getLoginErrorMessage('organization_closed')?.body).toContain('cerrada');
  expect(getLoginErrorMessage('organization_suspended')).not.toEqual(getLoginErrorMessage('credentials'));
});
