"use client";
import { useRef } from "react";
import { demoExperiences, demoLabel, type DemoExperience } from "../lib/platform/demo-experiences";
import type { SandboxPovCode } from "../lib/platform/sandbox-pov";
export function DemoPersonaSwitcher({ current, disabled, onSwitch }: { current: SandboxPovCode; disabled: boolean; onSwitch: (experience: DemoExperience) => void }) {
  const details = useRef<HTMLDetailsElement>(null);
  return <details ref={details} className="relative" onKeyDown={e => {
    if (e.key === "Escape" && details.current) { details.current.open = false; details.current.querySelector("summary")?.focus(); }
  }}>
    <summary aria-label={`Cambiar experiencia: ${demoLabel(current)}`} className="flex min-h-11 cursor-pointer list-none items-center gap-1 px-2 font-bold">{demoLabel(current)} <span aria-hidden>▾</span></summary>
    <div className="absolute left-0 top-full z-50 w-56 rounded-xl border border-amber-300 bg-white p-2 text-slate-900 shadow-xl">
      <p className="px-3 py-2 text-xs font-bold uppercase">Cambiar experiencia</p>
      {demoExperiences.map(e => <button key={e.experience} className="flex min-h-11 w-full items-center rounded-lg px-3 text-left hover:bg-amber-50 disabled:opacity-50" disabled={disabled || current === e.code} onClick={() => { if (details.current) details.current.open = false; onSwitch(e.experience); }}>{e.label}{current === e.code ? " · Actual" : ""}</button>)}
      <p className="px-3 py-2 text-sm text-slate-500">Padre · Próximamente</p>
      <p className="px-3 py-2 text-sm text-slate-500">Estudiante · Próximamente</p>
    </div>
  </details>;
}
