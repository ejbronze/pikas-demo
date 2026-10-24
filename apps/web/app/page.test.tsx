import React from "react";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
(globalThis as { React?: typeof React }).React = React;
import Home, { metadata } from "./page";
import { site } from "../components/site/content";
import { shots } from "../components/site/shots.generated";

const render = () => renderToStaticMarkup(<Home />);
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

describe("public PIKAS website", () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });
  it("leads with the approved brand line, one h1, and the connected-system explanation", () => {
    const html = render();
    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(text(html)).toContain("La cafetería escolar, por fin conectada.");
    expect(text(html)).toContain("PIKAS conecta el colegio, la cafetería y el punto de venta en una sola operación");
    expect(text(html)).toContain("Conectado no significa que todos vean todo.");
    for (const verb of ["ve la red.", "ve a sus estudiantes.", "ve su negocio.", "hace la venta."]) expect(text(html)).toContain(verb);
  });
  it("every navigation anchor points at a section on the page, and sign-in stays available", () => {
    const html = render();
    for (const item of site.nav) expect(html).toContain(`id="${item.href.slice(1)}"`);
    expect(html).toMatch(/href="\/login"[^>]*>Iniciar sesión</);
    expect(html).not.toContain("/backoffice/login"); // the PIKAS Admin entrance stays on the login page only
    expect(html).toContain('href="#contenido"');
  });
  it("is truthful: no unreleased capability claimed, planned items said as not available, positioning boundaries kept", () => {
    const t = text(render()).toLowerCase();
    for (const banned of ["cashless", "sin efectivo", "billetera digital", "revoluciona", "todo en uno", "tiempo real", "pasarela de pago disponible", "liquidación", "nfc", "inventario"]) expect(t).not.toContain(banned);
    expect(t).toContain("aún no están disponibles");
    expect(t).toContain("las recargas las registra la administración del colegio");
  });
  it("never shows real customers, persona names of the Demo or operator identities", () => {
    const t = text(render());
    for (const name of ["CEPOINT", "Polanco", "María Carey", "Bruno Mars", "Edwin", "Local browser", "example.invalid"]) expect(t).not.toContain(name);
    expect(t).toContain(site.fiction);
  });
  it("every product image is a real local capture that exists, with a meaningful description", () => {
    const html = render();
    for (const s of Object.values(shots)) expect(existsSync(resolve("public", s.src.slice(1)))).toBe(true);
    for (const step of site.story.steps) { expect(html).toContain(`data-shot="${step.shot}"`); expect(step.alt.length).toBeGreaterThan(30); }
    expect(html).not.toMatch(/<img(?![^>]*alt=)/);
  });
  it("contact: without a configured channel it says how to reach PIKAS instead of a dead form; with one it offers mailto", async () => {
    expect(text(render())).toContain(site.contact.fallback);
    expect(render()).not.toContain("<form");
    vi.stubEnv("NEXT_PUBLIC_PIKAS_CONTACT_EMAIL", "hola@example.invalid"); vi.resetModules();
    const { default: WithEmail } = await import("./page");
    const html = renderToStaticMarkup(<WithEmail />);
    expect(html).toContain('href="mailto:hola@example.invalid?subject=Quiero%20conocer%20PIKAS"'); expect(text(html)).toContain("hola@example.invalid");
  });
  it("footer keeps the Palmchat credit and copyright", () => {
    const t = text(render());
    expect(t).toContain("Diseñado y desarrollado por Palmchat Innovations LLC."); expect(t).toContain("© 2026 PIKAS");
  });
  it("metadata: brand title, positioning description, canonical and social cards", () => {
    expect(metadata.title).toEqual({ absolute: "PIKAS | La cafetería escolar, por fin conectada" });
    expect(metadata.description).toContain("PIKAS conecta las personas, la operación y el dinero detrás de la cafetería escolar");
    expect(metadata.alternates?.canonical).toBe("/");
    expect(metadata.openGraph).toMatchObject({ locale: "es_DO", siteName: "PIKAS" });
    expect(metadata.twitter).toMatchObject({ card: "summary_large_image" });
  });
  it("mascot use stays within the website set: decorative, at most one animated", () => {
    const html = render();
    const ids = [...html.matchAll(/data-mascot="([A-Z0-9-]+)"/g)].map(m => m[1]);
    expect(ids.sort()).toEqual(["FND-03", "FND-06", "FND-09"]);
    expect(html.match(/data-animated="true"/g)).toHaveLength(1);
    expect([...html.matchAll(/<img[^>]*data-mascot[^>]*>/g)].every(m => m[0].includes('alt=""'))).toBe(true);
  });
});
