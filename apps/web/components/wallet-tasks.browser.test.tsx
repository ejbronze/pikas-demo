import { createServer, type Server } from "node:http";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { build } from "esbuild";
import { chromium, type Browser, type Page } from "@playwright/test";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

// Real components in real Chromium. fetch is scripted per test: no app server, Auth, database or money.
const id = "5d100000-0000-4000-8000-000000000001", school = "5d100000-0000-4000-8000-000000000002";
let browser: Browser, server: Server, page: Page, url: string;
type W = Window & { mountRecharge(balance: string): void; mountAdjust(balance: string, scope?: string, credit?: string): void; mountLookup(): void; byOperation(table: Record<string, { status: number; body: unknown }>): void; mountReverse(balance: string): void; mountWallet(props: Record<string, unknown>): void; unmountAll(): void;
  respond(status: number, body: unknown): void; hold(): void; echo(after: string): void; release(status: number, body: unknown): void; calls: { url: string; key: string | null; body: unknown }[]; done: string[]; closes: number };

beforeAll(async () => {
  const bundle = await build({ bundle: true, write: false, format: "iife", jsx: "automatic", platform: "browser", define: { "process.env.NODE_ENV": '"test"' },
    // The wallet page header (Wave D.3) links back to Estudiantes; next/link is stubbed as a plain anchor.
    plugins: [{ name: "stubs", setup(b) {
      b.onResolve({ filter: /^next\/link$/ }, () => ({ path: "link", namespace: "stub" }));
      b.onLoad({ filter: /^link$/, namespace: "stub" }, () => ({ resolveDir: process.cwd(), contents: "import React from 'react'; export default ({href, children, ...rest}) => React.createElement('a', {href, ...rest}, children)", loader: "js" }));
    } }],
    stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `
      import React, { useState } from "react";
      import { createRoot } from "react-dom/client";
      import { WalletRechargeTask } from "./components/wallet-recharge-task";
      import { WalletAdjustmentDialog } from "./components/wallet-adjustment-dialog";
      import { WalletReversalDialog } from "./components/wallet-reversal-dialog";
      import { StudentWallet } from "./components/student-wallet";
      import { CafeteriaWalletLookup } from "./components/cafeteria-wallet-lookup";
      const w = window; w.calls = []; w.done = []; w.closes = 0;
      let next = null, held = null;
      w.respond = (status, body) => { next = { status, body }; };
      w.hold = () => { next = "hold"; };
      // Authoritative-looking success derived from the exact request (balance_after supplied by the test).
      w.echo = (balanceAfter) => { next = (b) => ({ status: 200, body: { result: b.operation === "replenish"
        ? { request_key: b.request_key, school_id: b.school_id, student_id: b.student_id, wallet_id: b.student_id, replenishment_id: b.student_id, amount_minor: b.amount_minor, balance_after_minor: balanceAfter, version: "3" }
        : b.operation === "adjust" ? { request_key: b.request_key, adjustment_id: b.student_id, student_id: b.student_id, amount_minor: b.amount_minor, balance_before_minor: "15500", balance_after_minor: balanceAfter, reason: b.reason, actor_role: "school_admin", posted_at: "2026-10-18T12:00:00Z" }
        : { request_key: b.request_key, school_id: b.school_id, student_id: b.student_id, reversal_id: b.student_id, replenishment_id: b.replenishment_id, amount_minor: "2500", balance_after_minor: balanceAfter, reason: b.reason, reversed_at: "2026-10-18T12:00:00Z" } } }); };
      w.release = (status, body) => { const r = held; held = null; r(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })); };
      w.fetch = (input, init) => { w.calls.push({ url: String(input), key: new Headers(init?.headers).get("Idempotency-Key"), body: JSON.parse(init?.body ?? "null") });
        if (next === "hold") return new Promise(r => { held = r; });
        if (typeof next === "function") { const b = next(JSON.parse(init.body)); return Promise.resolve(new Response(JSON.stringify(b.body), { status: b.status, headers: { "Content-Type": "application/json" } })); }
        const n = next ?? { status: 500, body: {} }; return Promise.resolve(new Response(JSON.stringify(n.body), { status: n.status, headers: { "Content-Type": "application/json" } })); };
      let root;
      function Host({ render }) { const [open, setOpen] = useState(false); return <><button id="trigger" onClick={() => setOpen(true)}>Abrir tarea</button><a id="outside" href="#x">Fuera</a>{open && render(() => { w.closes++; setOpen(false); }, (m) => { w.done.push(String(m)); setOpen(false); })}</>; }
      const mount = (render) => { root ??= createRoot(document.getElementById("root")); root.render(<Host key={Math.random()} render={render} />); };
      w.mountRecharge = (balance) => mount((close, done) => <WalletRechargeTask schoolId="${school}" studentId="${id}" studentName="Sol Ficticia" actorId="${id}" balanceMinor={balance} onClose={close} onDone={done} />);
      w.mountAdjust = (balance, scope, credit) => mount((close, done) => <WalletAdjustmentDialog scope={scope === "cafeteria" ? { kind: "cafeteria", cafeteriaId: "${school}" } : { kind: "school", schoolId: "${school}" }} studentId="${id}" studentName="Sol Ficticia" actorId="${id}" balanceMinor={balance} credit={credit} onClose={close} onDone={done} />);
      // Answers by request operation (the Cafetería lookup reads cash-collection state and balances).
      w.byOperation = (table) => { next = (b) => table[b.operation ?? "lookup"] ?? { status: 500, body: {} }; };
      w.mountLookup = () => { root ??= createRoot(document.getElementById("root")); root.render(<CafeteriaWalletLookup key={Math.random()} cafeteriaId="${school}" actorId="${id}" canAdjust canCollect />); };
      w.unmountAll = () => root?.render(null);
      w.mountWallet = (props) => { root ??= createRoot(document.getElementById("root")); root.render(<StudentWallet key={Math.random()} schoolId="${school}" studentId="${id}" actorId="${id}" {...props} />); };
      w.mountReverse = (balance) => mount((close, done) => <WalletReversalDialog schoolId="${school}" studentId="${id}" studentName="Sol Ficticia" actorId="${id}" balanceMinor={balance}
        target={{ replenishmentId: "${id}", amountMinor: "2500", reference: "Transferencia ficticia 7", note: null, occurredAt: "2026-10-17T14:00:00Z" }} onClose={close} onDone={done} />);
    ` } });
  const css = readFileSync(resolve("app/globals.css"), "utf8");
  server = createServer((_q, r) => { r.setHeader("Content-Type", "text/html"); r.end(`<html lang="es"><body><div id="root"></div><style>${css}</style><script>${bundle.outputFiles[0].text}</script></body></html>`); });
  await new Promise<void>((ok, ko) => { server.once("error", ko); server.listen(0, "127.0.0.1", ok); });
  const a = server.address(); if (!a || typeof a === "string") throw Error("listener"); url = `http://127.0.0.1:${a.port}`;
  browser = await chromium.launch({ headless: true });
}, 60000);
beforeEach(async () => { page = await browser.newPage({ viewport: { width: 390, height: 844 } }); await page.goto(url); });
afterEach(async () => { await page?.close(); });
afterAll(async () => { await browser?.close(); await new Promise<void>(ok => server?.close(() => ok())); });

