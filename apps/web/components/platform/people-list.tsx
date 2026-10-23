"use client";
import { useState } from "react";
import { PersonSheet, type SheetActions } from "./person-sheet";
import { accessStatus, grantLabel, loginStatus, membershipStatusLabel, type AccessPerson } from "../../lib/platform/customer-access";

// Scannable rows; one person opens in the sheet. ?persona=<id> opens it on load (direct link); the
// parameter is dropped on close so a reload shows the list again.
const tone: Record<string, string> = { Activo: "bg-emerald-100 text-emerald-900", Suspendido: "bg-amber-100 text-amber-950", Inactivo: "bg-slate-200 text-slate-900" };
export function PeopleList({ people, customerName, identities, actions, openPerson }: { people: AccessPerson[]; customerName: string; identities: boolean; actions: SheetActions; openPerson: string | null }) {
  const [open, setOpen] = useState<string | null>(openPerson && people.some(p => p.person_id === openPerson) ? openPerson : null);
  const close = () => { setOpen(null); if (typeof window !== "undefined" && new URLSearchParams(window.location.search).has("persona")) { const url = new URL(window.location.href); url.searchParams.delete("persona"); window.history.replaceState(null, "", url.toString()); } };
  const current = open ? people.find(p => p.person_id === open) ?? null : null;
  return <>
    <ul className="divide-y rounded-xl border" aria-label="Usuarios con acceso">{people.map(person => { const access = accessStatus(person), login = loginStatus(person); return <li key={person.person_id} className="flex flex-wrap items-center justify-between gap-3 p-3">
      <div className="min-w-0 flex-1 basis-56">
        <p className="break-words font-bold">{person.display_name}</p>
        <ul className="mt-1 flex flex-wrap gap-1.5" aria-label={`Accesos de ${person.display_name}`}>{person.grants.map(g => <li key={g.membership_id} className={`chip max-w-full whitespace-normal break-words text-left ${g.status === "active" ? "bg-indigo-50 text-indigo-950" : "bg-slate-100 text-slate-600"}`}>{grantLabel(g)}{g.status !== "active" ? ` · ${g.status === "inactive" ? "Desactivado" : membershipStatusLabel(g.status)}` : ""}</li>)}</ul>
        <p className="mt-1 break-all text-sm text-slate-600">{[person.username && `Usuario ${person.username}`, person.email && !person.email.endsWith("@cajeros.pikas.invalid") ? person.email : person.email ? "Sin correo" : null].filter(Boolean).join(" · ") || "Sin usuario ni correo registrados"}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-sm"><span className={`chip ${tone[access]}`}>{access}</span><span className="chip bg-slate-100 text-slate-800">{login}</span>
        <button type="button" className="btn-secondary" onClick={() => setOpen(person.person_id)} aria-label={`Abrir ${person.display_name}`}>Abrir</button></div>
    </li>; })}</ul>
    {current && <PersonSheet person={current} customerName={customerName} identities={identities} actions={actions} onClose={close} />}
  </>;
}
