import { requirePlatform } from "@/lib/platform/customer-console";
import { demoLabSchema } from "../../../lib/platform/demo-lab";
import { DemoLab, DemoLabIntro } from "../../../components/platform/demo-lab";
import { AppPageHeader } from "../../../components/app-page-header";
import { ErrorState } from "../../../components/state-panels";

// Demo Lab (Platform). A sandbox is a real customer with tenant_kind='sandbox'; a persona opens through the
// UX 11 POV ("Abrir como…"). The read is authoritative: who may reset, which sandboxes and personas exist,
// and the operator's current Demo. Reachable while a Demo is active (it is the Demo home).
export default async function DemoLabPage() {
  const { supabase, identity, capabilities, demo } = await requirePlatform({ demo: "allow" });
  if (!capabilities.includes("platform:sandbox:pov:enter")) return <p role="alert">No tienes acceso al Demo.</p>;
  const response = await supabase.rpc("platform_demo_lab_read");
  const lab = response.error ? null : demoLabSchema.safeParse(response.data);
  return <>
    <AppPageHeader title="Demo Lab" description={<DemoLabIntro />} />
    <p className="text-sm text-slate-600">Sigues actuando como {identity.person.displayName}, operador de PIKAS. Lo que hagas dentro del Demo queda en la auditoría del sandbox con tu identidad real.</p>
    {!lab || !lab.success ? <ErrorState title="No pudimos cargar el Demo Lab." description="Actualiza la página para intentarlo de nuevo." />
      : <DemoLab sandboxes={lab.data.sandboxes} active={demo} canReset={lab.data.can_reset} operatorName={identity.person.displayName} />}
  </>;
}