const w = <T,>(fn: (w: W) => T) => page.evaluate(`(${fn.toString()})(window)`) as Promise<T>;
const open = async (kind: "Recharge" | "Adjust" | "Reverse", balance = "15500") => {
  await page.evaluate(([k, b]) => (window as unknown as W)[`mount${k}` as "mountRecharge"](b), [kind, balance] as const);
  await page.locator("#trigger").focus(); await page.locator("#trigger").click(); await page.locator("dialog[open]").waitFor();
};
const dialog = () => page.locator("dialog[open]");
const focusedInDialog = () => page.evaluate(() => !!document.activeElement?.closest("dialog[open]"));
const storage = () => page.evaluate(() => ({ ...sessionStorage }));

describe("TaskWindow foundation (via Recarga)", () => {
  it("opens modal with focus inside, keeps focus contained, Escape closes when clean and returns focus to the trigger", async () => {
    await open("Recharge");
    expect(await page.evaluate(() => (document.activeElement as HTMLElement).closest("label")?.textContent)).toContain("Monto de la recarga");
    for (let i = 0; i < 12; i++) { await page.keyboard.press("Tab"); expect(await focusedInDialog()).toBe(true); }
    expect(await page.evaluate(() => document.querySelector("dialog")!.matches(":modal"))).toBe(true);
    await page.keyboard.press("Escape"); await dialog().waitFor({ state: "detached" });
    expect(await page.evaluate(() => document.activeElement?.id)).toBe("trigger");
    expect(await w(x => x.calls.length)).toBe(0);
  });
  it("typed input asks before discarding (no native confirm), for Escape, Cerrar and backdrop", async () => {
    let native = false; page.on("dialog", d => { native = true; void d.dismiss(); });
    await open("Recharge"); await dialog().getByLabel("Monto de la recarga (RD$)").fill("500");
    await page.keyboard.press("Escape"); await dialog().getByText("¿Descartar los datos ingresados?").waitFor();
    expect(await page.evaluate(() => (document.activeElement as HTMLElement).textContent)).toBe("Seguir editando");
    await dialog().getByRole("button", { name: "Seguir editando" }).click(); expect(await dialog().getByLabel("Monto de la recarga (RD$)").inputValue()).toBe("500");
    await page.mouse.click(5, 5); await dialog().getByText("¿Descartar los datos ingresados?").waitFor(); await dialog().getByRole("button", { name: "Seguir editando" }).click();
    await dialog().getByRole("button", { name: "Cerrar tarea" }).click(); await dialog().getByRole("button", { name: "Descartar" }).click(); await dialog().waitFor({ state: "detached" });
    expect(native).toBe(false); expect(await storage()).toEqual({}); expect(await w(x => x.calls.length)).toBe(0);
  });
});

