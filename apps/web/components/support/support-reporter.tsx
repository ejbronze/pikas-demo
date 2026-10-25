"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { sessionFetch } from "../../lib/auth/session-fetch";
import { EmptyState } from "../state-panels";
import { categories, categoryLabel, eventLabel, looksLikeSecret, reporterResultSchema, scopeLabel, statusLabel, supportMessage,
  type ReporterCommand, type ReporterTicket, type SupportScope } from "../../lib/support/contracts";

// The exact request (key + body) is kept until PIKAS answers, so a retry can only replay it (never a second ticket).
type Pending = { key: string; body: ReporterCommand };
const journalKey = (actor: string, target: string) => `pikas:support:${actor}:${target}`;
const load = (actor: string, target: string): Pending | null => { try { const raw = sessionStorage.getItem(journalKey(actor, target)); return raw ? JSON.parse(raw) as Pending : null; } catch { return null; } };
const when = (at: string) => new Date(at).toLocaleString("es-DO", { timeZone: "America/Santo_Domingo", dateStyle: "medium", timeStyle: "short" });
const tone: Record<ReporterTicket["status"], string> = { received: "bg-sky-50 text-sky-900", in_review: "bg-indigo-50 text-indigo-900", info_requested: "bg-amber-100 text-amber-950",
  resolved: "bg-emerald-50 text-emerald-900", closed: "bg-slate-100 text-slate-700" };
const scopeKey = (s: SupportScope) => [s.account_id, s.school_id ?? "", s.cafeteria_id ?? ""].join(":");

