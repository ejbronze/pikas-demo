import type { SandboxLauncherState } from "@/lib/platform/sandbox-launcher";
import {
  EnterCashierButton,
  ExitDemoButton,
} from "./sandbox-launcher-actions";

export function SandboxLauncher({ state }: { state: SandboxLauncherState }) {
  if (state.kind === "hidden") return null;

  if (state.kind === "active") {
    const { active } = state;
    return (
      <section
        aria-labelledby="demo-title"
        className="mt-8 rounded-2xl border-2 border-amber-400 bg-amber-50 p-5"
      >
        <span className="chip bg-amber-200 text-amber-900">Modo demostración</span>
        <h2 id="demo-title" className="mt-3 text-lg font-bold">
          Demostración activa
        </h2>
        <p className="mt-2 text-slate-700">Estás demostrando PIKAS como</p>
        <p className="text-2xl font-bold">{active.personaName} · Cajero</p>
        <p className="mt-1 text-slate-700">
          {active.accountName} · {active.cafeteriaName}
        </p>
        <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-start">
          <div>
            <button
              className="btn w-full sm:w-auto"
              disabled
              aria-describedby="pos-pending"
            >
              Abrir POS
            </button>
            <p id="pos-pending" className="mt-1 text-xs text-slate-600">
              Conexión POS pendiente
            </p>
          </div>
          <ExitDemoButton />
        </div>
      </section>
    );
  }

  return (
    <section aria-labelledby="demo-title" className="mt-8">
      <h2 id="demo-title" className="text-lg font-semibold">
        Demostración
      </h2>
      {state.kind === "unavailable" ? (
        <p className="mt-3 rounded-lg border p-4 text-slate-700">
          No pudimos cargar las demostraciones. Actualiza la página para
          intentarlo de nuevo.
        </p>
      ) : state.targets.length === 0 ? (
        <p className="mt-3 rounded-lg border p-4 text-slate-700">
          Todavía no hay demostraciones disponibles para ti.
        </p>
      ) : (
        <ul className="mt-3 space-y-3">
          {state.targets.map((target) => (
            <li
              className="card p-5"
              key={target.accountId + ":" + target.cafeteriaId}
            >
              <p className="text-lg font-bold">{target.accountName}</p>
              <p className="text-slate-700">{target.cafeteriaName}</p>
              <p className="mt-1 text-slate-700">{target.personaName} · Cajero</p>
              <div className="mt-4">
                <EnterCashierButton
                  accountId={target.accountId}
                  cafeteriaId={target.cafeteriaId}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