describe("Recarga", () => {
  it("details → review → back → edit → review: explicit +amount, no request until the named final action; then success", async () => {
    await open("Recharge");
    await dialog().getByRole("button", { name: "Continuar" }).click(); await dialog().getByText("Introduce un monto positivo").waitFor();
    await dialog().getByLabel("Monto de la recarga (RD$)").fill("400"); await dialog().getByRole("button", { name: "Continuar" }).click(); await dialog().getByText("Incluye la referencia de fondos verificados o una nota.").waitFor();
    await dialog().getByLabel("Referencia de fondos verificados").fill("Transferencia ficticia 9"); await dialog().getByRole("button", { name: "Continuar" }).click();
    expect(await dialog().getByRole("list", { name: "Pasos" }).locator('[aria-current="step"]').textContent()).toContain("Confirmar");
    await dialog().getByText("+RD$ 400.00").waitFor(); await dialog().getByRole("button", { name: "Atrás" }).click();
    expect(await dialog().getByLabel("Referencia de fondos verificados").inputValue()).toBe("Transferencia ficticia 9");
    await dialog().getByLabel("Monto de la recarga (RD$)").fill("500"); await dialog().getByRole("button", { name: "Continuar" }).click();
    const text = await dialog().innerText(); expect(text).toMatch(/Recarga\s+\+RD\$ 500\.00/); expect(text).toMatch(/Saldo actual\s+RD\$ 155\.00/); expect(text).toMatch(/Saldo resultante \(estimado\)\s+RD\$ 655\.00/);
    expect(await w(x => x.calls.length)).toBe(0); expect(await storage()).toEqual({});
    await w(x => x.echo("65500"));
    await dialog().getByRole("button", { name: "Recargar RD$ 500.00" }).click();
    await dialog().getByText("Recarga registrada").waitFor(); expect(await dialog().innerText()).toMatch(/\+RD\$ 500\.00[\s\S]*Saldo actual de Sol Ficticia: RD\$ 655\.00/);
    const calls = await w(x => x.calls); expect(calls).toHaveLength(1); expect(calls[0].url).toBe("/api/school/wallet");
    expect(calls[0].body).toMatchObject({ operation: "replenish", amount_minor: "50000", reference: "Transferencia ficticia 9" }); expect(calls[0].key).toBe((calls[0].body as { request_key: string }).request_key);
    expect(await storage()).toEqual({});
    await page.keyboard.press("Escape"); await dialog().waitFor({ state: "detached" }); expect(await w(x => x.done)).toEqual(["65500"]);
  });
  it("pending blocks Escape, Cerrar, backdrop and a second submit; journal holds the exact request", async () => {
    await open("Recharge"); await dialog().getByLabel("Monto de la recarga (RD$)").fill("25"); await dialog().getByLabel("Nota de verificación").fill("Pago ficticio");
    await dialog().getByRole("button", { name: "Continuar" }).click(); await w(x => x.hold());
    await dialog().getByRole("button", { name: "Recargar RD$ 25.00" }).click(); await dialog().getByText("Registrando la recarga…").waitFor();
    await page.keyboard.press("Escape"); await page.mouse.click(5, 5);
    expect(await dialog().getByRole("button", { name: "Cerrar tarea" }).isDisabled()).toBe(true); expect(await dialog().getByRole("button", { name: "Registrando recarga…" }).isDisabled()).toBe(true);
    await dialog().getByText("La operación está en curso").waitFor(); expect(await dialog().getAttribute("aria-busy")).toBe("true");
    expect(await w(x => x.calls.length)).toBe(1);
    const journal = Object.values(await storage()); expect(journal).toHaveLength(1); expect(JSON.parse(journal[0]).command).toMatchObject({ amount_minor: "2500", note: "Pago ficticio" });
    await page.evaluate(() => (window as unknown as W).release(422, { error: "rejected" }));
    await dialog().getByText("No se realizó la recarga").waitFor(); expect(await dialog().innerText()).toContain("No se movió dinero");
    expect(await storage()).toEqual({}); expect(await w(x => x.calls.length)).toBe(1);
  });
  it("uncertain result never claims success; reopening offers only an explicit retry of the same key and payload", async () => {
    await open("Recharge"); await dialog().getByLabel("Monto de la recarga (RD$)").fill("30"); await dialog().getByLabel("Nota de verificación").fill("Pago ficticio");
    await dialog().getByRole("button", { name: "Continuar" }).click(); await w(x => x.respond(503, {}));
    await dialog().getByRole("button", { name: "Recargar RD$ 30.00" }).click(); await dialog().getByText("Recarga pendiente de confirmar").waitFor();
    expect(await dialog().innerText()).not.toMatch(/registrada|No se realizó/);
    await dialog().getByRole("button", { name: "Cerrar", exact: true }).click(); await dialog().waitFor({ state: "detached" });
    const first = (await w(x => x.calls))[0];
    await page.reload(); await open("Recharge");
    await dialog().getByText("Recarga pendiente de confirmar").waitFor(); expect(await dialog().getByLabel("Monto de la recarga (RD$)").count()).toBe(0);
    await page.waitForTimeout(300); expect(await w(x => x.calls.length)).toBe(0); // reload never replays
    await w(x => x.respond(503, {})); await dialog().getByRole("button", { name: "Reintentar la misma recarga" }).click(); await dialog().getByText("Recarga pendiente de confirmar").waitFor();
    const retry = (await w(x => x.calls))[0]; expect(retry.key).toBe(first.key); expect(retry.body).toEqual(first.body);
  });
  it("refresh before commit restores nothing", async () => {
    await open("Recharge"); await dialog().getByLabel("Monto de la recarga (RD$)").fill("99"); await dialog().getByLabel("Nota de verificación").fill("Pago ficticio");
    await dialog().getByRole("button", { name: "Continuar" }).click(); expect(await storage()).toEqual({});
    await page.reload(); await open("Recharge"); expect(await dialog().getByLabel("Monto de la recarga (RD$)").inputValue()).toBe(""); expect(await w(x => x.calls.length)).toBe(0);
  });
});

