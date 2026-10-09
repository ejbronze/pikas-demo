import { redirect } from "next/navigation";
import {
  hasPlatformAuthority,
  resolvePikasIdentity,
} from "@/lib/auth/pikas-context";
import { loadSandboxLauncherState } from "@/lib/platform/sandbox-launcher";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { SandboxLauncher } from "./sandbox-launcher";

export default async function PlatformHomePage() {
  const supabase = await createSupabaseServerClient();
  const identity = await resolvePikasIdentity(supabase);

  if (identity.status === "unauthenticated") redirect("/backoffice/login");
  if (identity.status !== "ready") redirect("/backoffice/login?error=identity");
  if (!hasPlatformAuthority(identity) || !identity.platform) {
    redirect("/backoffice/login?error=platform");
  }

  const launcherState = await loadSandboxLauncherState(supabase, identity);

  return (
    <main className="mx-auto max-w-3xl p-8">
      <p className="text-sm font-semibold uppercase tracking-wide text-emerald-700">
        Platform context verified
      </p>
      <h1 className="mt-2 text-3xl font-bold">PIKAS Platform</h1>
      <p className="mt-3">
        Hola, {identity.person.displayName}. Tu identidad cuenta con autoridad de
        plataforma.
      </p>
      <p className="mt-3 text-slate-700">
        Esta sesión no incluye membresías ni acceso a datos de clientes.
      </p>
      <SandboxLauncher state={launcherState} />
      <h2 className="mt-8 text-lg font-semibold">Capacidades de plataforma</h2>
      <ul className="mt-3 space-y-2">
        {identity.platform.capabilities.map((capability) => (
          <li className="rounded-lg border p-3" key={capability}>
            {capability}
          </li>
        ))}
      </ul>
      <form action="/api/auth/logout" method="post" className="mt-8">
        <button className="btn">Cerrar sesión</button>
      </form>
    </main>
  );
}
