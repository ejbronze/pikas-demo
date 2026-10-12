"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ExitDemoButton } from "../app/platform/sandbox-launcher-actions";
import { experienceLabel, type SandboxPov } from "../lib/platform/sandbox-pov";

export function SandboxAdminContext({ pov }: { pov?: SandboxPov }) {
  const router = useRouter();
  const [expired, setExpired] = useState(false);
  useEffect(() => {
    if (!pov) return;
    const timer = setTimeout(() => { setExpired(true); router.replace("/platform/demostracion"); }, Math.max(0, Date.parse(pov.expires_at) - Date.now()));
    return () => clearTimeout(timer);
  }, [pov, router]);
  if (!pov) return null;
  return <aside role="status" className="border-b border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950">
    <p className="font-bold">Modo demostración · {experienceLabel[pov.pov_code]}</p>
    <p>Operador: {pov.operator_name} · {expired ? "Demostración vencida" : `Vence: ${new Date(pov.expires_at).toLocaleString("es-DO", { timeZone: "America/Santo_Domingo" })}`}</p>
    <div className="mt-2 flex flex-wrap items-center gap-3"><Link className="btn-secondary" href="/platform/demostracion">Volver a demostración / cambiar experiencia</Link><ExitDemoButton returnToPlatform /></div>
  </aside>;
}