describe("Administrative adjustment", () => {
  it("purpose guidance first; positive adjustment reviewed then discarded without any request", async () => {
    await open("Adjust");
    for (const t of ["¿Qué necesitas corregir?", "Una compra", "Una recarga incorrecta", "Otra corrección excepcional de saldo"]) await dialog().getByText(t).first().waitFor();
    await dialog().getByRole("button", { name: /Una compra/ }).click(); await dialog().getByText("Usa Reembolso").waitFor(); await dialog().getByRole("button", { name: "Atrás" }).click();
    await dialog().getByRole("button", { name: /Otra corrección excepcional/ }).click(); await dialog().getByText("no es una recarga").waitFor();
    await dialog().getByLabel("Monto del ajuste").fill("100"); await dialog().getByLabel("Motivo del ajuste").selectOption("administrative_correction");
    await dialog().getByLabel("Explicación del ajuste").fill("Corrección ficticia de prueba"); await dialog().getByRole("button", { name: "Continuar" }).click();
    const text = await dialog().innerText(); expect(text).toMatch(/Ajuste\s+\+RD\$ 100\.00/); expect(text).toMatch(/Dirección\s+Aumenta el saldo/); expect(text).toMatch(/Saldo resultante \(estimado\)\s+RD\$ 255\.00/);
    await dialog().getByRole("button", { name: "Aplicar ajuste +RD$ 100.00" }).waitFor();
    await page.keyboard.press("Escape"); await dialog().getByRole("button", { name: "Descartar" }).click(); await dialog().waitFor({ state: "detached" });
    expect(await w(x => x.calls.length)).toBe(0); expect(await storage()).toEqual({}); expect(await page.evaluate(() => document.activeElement?.id)).toBe("trigger");
  });
  it("negative adjustment: explicit −amount, negative balance warns but is allowed, success via the existing route", async () => {
    await open("Adjust", "5000"); await dialog().getByRole("button", { name: /Otra corrección excepcional/ }).click();
    await dialog().getByText("− Disminuir saldo").click(); await dialog().getByLabel("Monto del ajuste").fill("100");
    expect(await dialog().getByLabel("Motivo del ajuste").locator("option").allInnerTexts()).not.toContain("Crédito autorizado");
    await dialog().getByLabel("Motivo del ajuste").selectOption("authorized_debit"); await dialog().getByLabel("Explicación del ajuste").fill("Débito ficticio autorizado");
    await dialog().getByRole("button", { name: "Continuar" }).click(); await dialog().getByText("El saldo quedará negativo (−RD$ 50.00)").waitFor();
    expect(await dialog().innerText()).toMatch(/Ajuste\s+−RD\$ 100\.00/);
    await w(x => x.echo("-5000")); await dialog().getByRole("button", { name: "Aplicar ajuste −RD$ 100.00" }).click(); await dialog().getByText("Ajuste aplicado").waitFor();
    expect(await dialog().innerText()).toMatch(/Saldo actual de Sol Ficticia: −RD\$ 50\.00/);
    const [call] = await w(x => x.calls); expect(call.url).toBe("/api/school/wallet"); expect(call.body).toMatchObject({ operation: "adjust", amount_minor: "-10000", reason: "authorized_debit" });
    expect(await storage()).toEqual({});
    await dialog().getByRole("button", { name: "Cerrar", exact: true }).click(); expect(await w(x => x.done)).toEqual(["Ajuste registrado: −RD$ 100.00. Saldo resultante: −RD$ 50.00."]);
  });
  it("values kept after going back to the purpose step still require an explicit discard", async () => {
    await open("Adjust"); await dialog().getByRole("button", { name: /Otra corrección excepcional/ }).click(); await dialog().getByLabel("Monto del ajuste").fill("3");
    await dialog().getByRole("button", { name: "Atrás" }).click(); await dialog().getByRole("button", { name: "Cancelar" }).click();
    await dialog().getByText("¿Descartar los datos ingresados?").waitFor(); expect(await w(x => x.closes)).toBe(0);
  });
  it("cafeteria scope uses the cafeteria route; an authority rejection is shown as not done", async () => {
    await open("Adjust"); await page.evaluate(() => (window as unknown as W).mountAdjust("15500", "cafeteria")); await page.locator("#trigger").click(); await dialog().waitFor();
    await dialog().getByRole("button", { name: /Otra corrección excepcional/ }).click(); await dialog().getByLabel("Monto del ajuste").fill("10");
    await dialog().getByLabel("Motivo del ajuste").selectOption("other"); await dialog().getByLabel("Explicación del ajuste").fill("Prueba de alcance"); await dialog().getByRole("button", { name: "Continuar" }).click();
    await w(x => x.respond(403, { error: "cafeteria_authority_required" })); await dialog().getByRole("button", { name: "Aplicar ajuste +RD$ 10.00" }).click();
    await dialog().getByText("No se registró el ajuste").waitFor(); expect((await w(x => x.calls))[0].url).toBe("/api/cafeteria/wallet"); expect(await storage()).toEqual({});
  });
  it("after financial activation only a decrease is offered and explained; the request is negative", async () => {
    await page.evaluate(() => (window as unknown as W).mountAdjust("15500", "school", "activated")); await page.locator("#trigger").click(); await dialog().waitFor();
    await dialog().getByRole("button", { name: /Una recarga incorrecta/ }).click(); await dialog().getByText("solo las revierte PIKAS").waitFor(); await dialog().getByRole("button", { name: "Atrás" }).click();
    await dialog().getByRole("button", { name: /Otra corrección excepcional/ }).click();
    expect(await dialog().getByText("+ Aumentar saldo").count()).toBe(0); expect(await dialog().getByRole("radio").count()).toBe(0);
    await dialog().getByText("Aquí solo se puede disminuir el saldo").waitFor(); await dialog().getByText("una recarga en efectivo en la cafetería").waitFor();
    expect(await dialog().getByLabel("Motivo del ajuste").locator("option").allInnerTexts()).not.toContain("Crédito autorizado");
    await dialog().getByLabel("Monto del ajuste").fill("20"); await dialog().getByLabel("Motivo del ajuste").selectOption("administrative_correction");
    await dialog().getByLabel("Explicación del ajuste").fill("Corrección ficticia"); await dialog().getByRole("button", { name: "Continuar" }).click();
    expect(await dialog().innerText()).toMatch(/Dirección\s+Disminuye el saldo/); await w(x => x.echo("13500")); await dialog().getByRole("button", { name: "Aplicar ajuste −RD$ 20.00" }).click();
    await dialog().getByText("Ajuste aplicado").waitFor(); expect((await w(x => x.calls))[0].body).toMatchObject({ operation: "adjust", amount_minor: "-2000" });
  });
  it("an unknown activation state fails closed to a decrease and says why", async () => {
    await page.evaluate(() => (window as unknown as W).mountAdjust("15500", "cafeteria", "unknown")); await page.locator("#trigger").click(); await dialog().waitFor();
    await dialog().getByRole("button", { name: /Otra corrección excepcional/ }).click(); await dialog().getByText("No pudimos confirmar si este cliente admite aumentos de saldo").waitFor();
    expect(await dialog().getByText("+ Aumentar saldo").count()).toBe(0); expect(await w(x => x.calls.length)).toBe(0);
  });
});