type Outcome = { kind: "idle" } | { kind: "pending" } | { kind: "rejected"; text: string } | { kind: "uncertain" };
function useSend(actor: string, target: string, onDone: (reference: string) => void) {
  const [pending, setPending] = useState<Pending | null>(null), [outcome, setOutcome] = useState<Outcome>({ kind: "idle" });
  const inFlight = useRef(false);
  useEffect(() => { let alive = true; queueMicrotask(() => { if (alive) { const p = load(actor, target); setPending(p); if (p) setOutcome({ kind: "uncertain" }); } }); return () => { alive = false; }; }, [actor, target]);
  const send = async (body: ReporterCommand | null) => {
    if (inFlight.current) return;
    const outgoing = pending ?? (body ? { key: crypto.randomUUID(), body } : null);
    if (!outgoing) return;
    try { sessionStorage.setItem(journalKey(actor, target), JSON.stringify(outgoing)); } catch { setOutcome({ kind: "rejected", text: "No se pudo preparar el envío. No se envió." }); return; }
    setPending(outgoing); inFlight.current = true; setOutcome({ kind: "pending" });
    try {
      const response = await sessionFetch("/api/support", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": outgoing.key }, body: JSON.stringify(outgoing.body) });
      let payload: { result?: unknown; error?: string } = {};
      try { payload = await response.json(); } catch { /* uncertain */ }
      const parsed = reporterResultSchema.safeParse(payload.result);
      if (response.ok && parsed.success) { sessionStorage.removeItem(journalKey(actor, target)); setPending(null); setOutcome({ kind: "idle" }); onDone(parsed.data.reference); return; }
      if ([400, 401, 403, 409, 422].includes(response.status)) { sessionStorage.removeItem(journalKey(actor, target)); setPending(null); setOutcome({ kind: "rejected", text: supportMessage(payload.error) }); return; }
      setOutcome({ kind: "uncertain" });
    } catch { setOutcome({ kind: "uncertain" }); }
    finally { inFlight.current = false; }
  };
  return { pending, outcome, send, setOutcome };
}

function Uncertain({ onRetry }: { onRetry: () => void }) {
  return <div role="alert" className="space-y-2 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
    <p className="font-bold">No sabemos si el envío llegó.</p><p>Reintenta el mismo envío: PIKAS no lo duplicará.</p>
    <button type="button" className="btn" onClick={onRetry}>Reintentar el mismo envío</button></div>;
}

export function SupportReporter({ actor, scopes, tickets, pagePath }: { actor: string; scopes: SupportScope[]; tickets: ReporterTicket[]; pagePath: string | null }) {
  const router = useRouter();
  const [notice, setNotice] = useState("");
  const [scope, setScope] = useState(scopes[0] ? scopeKey(scopes[0]) : ""), [category, setCategory] = useState(""), [subject, setSubject] = useState(""), [description, setDescription] = useState("");
  const [problem, setProblem] = useState("");
  const { pending, outcome, send, setOutcome } = useSend(actor, "new", reference => {
    setSubject(""); setDescription(""); setCategory(""); setNotice(`Recibimos tu reporte ${reference}. Te responderemos aquí.`); router.refresh();
  });
  const submit = (event: React.FormEvent) => {
    event.preventDefault(); setNotice(""); setOutcome({ kind: "idle" });
    const chosen = scopes.find(s => scopeKey(s) === scope);
    if (!chosen) { setProblem("Elige dónde ocurre el problema."); return; }
    if (!category) { setProblem("Elige una categoría."); return; }
    if (subject.trim().length < 3) { setProblem("Escribe un asunto (al menos 3 caracteres)."); return; }
    if (description.trim().length < 10) { setProblem("Describe el problema (al menos 10 caracteres)."); return; }
    if (looksLikeSecret(`${subject} ${description}`)) { setProblem(supportMessage("support_secret_detected")); return; }
    setProblem("");
    void send({ operation: "create", account_id: chosen.account_id, school_id: chosen.school_id, cafeteria_id: chosen.cafeteria_id, category: category as typeof categories[number],
      subject: subject.trim(), description: description.trim(), page_path: pagePath });
  };
  const busy = outcome.kind === "pending";
  return <div className="space-y-5">
    {notice && <p role="status" className="card p-4 font-bold">{notice}</p>}
    {scopes.length === 0
      ? <EmptyState title="No tienes un colegio o cafetería activos desde donde reportar." description="Si no puedes entrar a tu cuenta o perdiste el acceso, escribe al contacto de Soporte PIKAS que te dio tu administrador." />
      : pending ? <section className="card space-y-3 p-5" aria-label="Envío pendiente">
          <h2 className="text-lg font-bold">Reporte sin confirmar</h2><p className="text-sm">«{pending.body.operation === "create" ? pending.body.subject : "Respuesta"}»</p>
          {outcome.kind === "pending" ? <p role="status" className="text-sm">Enviando…</p> : <Uncertain onRetry={() => void send(null)} />}</section>
      : <form className="card space-y-4 p-5" onSubmit={submit} noValidate aria-labelledby="nuevo-reporte">
          <h2 id="nuevo-reporte" className="text-lg font-bold">Nuevo reporte</h2>
          {scopes.length > 1 && <label className="block font-bold">Dónde ocurre<select className="field mt-1 w-full" value={scope} onChange={e => setScope(e.target.value)}>
            {scopes.map(s => <option key={scopeKey(s) + s.role} value={scopeKey(s)}>{scopeLabel(s)}</option>)}</select></label>}
          <label className="block font-bold">Categoría<select className="field mt-1 w-full" value={category} onChange={e => setCategory(e.target.value)}>
            <option value="">Elige una categoría</option>{categories.map(c => <option key={c} value={c}>{categoryLabel[c]}</option>)}</select></label>
          <label className="block font-bold">Asunto<input className="field mt-1 w-full" maxLength={140} autoComplete="off" value={subject} onChange={e => setSubject(e.target.value)} /></label>
          <label className="block font-bold">Qué pasó<textarea className="field mt-1 min-h-32 w-full" maxLength={4000} autoComplete="off" value={description} onChange={e => setDescription(e.target.value)}
            aria-describedby="reporte-ayuda" /></label>
          <p id="reporte-ayuda" className="text-sm text-slate-600">Incluye qué hacías, qué esperabas y qué viste. <strong>Nunca escribas contraseñas, códigos de acceso ni datos de tarjetas.</strong> Las capturas de pantalla todavía no se pueden adjuntar.</p>
          {pagePath && <p className="text-xs text-slate-500">Se incluirá la página desde donde llegaste: {pagePath}</p>}
          {problem && <p role="alert" className="text-sm font-bold text-red-800">{problem}</p>}
          {outcome.kind === "rejected" && <p role="alert" className="text-sm font-bold text-red-800">{outcome.text}</p>}
          <button className="btn" disabled={busy}>{busy ? "Enviando…" : "Enviar reporte"}</button>
        </form>}
    <section aria-labelledby="mis-reportes" className="space-y-3">
      <h2 id="mis-reportes" className="text-lg font-bold">Mis reportes <span className="text-slate-500">({tickets.length})</span></h2>
      {tickets.length === 0 ? <p className="card p-5 text-sm">Todavía no has enviado reportes.</p>
        : <ul className="space-y-3">{tickets.map(t => <TicketCard key={t.id} actor={actor} ticket={t} />)}</ul>}
    </section>
  </div>;
}

function TicketCard({ actor, ticket }: { actor: string; ticket: ReporterTicket }) {
  const router = useRouter();
  const [body, setBody] = useState(""), [problem, setProblem] = useState(""), [notice, setNotice] = useState("");
  const { pending, outcome, send } = useSend(actor, ticket.id, () => { setBody(""); setNotice("Respuesta enviada."); router.refresh(); });
  const reply = (event: React.FormEvent) => {
    event.preventDefault(); setNotice("");
    if (!body.trim()) { setProblem("Escribe tu respuesta."); return; }
    if (looksLikeSecret(body)) { setProblem(supportMessage("support_secret_detected")); return; }
    setProblem(""); void send({ operation: "reply", ticket_id: ticket.id, body: body.trim() });
  };
  return <li className="card space-y-3 p-5">
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div className="min-w-0"><p className="text-xs font-bold text-slate-500">{ticket.reference} · {categoryLabel[ticket.category]} · {scopeLabel(ticket.scope)}</p>
        <h3 className="break-words font-bold">{ticket.subject}</h3></div>
      <span className={`rounded-full px-3 py-1 text-xs font-bold ${tone[ticket.status]}`}>{statusLabel[ticket.status]}</span>
    </div>
    {ticket.status === "info_requested" && <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-950">Soporte PIKAS necesita más información. Responde abajo.</p>}
    <details><summary className="inline-flex min-h-11 cursor-pointer items-center text-sm font-bold text-teal-800">Ver conversación</summary>
      <ol className="mt-2 space-y-3 border-l-2 border-slate-200 pl-4">
        <li><p className="text-xs text-slate-500">{when(ticket.created_at)} · Reporte enviado</p><p className="whitespace-pre-wrap break-words text-sm">{ticket.description}</p></li>
        {ticket.events.filter(e => e.kind !== "created").map((e, i) => <li key={i}><p className="text-xs text-slate-500">{when(e.created_at)} · {e.author} · {eventLabel[e.kind] ?? e.kind}</p>
          {e.body && <p className="whitespace-pre-wrap break-words text-sm">{e.body}</p>}</li>)}
      </ol></details>
    {notice && <p role="status" className="text-sm font-bold">{notice}</p>}
    {ticket.status !== "closed" && (pending ? (outcome.kind === "pending" ? <p role="status" className="text-sm">Enviando…</p> : <Uncertain onRetry={() => void send(null)} />)
      : <form className="space-y-2" onSubmit={reply} noValidate>
          <label className="block text-sm font-bold">{ticket.status === "info_requested" ? "Tu respuesta" : "Agregar detalle"}
            <textarea className="field mt-1 w-full" maxLength={4000} autoComplete="off" value={body} onChange={e => setBody(e.target.value)} /></label>
          {problem && <p role="alert" className="text-sm font-bold text-red-800">{problem}</p>}
          {outcome.kind === "rejected" && <p role="alert" className="text-sm font-bold text-red-800">{outcome.text}</p>}
          <button className="btn-secondary">Enviar respuesta</button>
        </form>)}
  </li>;
}
