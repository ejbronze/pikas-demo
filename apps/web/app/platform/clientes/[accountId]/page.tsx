import Link from "next/link";
import { z } from "zod";
import { customerOverviewSchema, statusLabel } from "../../../../lib/platform/customer-contracts";
import { readPlatform, requirePlatform } from "@/lib/platform/customer-console";
import { CustomerHeading, CustomerHierarchy, ReadFailure } from "../../console-views";
import { AdministratorAction } from "./administrator-action";
export default async function CustomerPage({ params }: { params: Promise<{ accountId: string }> }) {
  const session = await requirePlatform();
  const id = z.uuid().safeParse((await params).accountId);
  if (!id.success) return <ReadFailure kind="missing" />;
  const result = await readPlatform(session, "platform:tenant:lifecycle:read", "platform_get_customer_overview", { p_account_id: id.data }, customerOverviewSchema);
  if (result.kind !== "ready") return <ReadFailure kind={result.kind} />;
  const customer = result.value;
  const canPrepare = customer.tenant_kind === "customer" && customer.account.status === "active" && session.capabilities.includes("platform:customer_admin:provision");
  const canComplete = canPrepare && session.capabilities.includes("platform:identity:link");
  const initialIntents = customer.administrator_intents.filter((intent) => intent.role_code === "account_admin" && intent.scope_kind === "account");
  const hasCurrent = customer.administrators.length > 0 || customer.customer_admin_onboarding.some((intent) => intent.role === "account_admin" && intent.scope === "account" && intent.status === "granted") || initialIntents.some((intent) => ["pending", "linked", "granted"].includes(intent.status));
  return <><Link className="text-emerald-700 underline" href="/platform/clientes">Volver a clientes</Link>
    <CustomerHeading name={customer.account.name} code={customer.account.code} status={customer.account.status} kind={customer.tenant_kind} />
    <CustomerHierarchy customer={customer} />
    <section className="card space-y-3 p-5"><h2 className="text-lg font-bold">Administrador inicial</h2>
      {customer.administrators.map((admin, index) => <p key={index}>{admin.display_name} · {statusLabel[admin.status]} · Persona {statusLabel[admin.person_status]?.toLowerCase()}</p>)}
      {initialIntents.length === 0 && customer.administrators.length === 0 && <p>No hay solicitudes de administrador inicial visibles.</p>}
      {initialIntents.map((intent) => <article className="rounded-lg border p-4" key={intent.id}>
        <p className="font-semibold">{intent.display_name ?? intent.email}</p><p>{intent.email} · {statusLabel[intent.status]}</p>
        {["pending", "linked"].includes(intent.status) && <><p className="mt-2 text-sm text-slate-600">No enviamos invitaciones desde esta pantalla. La persona debe establecer y confirmar su identidad antes de otorgar acceso. La solicitud vence el {new Date(intent.expires_at).toLocaleDateString("es-DO", { timeZone: "America/Santo_Domingo" })}.</p>
          {canComplete && customer.administrators.length === 0 && !initialIntents.some((other) => other.status === "granted") && <AdministratorAction actor={session.identity.user.id} accountId={customer.account.id} intentId={intent.id} />}</>}
      </article>)}
      {canPrepare && !hasCurrent && <><p>Prepara el correo del primer administrador. El registro y la entrega de invitaciones requieren configuración externa; preparar no concede acceso.</p><AdministratorAction actor={session.identity.user.id} accountId={customer.account.id} /></>}
    </section>
    <p className="text-sm text-slate-600">Los estados se muestran tal como están registrados. La gestión de cambios de estado y los portales del cliente se conectarán en los siguientes pasos.</p>
  </>;
}