describe("Cafetería Corregir saldo follows financial activation", () => {
  const students = { cafeteria_id: school, students: [{ student_id: id, display_name: "Sol Ficticia", balance_minor: "15500", wallet_status: "active" }] };
  const cash = (enabled: boolean) => ({ cafeteria_id: school, enabled, fee_bps: enabled ? 300 : null, policy_version: enabled ? 1 : null, currency: enabled ? "DOP" : null, collections: [], next_before: null });
  const openAdjust = async () => {
    await page.getByLabel("Buscar cliente por nombre").fill("Sol"); await page.getByRole("button", { name: "Consultar saldo" }).click();
    await page.getByRole("button", { name: "Corregir saldo de Sol Ficticia" }).click(); await dialog().getByRole("button", { name: /Otra corrección excepcional/ }).click();
  };
  it("activated: only a decrease, with «Recibir efectivo» named as the way to add value", async () => {
    await page.evaluate(t => (window as unknown as W).byOperation(t), { read: { status: 200, body: { result: cash(true) } }, lookup: { status: 200, body: { result: students } } }); await page.evaluate(() => (window as unknown as W).mountLookup());
    await openAdjust(); await dialog().getByText("Aquí solo se puede disminuir el saldo").waitFor(); await dialog().getByText("«Recibir efectivo»").waitFor();
    expect(await dialog().getByText("+ Aumentar saldo").count()).toBe(0);
  });
  it("not activated: both directions as before", async () => {
    await page.evaluate(t => (window as unknown as W).byOperation(t), { read: { status: 200, body: { result: cash(false) } }, lookup: { status: 200, body: { result: students } } }); await page.evaluate(() => (window as unknown as W).mountLookup());
    await openAdjust(); await dialog().getByText("+ Aumentar saldo").waitFor(); await dialog().getByText("− Disminuir saldo").waitFor();
  });
  it("activation state unavailable: fails closed to a decrease", async () => {
    await page.evaluate(t => (window as unknown as W).byOperation(t), { read: { status: 502, body: { error: "cash_uncertain" } }, lookup: { status: 200, body: { result: students } } }); await page.evaluate(() => (window as unknown as W).mountLookup());
    await openAdjust(); await dialog().getByText("No pudimos confirmar").waitFor(); expect(await dialog().getByText("+ Aumentar saldo").count()).toBe(0);
  });
});

