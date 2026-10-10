"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { z } from "zod";
import { completeAdminResultSchema, completeAdminSchema, prepareResultSchema } from "../../../../lib/platform/customer-contracts";
import { postPlatform } from "../../../../lib/platform/customer-journey";

const requestSchema = z.object({ key: z.uuid(), body: z.union([completeAdminSchema, z.object({ accountId: z.uuid(), scopeKind: z.literal("account"), schoolId: z.null(), cafeteriaId: z.null(), roleCode: z.literal("account_admin"), intendedEmail: z.email(), expiresAt: z.iso.datetime() }).strict()]) });
export function AdministratorAction({ accountId, intentId, actor }: { accountId: string; intentId?: string; actor: string }) {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [locked, setLocked] = useState(false);
  const [done, setDone] = useState(false);
  const pending = useRef(false);
  const storageKey = `pikas:initial-admin:v1:${actor}:${intentId ?? accountId}`;
  async function submit(recoverOnly = false) {
    if (pending.current || done) return;
    pending.current = true; setBusy(true); setMessage("");
    try {
      const saved = sessionStorage.getItem(storageKey);
      if (recoverOnly && saved === null) { setMessage("No hay una solicitud pendiente en este navegador."); return; }
      const body = saved ? requestSchema.parse(JSON.parse(saved)).body : intentId ? completeAdminSchema.parse({ intentId, displayName: value }) : requestSchema.shape.body.parse({ accountId, scopeKind: "account", schoolId: null, cafeteriaId: null, roleCode: "account_admin", intendedEmail: z.email().parse(value.trim()), expiresAt: new Date(Date.now() + 7 * 86400000).toISOString() });
      const request = saved ? requestSchema.parse(JSON.parse(saved)) : { key: crypto.randomUUID(), body };
      if ((intentId && (!("intentId" in request.body) || request.body.intentId !== intentId)) || (!intentId && (!("accountId" in request.body) || request.body.accountId !== accountId))) throw new Error("invalid_recovery");
      // A saved request is used exactly as written, irrespective of edits to display fields.
      sessionStorage.setItem(storageKey, JSON.stringify(request)); setLocked(true);
      const response = await postPlatform(intentId ? "/api/platform/customer-admins/complete" : "/api/platform/customer-admins/prepare", request.key, request.body);
      if (intentId) z.object({ result: completeAdminResultSchema }).parse(response);
      else z.object({ result: prepareResultSchema }).parse(response);
      sessionStorage.removeItem(storageKey); setDone(true);
      setMessage(intentId ? "Acceso de administrador otorgado a la identidad confirmada." : "Solicitud preparada. No se envió una invitación ni se otorgó acceso.");
      router.refresh();
    } catch (failure) {
      const reason = failure instanceof Error ? failure.message : "unavailable";
      setMessage(reason === "authorization" ? "No tienes permiso para completar esta operación." : reason === "conflict" ? "La solicitud encontró un conflicto. Actualiza el cliente para consultar su estado." : failure instanceof z.ZodError && !locked ? "Revisa el nombre o correo antes de continuar." : "No pudimos confirmar la operación. Verifica que la identidad esté registrada con correo confirmado y reintenta la misma solicitud; no prepares otra en paralelo.");
    } finally { pending.current = false; setBusy(false); }
  }
  return <form className="mt-4 space-y-3" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
    <label className="block">{intentId ? "Nombre del administrador" : "Correo del primer administrador"}<input className="field mt-1 w-full" required={!locked} disabled={locked || done} maxLength={intentId ? 200 : 254} type={intentId ? "text" : "email"} value={value} onChange={(event) => setValue(event.target.value)} /></label>
    <button className="btn" disabled={busy || done}>{busy ? "Procesando…" : locked ? "Reintentar la misma solicitud" : intentId ? "Verificar identidad y completar acceso" : "Preparar administrador"}</button>
    {!locked && !done && <button type="button" className="btn-outline ml-3" disabled={busy} onClick={() => void submit(true)}>Recuperar solicitud pendiente</button>}
    {message && <p role={done ? "status" : "alert"}>{message}</p>}
  </form>;
}
