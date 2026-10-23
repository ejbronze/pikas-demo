import Link from "next/link";
import { invalidResponseCopy, stateCopy, type FailureKind } from "../lib/ux/state-classes";

// Shared states (Wave C, refined in UX 14). EmptyState is a legitimate zero result: nothing is wrong,
// it teaches what is missing and what to do next (role="status"; may carry a Phase 1 mascot).
// ErrorState is a failure classified by kind (see lib/ux/state-classes.ts): what happened, whether it
// is a problem, who owns the next step and what to do. Only a temporary failure is announced as an
// alert and offers Reintentar; permission, not-found, lifecycle, not-configured and validation states
// are calm, never retry for its own sake, and never carry a mascot. Neither renders data or zeros.
// Both carry their title as a heading so the state is reachable by heading navigation.
export function EmptyState({ title, description, action, illustration, hint }: { title: string; description?: React.ReactNode; action?: React.ReactNode; illustration?: React.ReactNode; hint?: React.ReactNode }) {
  return <div role="status" className={`card p-5${illustration ? " flex flex-wrap items-center gap-4" : ""}`}>
    {illustration && <div className="shrink-0" aria-hidden>{illustration}</div>}
    <div className="min-w-0 flex-1 basis-56"><h2 className="text-base font-bold">{title}</h2>
    {description && <p className="mt-1 text-sm text-slate-600">{description}</p>}
    {action && <div className="mt-3 flex flex-wrap gap-2">{action}</div>}
    {hint && <p className="mt-3 text-xs text-slate-500">{hint}</p>}</div>
  </div>;
}

const tone: Record<FailureKind, { card: string; title: string }> = {
  temporary: { card: "border-red-200", title: "text-red-800" },
  permission: { card: "border-amber-300", title: "text-amber-950" },
  lifecycle: { card: "border-amber-300", title: "text-amber-950" },
  not_found: { card: "border-slate-300", title: "" },
  not_configured: { card: "border-slate-300", title: "" },
  validation: { card: "border-slate-300", title: "" },
};

export function ErrorState({ kind = "temporary", title, description, retryHref, retry, action, secondary, hint }: {
  kind?: FailureKind;
  title?: string;
  description?: React.ReactNode;
  // Temporary failures: a Reintentar link (retryHref) or any retry control. Other kinds ignore
  // retryHref (retrying cannot change the answer) and should pass a contextual `action` instead.
  retryHref?: string; retry?: React.ReactNode;
  action?: React.ReactNode; secondary?: React.ReactNode;
  hint?: React.ReactNode;
}) {
  // A caller that names what failed keeps responsibility for the description; without a title, the
  // kind's default title and next step are used together.
  const copy = stateCopy[kind], text = description ?? (title === undefined ? copy.description : undefined);
  const primary = action ?? retry ?? (retryHref && kind === "temporary" ? <Link className="btn-secondary" href={retryHref}>Reintentar</Link> : null);
  return <div role={kind === "temporary" ? "alert" : "status"} data-kind={kind} className={`card p-5 ${tone[kind].card}`}>
    <h2 className={`text-base font-bold ${tone[kind].title}`}>{title ?? copy.title}</h2>
    {text && <p className="mt-1 text-sm text-slate-700">{text}</p>}
    {(primary || secondary) && <div className="mt-3 flex flex-wrap gap-2">{primary}{secondary}</div>}
    {hint && <p className="mt-3 text-xs text-slate-500">{hint}</p>}
  </div>;
}

// A failed read of a named thing ("el reporte de ventas", "esta sección"): the kind decides the title's
// verb and the next step. `invalidResponse` marks a response PIKAS received but could not read.
const loadTitles: Record<FailureKind, (what: string) => string> = {
  temporary: what => `No pudimos cargar ${what}.`, permission: what => `Tu rol no tiene acceso ${what.startsWith("el ") ? `al ${what.slice(3)}` : `a ${what}`}.`, not_found: what => `No encontramos ${what}.`,
  not_configured: what => `Falta configurar ${what}.`, lifecycle: what => `No está disponible ${what} por su estado actual.`, validation: what => `No pudimos cargar ${what} con esta solicitud.`,
};
export function LoadFailure({ kind = "temporary", what, invalidResponse = false, description, retryHref, action, hint }: {
  kind?: FailureKind; what: string; invalidResponse?: boolean; description?: React.ReactNode; retryHref?: string; action?: React.ReactNode; hint?: React.ReactNode;
}) {
  const invalid = invalidResponse && kind === "temporary";
  return <ErrorState kind={kind} title={invalid ? invalidResponseCopy.title : loadTitles[kind](what)} description={description ?? (invalid ? invalidResponseCopy.description : stateCopy[kind].description)}
    retryHref={retryHref} action={action} hint={hint} />;
}