describe("Recarga reversal", () => {
  it("shows the original recarga, reviews an explicit −amount, cancel sends nothing", async () => {
    await open("Reverse");
    const text = await dialog().innerText(); expect(text).toMatch(/Recarga original\s+RD\$ 25\.00/); expect(text).toContain("Transferencia ficticia 7"); expect(text).toMatch(/Fecha\s+\S/);
    await dialog().getByRole("button", { name: "Continuar" }).click(); await dialog().getByText("Selecciona el motivo de la reversión.").waitFor();
    await dialog().getByLabel("Motivo de la reversión").selectOption("duplicate_replenishment"); await dialog().getByRole("button", { name: "Continuar" }).click();
    expect(await dialog().innerText()).toMatch(/Reversión\s+−RD\$ 25\.00/); await dialog().getByRole("button", { name: "Revertir recarga de RD$ 25.00" }).waitFor();
    await dialog().getByRole("button", { name: "Atrás" }).click(); await dialog().getByRole("button", { name: "Cancelar" }).click(); await dialog().getByRole("button", { name: "Descartar" }).click();
    await dialog().waitFor({ state: "detached" }); expect(await w(x => x.calls.length)).toBe(0); expect(await storage()).toEqual({});
  });
  it("commits the exact recarga once; an already-reversed recarga is reported, not retried", async () => {
    await open("Reverse", "1000"); await dialog().getByLabel("Motivo de la reversión").selectOption("wrong_amount"); await dialog().getByRole("button", { name: "Continuar" }).click();
    await dialog().getByText("El saldo quedará negativo (−RD$ 15.00)").waitFor();
    await w(x => x.echo("-1500")); await dialog().getByRole("button", { name: "Revertir recarga de RD$ 25.00" }).click(); await dialog().getByText("Reversión registrada").waitFor();
    const [call] = await w(x => x.calls); expect(call.body).toMatchObject({ operation: "reverse", replenishment_id: id, reason: "wrong_amount" });
    expect(Object.keys(call.body as object).sort()).toEqual(["note", "operation", "reason", "replenishment_id", "request_key", "school_id", "student_id"]);
    await dialog().getByRole("button", { name: "Cerrar", exact: true }).click(); expect(await w(x => x.done)).toEqual(["Recarga revertida. Saldo resultante: −RD$ 15.00."]);
    await open("Reverse"); await dialog().getByLabel("Motivo de la reversión").selectOption("wrong_amount"); await dialog().getByRole("button", { name: "Continuar" }).click();
    await w(x => x.respond(409, { error: "already_reversed" })); await dialog().getByRole("button", { name: "Revertir recarga de RD$ 25.00" }).click();
    await dialog().getByText("Esta recarga ya fue revertida. Solo puede revertirse una vez.").waitFor(); expect(await dialog().getByRole("button", { name: /Reintentar/ }).count()).toBe(0); expect(await storage()).toEqual({});
  });
});

