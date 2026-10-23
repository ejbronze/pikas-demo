import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
(globalThis as { React?: typeof React }).React = React;
import { EmptyState, ErrorState, LoadFailure } from "./state-panels";

// UX 14: one ErrorState, several kinds. The kind decides the role, the tone and whether a retry makes sense.
describe("ErrorState by kind", () => {
  it("temporary: an alert with Reintentar and the honest next step", () => {
    const html = renderToStaticMarkup(<ErrorState retryHref="/x" />);
    expect(html).toContain('role="alert"'); expect(html).toContain('data-kind="temporary"'); expect(html).toContain("No pudimos cargar esta información.");
    expect(html).toContain("Inténtalo de nuevo"); expect(html).toContain('href="/x"'); expect(html).toContain("Reintentar"); expect(html).toContain("border-red-200");
  });
  it("permission: a calm status, no Reintentar even when a retry href is passed, owner named", () => {
    const html = renderToStaticMarkup(<ErrorState kind="permission" retryHref="/x" />);
    expect(html).toContain('role="status"'); expect(html).not.toContain('role="alert"'); expect(html).not.toContain("Reintentar"); expect(html).not.toContain('href="/x"');
    expect(html).toContain("No tienes acceso a esta sección."); expect(html).toContain("quien administra tu acceso"); expect(html).not.toContain("border-red");
  });
  it("not found: contextual return action instead of a retry", () => {
    const html = renderToStaticMarkup(<ErrorState kind="not_found" title="No encontramos este estudiante." action={<a className="btn-secondary" href="/lista">Volver a Estudiantes</a>} />);
    expect(html).toContain('role="status"'); expect(html).toContain("Volver a Estudiantes"); expect(html).not.toContain("Reintentar"); expect(html).toContain('data-kind="not_found"');
  });
  it("lifecycle: names the state and who can restore it", () => {
    const html = renderToStaticMarkup(<ErrorState kind="lifecycle" title="Este cliente está suspendido." description="Sus usuarios no pueden entrar. Solo la gestión de clientes de PIKAS puede reactivarlo." />);
    expect(html).toContain("Este cliente está suspendido."); expect(html).toContain("puede reactivarlo"); expect(html).not.toContain("Reintentar"); expect(html).toContain("border-amber-300");
  });
  it("validation: reset action, never a retry; a custom title keeps its own description", () => {
    const html = renderToStaticMarkup(<ErrorState kind="validation" title="Los filtros no son válidos." action={<a href="/lista">Restablecer filtros</a>} />);
    expect(html).toContain("Restablecer filtros"); expect(html).not.toContain("Reintentar"); expect(html).not.toContain("La solicitud no es válida.");
    expect(html).not.toContain("<p class=\"mt-1"); // no default description smuggled under a custom title
  });
  it("secondary actions and hints render; nothing in an ErrorState is a mascot", () => {
    const html = renderToStaticMarkup(<ErrorState kind="not_configured" title="Falta configurar la caja." action={<a href="/cajas">Ir a Cajas</a>} secondary={<a href="/hoy">Volver a Hoy</a>} hint="Lo configura el administrador de la cafetería." />);
    expect(html).toContain("Ir a Cajas"); expect(html).toContain("Volver a Hoy"); expect(html).toContain("Lo configura el administrador"); expect(html).not.toContain("data-mascot"); expect(html).not.toContain("<img");
  });
});

describe("LoadFailure", () => {
  it("names what failed with the verb of its kind", () => {
    expect(renderToStaticMarkup(<LoadFailure what="el reporte de ventas" retryHref="/r" />)).toContain("No pudimos cargar el reporte de ventas.");
    expect(renderToStaticMarkup(<LoadFailure kind="permission" what="el reporte de ventas" />)).toContain("Tu rol no tiene acceso al reporte de ventas.");
    expect(renderToStaticMarkup(<LoadFailure kind="permission" what="esta sección" />)).toContain("Tu rol no tiene acceso a esta sección.");
    expect(renderToStaticMarkup(<LoadFailure kind="not_found" what="esta sección" />)).toContain("No encontramos esta sección.");
    const invalid = renderToStaticMarkup(<LoadFailure what="esta sección" invalidResponse retryHref="/r" />);
    expect(invalid).toContain("No pudimos mostrar esta información."); expect(invalid).toContain("avisa a PIKAS"); expect(invalid).toContain("Reintentar");
    expect(renderToStaticMarkup(<LoadFailure kind="permission" what="x" retryHref="/r" />)).not.toContain("Reintentar");
  });
});

describe("EmptyState", () => {
  it("is a status that teaches, with optional actions and a hint; never an alert", () => {
    const html = renderToStaticMarkup(<EmptyState title="Aún no hay categorías." description="Una categoría agrupa productos." action={<><button>Crear categoría</button><a href="#p">Agregar producto</a></>} hint="Es normal al empezar." />);
    expect(html).toContain('role="status"'); expect(html).not.toContain('role="alert"'); expect(html).toContain("Crear categoría"); expect(html).toContain("Es normal al empezar."); expect(html).not.toContain("Reintentar");
  });
});
