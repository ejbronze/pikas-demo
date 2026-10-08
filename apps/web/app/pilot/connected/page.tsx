import { redirect } from "next/navigation";
import { resolvePikasIdentity } from "@/lib/auth/pikas-context";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export default async function PilotConnectedPage() {
  const identity = await resolvePikasIdentity(
    await createSupabaseServerClient(),
  );

  if (identity.status === "unauthenticated") redirect("/login");
  if (identity.status === "unlinked") {
    return (
      <main className="mx-auto max-w-2xl p-8">
        <h1 className="text-2xl font-bold">Acceso pendiente de vinculación</h1>
        <p className="mt-3">
          La identidad de Auth existe, pero todavía no está vinculada a una
          Persona activa de PIKAS.
        </p>
      </main>
    );
  }
  if (identity.memberships.length === 0) {
    return (
      <main className="mx-auto max-w-2xl p-8">
        <h1 className="text-2xl font-bold">Acceso pendiente de autorización</h1>
        <p className="mt-3">
          La Persona no tiene membresías activas con acceso verificado por RLS.
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-2xl p-8">
      <p className="text-sm font-semibold uppercase tracking-wide text-emerald-700">
        Sesión verificada
      </p>
      <h1 className="mt-2 text-3xl font-bold">Conexión PIKAS Pilot</h1>
      <p className="mt-3">
        Hola, {identity.person.displayName}. Tu identidad Auth está vinculada a
        una Persona y tus membresías activas fueron comprobadas mediante RLS o
        una función autorizada.
      </p>
      <ul className="mt-6 space-y-2">
        {identity.memberships.map((membership) => (
          <li
            className="rounded-lg border p-3"
            key={`${membership.scopeKind}:${membership.id}`}
          >
            <span className="font-semibold">{membership.roleCode}</span>
            <span className="ml-2 text-slate-600">
              Alcance: {membership.scopeKind}
            </span>
          </li>
        ))}
      </ul>
      <form action="/api/auth/logout" method="post" className="mt-8">
        <button className="btn">Cerrar sesión</button>
      </form>
    </main>
  );
}