const history = (status = "active") => ({ result: { school_id: school, student_id: id, student_name: "Sol Ficticia", wallet: { id, status, currency: "DOP", balance_minor: "15500", version: "4" }, next_before: null, movements: [
  { id: "5d100000-0000-4000-8000-0000000000a1", type: "replenishment", amount_minor: "2500", balance_after_minor: "15500", version: "4", occurred_at: "2026-10-17T14:00:00Z", source: "manual_verified", reference: "Transferencia ficticia 7", note: null, actor: "Directora Ficticia", replenishment_id: "5d100000-0000-4000-8000-0000000000b1", purchase_id: null, receipt_number: null, cafeteria: null, items: [], reversal_id: null },
  { id: "5d100000-0000-4000-8000-0000000000a2", type: "replenishment", amount_minor: "1000", balance_after_minor: "13000", version: "2", occurred_at: "2026-10-16T14:00:00Z", source: "manual_verified", reference: "Duplicada", note: null, actor: "Directora Ficticia", replenishment_id: "5d100000-0000-4000-8000-0000000000b2", purchase_id: null, receipt_number: null, cafeteria: null, items: [], reversal_id: "5d100000-0000-4000-8000-0000000000c2", reversal_reason: "duplicate_replenishment" },
] } });
describe("PIKAS Cash page actions", () => {
  const mountWallet = async (props: Record<string, unknown>, status = "active") => {
    await page.evaluate(h => (window as unknown as W).respond(200, h), history(status));
    await page.evaluate(p => (window as unknown as W).mountWallet(p), props); await page.getByText("Saldo PIKAS Cash").waitFor();
  };
  it("no permanent recarga form: one Recargar action opens the task; reversal only on unreversed recargas", async () => {
    await mountWallet({ canReplenish: true, canReverse: true, canAdjust: true });
    expect(await page.getByLabel(/Monto/).count()).toBe(0); expect(await page.getByRole("button", { name: "Recargar", exact: true }).isEnabled()).toBe(true);
    expect(await page.getByRole("button", { name: "Revertir recarga" }).count()).toBe(1); await page.getByText("Revertida").waitFor();
    await page.getByRole("button", { name: "Revertir recarga" }).click(); expect(await dialog().innerText()).toMatch(/Recarga original\s+RD\$ 25\.00/);
  });
  it("authority decides visibility: read-only roles get no Recargar, Corregir or Revertir; frozen PIKAS Cash disables Recargar", async () => {
    await mountWallet({ canReplenish: false, canReverse: false, canAdjust: false });
    for (const name of ["Recargar", "Corregir saldo", "Revertir recarga"]) expect(await page.getByRole("button", { name, exact: true }).count()).toBe(0);
    await page.getByText("Consulta de solo lectura").waitFor();
    await mountWallet({ canReplenish: true }, "frozen"); expect(await page.getByRole("button", { name: "Recargar", exact: true }).isDisabled()).toBe(true); await page.getByText("no admite recargas").waitFor();
  });
  it("activated customer: no Recargar, accurate copy, and Corregir saldo offers only a decrease", async () => {
    await mountWallet({ canReplenish: false, canReverse: true, canAdjust: true });
    expect(await page.getByRole("button", { name: "Recargar", exact: true }).count()).toBe(0);
    await page.getByText("Las recargas llegan en efectivo en la cafetería o por transferencia verificada por PIKAS").waitFor();
    expect(await page.getByText("Consulta de solo lectura").count()).toBe(0); expect(await page.getByText("Las recargas manuales requieren fondos").count()).toBe(0);
    await page.getByRole("button", { name: "Corregir saldo", exact: true }).click(); await dialog().getByRole("button", { name: /Otra corrección excepcional/ }).click();
    await dialog().getByText("Aquí solo se puede disminuir el saldo").waitFor(); expect(await dialog().getByText("+ Aumentar saldo").count()).toBe(0);
  });
  it("an unconfirmed recarga from before a reload is surfaced for explicit review and never sent automatically", async () => {
    await page.evaluate(([key, cmd]) => sessionStorage.setItem(key, JSON.stringify({ command: cmd })), [`pikas:wallet:${id}:${school}:${id}`,
      { operation: "replenish", school_id: school, student_id: id, amount_minor: "3000", reference: "", note: "Pago ficticio", request_key: "5d100000-0000-4000-8000-0000000000d1" }] as const);
    await mountWallet({ canReplenish: true }); await page.getByText("Hay una recarga de RD$ 30.00 pendiente de confirmar.").waitFor();
    expect(await page.getByRole("button", { name: "Recargar", exact: true }).isDisabled()).toBe(true);
    await page.waitForTimeout(300); expect((await w(x => x.calls)).filter(c => (c.body as { operation: string }).operation !== "read")).toHaveLength(0);
    await page.getByRole("button", { name: "Revisar recarga pendiente" }).click(); await dialog().getByRole("button", { name: "Reintentar la misma recarga" }).waitFor();
  });
});

describe("session end during a financial task", () => {
  it("unmounting mid-request (as the session boundary does) never resends; the exact request awaits explicit retry", async () => {
    await open("Recharge"); await dialog().getByLabel("Monto de la recarga (RD$)").fill("45"); await dialog().getByLabel("Nota de verificación").fill("Pago ficticio");
    await dialog().getByRole("button", { name: "Continuar" }).click(); await w(x => x.hold());
    await dialog().getByRole("button", { name: "Recargar RD$ 45.00" }).click(); await dialog().getByText("Registrando la recarga…").waitFor();
    await w(x => x.unmountAll()); await page.evaluate(() => (window as unknown as W).release(503, {}));
    await page.waitForTimeout(300); expect(await w(x => x.calls.length)).toBe(1);
    const journal = Object.values(await storage()); expect(journal).toHaveLength(1); expect(JSON.parse(journal[0]).command.amount_minor).toBe("4500");
    await open("Recharge"); await dialog().getByText("Recarga pendiente de confirmar").waitFor(); await page.waitForTimeout(200); expect(await w(x => x.calls.length)).toBe(1);
  });
});

