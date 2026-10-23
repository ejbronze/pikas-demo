import { PikasLoader } from "@pikas/ui/mascot";
// The skeleton keeps the layout; LOAD-01 (PikasLoader) joins it only after a second of waiting.
export default function Loading(){return <main className="mx-auto max-w-6xl animate-pulse p-6" aria-label="Cargando"><PikasLoader className="mb-6" /><div className="h-9 w-64 rounded bg-slate-200"/><div className="mt-6 grid gap-4 md:grid-cols-2"><div className="h-56 rounded-3xl bg-slate-200"/><div className="h-56 rounded-3xl bg-slate-200"/></div></main>}
