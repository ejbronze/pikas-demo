import { describe, expect, it } from "vitest";
import { getLoginErrorMessage } from "./login-error";

describe("public login error messages", () => {
  it("explains that a valid identity has no tenant access", () => {
    expect(getLoginErrorMessage("membership")).toEqual({
      title: "No tienes acceso a una cuenta de PIKAS",
      body: "Tu usuario no está asociado actualmente a ninguna escuela o cafetería. Si crees que esto es un error, comunícate con el administrador de tu institución.",
    });
  });

  it("keeps invalid credentials distinct from missing tenant access", () => {
    expect(getLoginErrorMessage("credentials")).toEqual({
      title: "No se pudo iniciar sesión",
      body: "Verifica tu correo electrónico y contraseña e inténtalo de nuevo.",
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
