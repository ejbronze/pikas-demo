import { z } from "zod";
import { customerOverviewSchema, statusLabel } from "../../../../lib/platform/customer-contracts";
import { readPlatform, requirePlatform } from "@/lib/platform/customer-console";
import { CustomerHeading, CustomerHierarchy, ReadFailure } from "../../console-views";
import { AdminStatus } from "../../../../components/admin-interactions";
import { CustomerActivationAction } from "./activation-action";
import { customerActivationStatusSchema } from "../../../../lib/platform/customer-activation";
import { AdministratorAction } from "./administrator-action";
import { CustomerLifecyclePanel } from "./lifecycle-panel";
import { LIFECYCLE_MANAGE, lifecycleHistorySchema } from "../../../../lib/platform/customer-lifecycle";
export default async function CustomerPage({ params }: { params: Promise<{ accountId: string }> }) {
  const session = await requirePlatform();
  const id = z.guid().safeParse((await params).accountId);
  if (!id.success) return <ReadFailure kind="missing" />;
  const result = await readPlatform(session, "platform:tenant:lifecycle:read", "platform_get_customer_overview", { p_account_id: id.data }, customerOverviewSchema);
  if (result.kind !== "ready") return <ReadFailure kind={result.kind} />;
  const customer = result.value;
  const canPrepare = customer.tenant_kind === "customer" && customer.account.status === "active" && session.capabilities.includes("platform:customer_admin:provision");
  const canComplete = canPrepare && session.capabilities.includes("platform:identity:link");
  const initialIntents = customer.administrator_intents.filter((intent) => intent.role_code === "account_admin" && intent.scope_kind === "account");
  const activationStates = await Promise.all(initialIntents.map(async intent => {
    if (!canPrepare || !["pending", "linked"].includes(intent.status)) return null;
    const read = await readPlatform(session, "platform:customer_admin:provision", "platform_customer_activation_status", { p_intent_id: intent.id }, customerActivationStatusSchema);
    return read.kind === "ready" && read.value.intent_id === intent.id && read.value.account_id === customer.account.id ? read.value : null;
  }));
  const history = customer.tenant_kind === "customer" ? await readPlatform(session, "platform:tenant:lifecycle:read", "platform_customer_lifecycle_history", { p_account_id: customer.account.id }, lifecycleHistorySchema) : null;
  const hasCurrent = customer.administrators.length > 0 || customer.customer_admin_onboarding.some((intent) => intent.role === "account_admin" && intent.scope === "account" && intent.status === "granted") || initialIntents.some((intent) => ["pending", "linked", "granted"].includes(intent.status));
  return <>
    <CustomerHeading name={customer.account.name} code={customer.account.code} status={customer.account.status} kind={customer.tenant_kind} />
    {customer.tenant_kind === "customer" && <CustomerLifecyclePanel accountId={customer.account.id} name={customer.account.name} status={customer.account.status}
      canManage={session.capabilities.includes(LIFECYCLE_MANAGE)} history={history?.kind === "ready" ? history.value.events : null} />}
    <CustomerHierarchy customer={customer} />
    <section className="card space-y-3 p-5"><h2 className="text-lg font-bold">Administrador inicial</h2>
      {customer.administrators.map((admin, index) => <p key={index}>{admin.display_name} · Acceso completado · {statusLabel[admin.status]} · Persona {statusLabel[admin.person_status]?.toLowerCase()}</p>)}
      {initialIntents.length === 0 && customer.administrators.length === 0 && <p>No hay solicitudes de administrador inicial visibles.</p>}
      {initialIntents.map((intent, index) => <article className="rounded-lg border p-4" key={intent.id}>
        <p className="font-semibold">{intent.display_name ?? intent.email}</p><p className="break-all">{intent.email}</p><div className="mt-2 flex flex-wrap gap-2">{intent.status === "pending" && <AdminStatus label="Acceso preparado" />}<AdminStatus label={intent.status === "pending" ? activationStates[index]?.identity_state === "ready" ? "Listo para completar" : "Activación pendiente" : intent.status === "linked" ? "Listo para completar" : intent.status === "granted" ? "Acceso completado" : statusLabel[intent.status]} /></div>
        {["pending", "linked"].includes(intent.status) && <><p className="mt-2 text-sm text-slate-600">Genera un enlace privado para que la persona active su identidad y guarde su contraseña. No se envía correo. Después completa este mismo acceso preparado. La solicitud vence el {new Date(intent.expires_at).toLocaleDateString("es-DO", { timeZone: "America/Santo_Domingo" })}.</p>
          {canComplete && customer.administrators.length === 0 && !initialIntents.some(other => other.status === "granted") && <CustomerActivationAction intentId={intent.id} status={activationStates[index]} />}
          {canComplete && customer.administrators.length === 0 && !initialIntents.some((other) => other.status === "granted") && <AdministratorAction actor={session.identity.user.id} accountId={customer.account.id} intentId={intent.id} identityReady={activationStates[index]?.identity_state === "ready"} />}</>}
      </article>)}
      {canPrepare && !hasCurrent && <><p>Prepara el correo del primer administrador. Después genera su enlace privado de activación. Preparar no concede acceso.</p><AdministratorAction actor={session.identity.user.id} accountId={customer.account.id} /></>}
    </section>
    {customer.tenant_kind === "customer" && customer.account.status !== "active" && <p className="text-sm text-slate-600">Mientras el cliente no esté activo no se preparan nuevos accesos.</p>}
  </>;
}
