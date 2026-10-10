import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as ReactModule from "react";
const mocks = vi.hoisted(() => ({ slots: [] as unknown[], refs: [] as { current: unknown }[], effects: [] as (() => unknown)[], first: true, cursor: { state: 0, ref: 0 }, refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("react", async original => ({ ...await original<typeof import("react")>(),
 useState: (initial: unknown) => { const n = mocks.cursor.state++; if (!(n in mocks.slots)) mocks.slots[n] = initial; return [mocks.slots[n], (v: unknown) => { mocks.slots[n] = typeof v === "function" ? v(mocks.slots[n]) : v; }]; },
 useRef: (initial: unknown) => { const n = mocks.cursor.ref++; return mocks.refs[n] ??= { current: initial }; },
 useEffect: (effect: () => unknown) => { if (mocks.first) mocks.effects.push(effect); },
}));
(globalThis as { React?: unknown }).React = ReactModule;
import { SchoolCommandForm } from "./school-command-form";
import { recoveryKey } from "../lib/school/command";
const id = "4d200000-0000-4000-8000-000000000001";
let email = "original@example.invalid";
const props = { actorId: id, schoolId: id, formId: "prepare", operation: "admin_prepare" as const, label: "Preparar", makePayload: () => ({ email }) };
function render() { mocks.cursor.state = 0; mocks.cursor.ref = 0; return SchoolCommandForm(props); }
async function mount() { render(); mocks.effects.splice(0).forEach(effect => effect()); mocks.first = false; await Promise.resolve(); return render(); }
const form = { reset: vi.fn() };
function submit() { return render().props.onSubmit({ preventDefault() {}, currentTarget: form }); }
function text(node: unknown): string { if (typeof node === "string") return node; if (Array.isArray(node)) return node.map(text).join(" "); if (node && typeof node === "object" && "props" in node) return text((node as { props: { children?: unknown } }).props.children); return ""; }
beforeEach(() => {
 vi.clearAllMocks(); mocks.slots.length = 0; mocks.refs.length = 0; mocks.effects.length = 0; mocks.first = true; email = "original@example.invalid";
 const values = new Map<string,string>(); vi.stubGlobal("sessionStorage", { getItem: (k: string) => values.get(k) ?? null, setItem: (k: string,v: string) => { values.set(k,v); }, removeItem: (k: string) => { values.delete(k); } });
 vi.stubGlobal("FormData", class {});
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
describe("school mutation UI", () => {
 it.each([401, 403, 400, 422])("lost committed response survives recovery-time %s and restores the original result", async status => {
   const journalKey = recoveryKey(id, id, "prepare");
   const uuid = vi.spyOn(crypto, "randomUUID");
   const committed = new Map<string, { invitation_id: string; status: string }>();
   let writes = 0;
   let attempt = 0;
   const send = vi.fn(async (_url: string, options: RequestInit) => {
     const key = (options.headers as Record<string, string>)["Idempotency-Key"];
     attempt++;
     if (attempt === 2) return { ok: false, status, json: async () => ({ error: "authorization_or_preexecution_failure" }) };
     if (!committed.has(key)) { writes++; committed.set(key, { invitation_id: id, status: "pending" }); }
     if (attempt === 1) throw new Error("Committed response lost");
     return { ok: true, json: async () => ({ result: committed.get(key) }) };
   });
   vi.stubGlobal("fetch", send);
   await mount(); await submit();
   const originalJournal = sessionStorage.getItem(journalKey);
   expect(originalJournal).not.toBeNull(); expect(writes).toBe(1);
   mocks.slots.length = 0; mocks.refs.length = 0; mocks.first = true;
   email = "edited@example.invalid"; await mount(); await submit();
   expect(sessionStorage.getItem(journalKey)).toBe(originalJournal);
   expect(render().props.children[0].props.disabled).toBe(true);
   expect(text(render())).toContain("La operación anterior sigue sin confirmar");
   expect(text(render())).not.toContain("No se realizó el cambio");
   expect(text(render())).not.toContain("Cambio confirmado");
   expect(form.reset).not.toHaveBeenCalled(); expect(mocks.refresh).not.toHaveBeenCalled();
   mocks.slots.length = 0; mocks.refs.length = 0; mocks.first = true;
   await mount(); await submit();
   expect(send.mock.calls[1]).toEqual(send.mock.calls[0]);
   expect(send.mock.calls[2]).toEqual(send.mock.calls[0]);
   expect(uuid).toHaveBeenCalledOnce(); expect(writes).toBe(1);
   expect(sessionStorage.getItem(journalKey)).toBeNull();
   expect(text(render())).toContain("Cambio confirmado");
   expect(form.reset).toHaveBeenCalledOnce(); expect(mocks.refresh).toHaveBeenCalledOnce();
 });
 it.each([401, 403, 400, 422])("a first-attempt definitive %s rejection clears normally", async status => {
   vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status, json: async () => ({ error: "rejected" }) }));
   await mount(); await submit();
   expect(sessionStorage.getItem(recoveryKey(id,id,"prepare"))).toBeNull();
   expect(render().props.children[0].props.disabled).toBe(false);
   expect(text(render())).toContain("No se realizó el cambio");
   expect(mocks.refresh).not.toHaveBeenCalled();
 });

 it("uncertain result freezes edits, retains journal and never shows success", async () => {
   vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network"))); await mount(); await submit();
   const output = render(); expect(output.props.children[0].props.disabled).toBe(true); expect(text(output)).toContain("Resultado incierto"); expect(text(output)).not.toContain("Cambio confirmado"); expect(form.reset).not.toHaveBeenCalled(); expect(mocks.refresh).not.toHaveBeenCalled();
 });
 it("reload recovers original payload/key and replays only that request", async () => {
   const send = vi.fn().mockRejectedValueOnce(new Error("network")).mockResolvedValueOnce({ ok: true, json: async () => ({ result: { invitation_id: id,status: "pending" } }) }); vi.stubGlobal("fetch",send);
   await mount(); await submit(); mocks.slots.length = 0; mocks.refs.length = 0; mocks.first = true; email = "changed@example.invalid"; await mount(); await submit();
   expect(send.mock.calls[0]).toEqual(send.mock.calls[1]); expect(mocks.refresh).toHaveBeenCalledOnce(); expect(form.reset).toHaveBeenCalledOnce(); expect(text(render())).toContain("Cambio confirmado");
 });
 it("duplicate submit cannot start a second in-flight mutation", async () => {
   let resolve!: (v: unknown) => void; const send = vi.fn().mockReturnValue(new Promise(r => { resolve=r; })); vi.stubGlobal("fetch",send); await mount(); const first=submit(); await submit(); expect(send).toHaveBeenCalledOnce(); resolve({ ok: false,status:422,json:async()=>({error:"invalid"}) }); await first;
 });
 it("pending identity does not claim invitation delivery or granted access", async () => {
   vi.stubGlobal("fetch",vi.fn().mockResolvedValue({ ok:false,status:422,json:async()=>({error:"confirmed_identity_pending"}) })); await mount(); await submit(); expect(text(render())).toContain("No se ha otorgado autoridad"); expect(text(render())).not.toContain("Cambio confirmado"); expect(mocks.refresh).not.toHaveBeenCalled();
 });
 it("storage corruption fails closed before submitting", async () => {
   vi.stubGlobal("sessionStorage",{getItem:()=>"corrupt"}); const send=vi.fn(); vi.stubGlobal("fetch",send); await mount(); await submit(); expect(send).not.toHaveBeenCalled(); expect(text(render())).toContain("operaciones están bloqueadas");
 });
});
