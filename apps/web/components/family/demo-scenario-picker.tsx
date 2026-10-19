"use client";
import { useRouter } from "next/navigation";
import { DEMO_SCENARIO_COOKIE } from "../../lib/family/demo-cookie";

// Demo mode only: switches between deterministic fictional scenarios to review every state.
export function DemoScenarioPicker({ options, current }: { options: Record<string, string>; current: string }) {
  const router = useRouter();
  return <div className="mb-4 flex flex-wrap items-center gap-2 rounded-2xl border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950">
    <label htmlFor="family-demo-scenario" className="w-full font-bold sm:w-auto">Escenario de demostración</label>
    <select id="family-demo-scenario" className="field min-h-11 w-auto min-w-0 flex-1 bg-white py-1" value={current}
      onChange={e => { document.cookie = `${DEMO_SCENARIO_COOKIE}=${encodeURIComponent(e.target.value)}; path=/; samesite=lax`; router.refresh(); }}>
      {Object.entries(options).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
    </select>
    <span className="basis-full text-xs">Datos ficticios. Las familias y estudiantes aún no tienen acceso conectado.</span>
  </div>;
}
