import { statusLabel, type SupportStatus } from "../../../lib/support/contracts";

const tone: Record<SupportStatus, string> = { received: "bg-sky-50 text-sky-900", in_review: "bg-indigo-50 text-indigo-900", info_requested: "bg-amber-100 text-amber-950",
  resolved: "bg-emerald-50 text-emerald-900", closed: "bg-slate-100 text-slate-700" };
export const SupportStatusBadge = ({ status }: { status: SupportStatus }) => <span className={`rounded-full px-3 py-1 text-xs font-bold ${tone[status]}`}>{statusLabel[status]}</span>;
export const supportWhen = (at: string) => new Date(at).toLocaleString("es-DO", { timeZone: "America/Santo_Domingo", dateStyle: "medium", timeStyle: "short" });
