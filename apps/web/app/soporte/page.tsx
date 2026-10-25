import { createHash } from "node:crypto";
import Link from "next/link";
import { redirect } from "next/navigation";
import { PikasMascot } from "@pikas/ui/mascot";
import { BrandLogo } from "../../components/brand-logo";
import { ErrorState, LoadFailure } from "../../components/state-panels";
import { SupportReporter } from "../../components/support/support-reporter";
import { createSupabaseServerClient } from "../../lib/supabase/server";
import { pagePath, reporterContextSchema } from "../../lib/support/contracts";

// «Reportar un problema». Any signed-in customer staff member (Account / School / Cafetería admin, POS staff) reports
// from a scope they belong to and follows their own reports. The database decides who may report; a Demo POV never does.
export default async function SupportPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const from = pagePath(typeof params.desde === "string" ? params.desde : null);
  const back = from ?? "/pilot/connected";
  const client = await createSupabaseServerClient();
  const { data: auth } = await client.auth.getUser();
  if (!auth.user) redirect("/login?next=%2Fsoporte");
  const read = await client.rpc("support_reporter_context").then(r => r, () => ({ data: null, error: { code: "unavailable", message: "unavailable" } }));
  const parsed = reporterContextSchema.safeParse(read.data);
  const actor = createHash("sha256").update(`support:${auth.user.id}`).digest("hex").slice(0, 24);
  return <div className="min-h-screen bg-slate-50">
    <header className="flex h-14 items-center gap-3 border-b bg-white px-4 sm:px-6">
      <span className="rounded-xl bg-white p-1"><BrandLogo compact className="size-8" /></span>
      <p className="min-w-0 flex-1 truncate font-black">Soporte PIKAS</p>
      <Link className="btn-secondary" href={back}>Volver</Link>
    </header>
    <main className="mx-auto max-w-3xl space-y-5 p-4 sm:p-6">
      <div className="flex items-center gap-4">
        <PikasMascot id="SUP-01" size={96} className="hidden shrink-0 sm:block" />
        <div><h1 className="text-2xl font-black">Reportar un problema</h1>
          <p className="text-sm text-slate-600">Cuéntanos qué pasó. Soporte PIKAS revisa cada reporte y te responde aquí.</p></div>
      </div>
      {read.error?.message === "demo_mode_active"
        ? <ErrorState kind="permission" title="En Demo no se envían reportes." description="Sal de la Demo para reportar un problema real con tu propia cuenta." action={<Link className="btn-secondary" href="/platform/demostracion">Ir a Demo Lab</Link>} />
        : read.error || !parsed.success ? <LoadFailure what="tus reportes" invalidResponse={!read.error} retryHref={from ? `/soporte?desde=${encodeURIComponent(from)}` : "/soporte"} />
        : <SupportReporter actor={actor} scopes={parsed.data.scopes} tickets={parsed.data.tickets} pagePath={from} />}
    </main>
  </div>;
}
