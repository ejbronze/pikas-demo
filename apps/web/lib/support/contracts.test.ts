import { describe, expect, it } from "vitest";
import { actionsFor, looksLikeSecret, pagePath, statusLabel, categoryLabel } from "./contracts";

describe("support contracts", () => {
  it("uses the approved Spanish vocabulary", () => {
    expect(Object.values(categoryLabel)).toEqual(["Técnico", "Acceso", "Punto de venta", "PIKAS Cash", "Reporte / datos", "Otro"]);
    expect(Object.values(statusLabel)).toEqual(["Recibido", "En revisión", "Necesitamos información", "Resuelto", "Cerrado"]);
  });
  it("keeps only a bare page path", () => {
    expect(pagePath("/admin/escuela/pikas-cash")).toBe("/admin/escuela/pikas-cash");
    for (const bad of ["/admin?token=x", "/a#frag", "https://x.example/a", "admin", "/a b", null]) expect(pagePath(bad)).toBeNull();
  });
  it("screens credentials like the database does", () => {
    for (const secret of ["mi contraseña: Secreta123", "password=hunter2", "Bearer abcdefghijklmnopqrstuvwxyz123", "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijklmnop", "sb_secret_abcdefghijklmn"])
      expect(looksLikeSecret(secret)).toBe(true);
    for (const fine of ["No puedo cambiar mi contraseña", "La clave del wifi no es el problema", "El token de la impresora"]) expect(looksLikeSecret(fine)).toBe(false);
  });
  it("offers only the transitions the database accepts", () => {
    expect(actionsFor("received")).toEqual(["reply", "request_info", "review", "note", "resolve", "close"]);
    expect(actionsFor("in_review")).toEqual(["reply", "request_info", "note", "resolve", "close"]);
    expect(actionsFor("resolved")).toEqual(["reply", "note", "close", "reopen"]);
    expect(actionsFor("closed")).toEqual(["note", "reopen"]);
  });
});
