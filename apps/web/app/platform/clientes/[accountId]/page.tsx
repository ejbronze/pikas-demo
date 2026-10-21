import { z } from "zod";
import { customerOverviewSchema, statusLabel } from "../../../../lib/platform/customer-contracts";
import { readPlatform, requirePlatform } from "@/lib/platform/customer-console";
import { ColegioProfile, CustomerHeading, CustomerHierarchy, ReadFailure } from "../../console-views";
import { AdminStatus } from "../../../../components/admin-interactions";
import { CustomerActivationAction } from "./activation-action";
import { customerActivationStatusSchema } from "../../../../lib/platform/customer-activation";
import { AdministratorAction } from "./administrator-action";
import { CustomerLifecyclePanel } from "./lifecycle-panel";
import { AddLocationAction } from "./add-location-action";
import { EditProfileAction, RenameAction } from "./profile-actions";
import { CUSTOMER_PROFILE_MANAGE, PROFILE_EDITABLE_STATUSES } from "../../../../lib/platform/customer-profile";
import { CUSTOMER_ACCESS_READ, customerAccessSchema } from "../../../../lib/platform/customer-access";
import { CustomerAccessSection } from "./customer-access";
import { IDENTITY_SUPPORT_CAPABILITY } from "../../../../lib/identity/contracts";
import { CUSTOMER_ACCESS_PROVISION } from "../../../../lib/platform/customer-provisioning";
import Link from "next/link";
import { CUSTOMER_OPERATIONS_READ } from "../../../../lib/platform/customer-operations";
import { ADD_LOCATION_CAPABILITY } from "../../../../lib/platform/school-location";
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
  // Profile edits: customers only, active or suspended (closed stays read-only); the database re-checks.
  const canEditProfile = customer.tenant_kind === "customer" && PROFILE_EDITABLE_STATUSES.includes(customer.account.status) && session.capabilities.includes(CUSTOMER_PROFILE_MANAGE);
  // Usuarios y accesos: customers only, read-only, its own capability; a failed read stays contained.
  const showAccess = customer.tenant_kind === "customer" && session.capabilities.includes(CUSTOMER_ACCESS_READ);
  const canProvision = customer.tenant_kind === "customer" && session.capabilities.includes(CUSTOMER_ACCESS_PROVISION);
  const access = showAccess ? await readPlatform(session, CUSTOMER_ACCESS_READ, "platform_customer_access_read", { p_account_id: customer.account.id }, customerAccessSchema) : null;
  const hasCurrent = customer.administrators.length > 0 || customer.customer_admin_onboarding.some((intent) => intent.role === "account_admin" && intent.scope === "account" && intent.status === "granted") || initialIntents.some((intent) => ["pending", "linked", "granted"].includes(intent.status));
  return <>
    <CustomerHeading name={customer.account.name} code={customer.account.code} status={customer.account.status} kind={customer.tenant_kind} />
    <ColegioProfile customer={customer} action={canEditProfile ? (school) => <EditProfileAction accountId={customer.account.id} schoolId={school.id} renamesAccount={customer.schools.length === 1} accountName={customer.account.name}
      current={{ name: school.name, rnc: school.rnc ?? null, address: school.address ?? null, province: school.province ?? null }} /> : undefined} />
    {showAccess && <CustomerAccessSection access={access?.kind === "ready" && access.value.account_id === customer.account.id ? access.value : null} identities={session.capabilities.includes(IDENTITY_SUPPORT_CAPABILITY)}
      actions={{ accountId: customer.account.id, provision: canProvision && customer.account.status === "active", rename: canProvision && PROFILE_EDITABLE_STATUSES.includes(customer.account.status),
        cafeterias: customer.schools.flatMap(s => s.locations.flatMap(l => l.cafeterias.filter(c => c.status === "active").map(c => ({ id: c.id, name: c.name })))) }} />}
    {customer.tenant_kind === "customer" && session.capabilities.includes(CUSTOMER_OPERATIONS_READ) && <section aria-labelledby="ops-entry" className="card flex flex-wrap items-center justify-between gap-3 p-5">
      <div className="min-w-0 flex-1 basis-60"><h2 id="ops-entry" className="text-lg font-bold">Gestión del cliente</h2><p className="text-sm text-slate-600">Consulta sus cafeterías, productos, cajas, personal, transacciones y reportes como personal de PIKAS.</p></div>
      <Link className="btn" href={`/platform/clientes/${customer.account.id}/gestion`}>Administrar cliente</Link></section>}
    {customer.tenant_kind === "customer" && <CustomerLifecyclePanel accountId={customer.account.id} name={customer.account.name} status={customer.account.status}
      canManage={session.capabilities.includes(LIFECYCLE_MANAGE)} history={history?.kind === "ready" ? history.value.events : null} />}
    <CustomerHierarchy customer={customer} schoolAction={customer.tenant_kind === "customer" && customer.account.status === "active" && session.capabilities.includes(ADD_LOCATION_CAPABILITY)
      ? (school) => school.status === "active" ? <AddLocationAction accountId={customer.account.id} schoolId={school.id} schoolName={school.name} /> : null : undefined}
      locationAction={canEditProfile ? (location) => <RenameAction accountId={customer.account.id} kind="location" targetId={location.id} currentName={location.name} /> : undefined}
      cafeteriaAction={canEditProfile ? (cafeteria) => <RenameAction accountId={customer.account.id} kind="cafeteria" targetId={cafeteria.id} currentName={cafeteria.name} /> : undefined} />
    <section className="card space-y-3 p-5"><h2 className="text-lg font-bold">Administrador inicial</h2>
      {customer.administrators.map((admin, index) => <p key={index}>{admin.display_name} · Acceso completado · {statusLabel[admin.status]} · Persona {statusLabel[admin.person_status]?.toLowerCase()}</p>)}
      {initialIntents.length === 0 && customer.administrators.length === 0 && <p>No hay solicitudes de administrador inicial visibles.</p>}
      {initialIntents.map((intent, index) => <article className="rounded-lg border p-4" key={intent.id}>
        <p className="font-semibold">{intent.display_name ?? intent.email}</p><p className="break-all">{intent.email}</p><div className="mt-2 flex flex-wrap gap-2">{intent.status === "pending" && <AdminStatus label="Acceso preparado" />}<AdminStatus label={intent.status === "pending" ? activationStates[index]?.identity_state === "ready" ? "Listo para completar" : "Activación pendiente" : intent.status === "linked" ? "Listo para completar" : intent.status === "granted" ? "Acceso completado" : statusLabel[intent.status]} /></div>
        {["pending", "linked"].includes(intent.status) && <><p className="mt-2 text-sm text-slate-600">Genera un enlace privado para que la persona active su identidad y guarde su contraseña. El enlace vence en una hora: entrégalo cuando la persona pueda usarlo. No se envía correo. Después completa este mismo acceso preparado. La solicitud vence el {new Date(intent.expires_at).toLocaleDateString("es-DO", { timeZone: "America/Santo_Domingo" })}.</p>
          {canComplete && customer.administrators.length === 0 && !initialIntents.some(other => other.status === "granted") && <CustomerActivationAction intentId={intent.id} status={activationStates[index]} />}
          {canComplete && customer.administrators.length === 0 && !initialIntents.some((other) => other.status === "granted") && <AdministratorAction actor={session.identity.user.id} accountId={customer.account.id} intentId={intent.id} identityReady={activationStates[index]?.identity_state === "ready"} intendedName={intent.intended_display_name} />}</>}
      </article>)}
      {canPrepare && !hasCurrent && <><p>Prepara el correo del primer administrador. Después genera su enlace privado de activación. Preparar no concede acceso.</p><AdministratorAction actor={session.identity.user.id} accountId={customer.account.id} /></>}
    </section>
    {customer.tenant_kind === "customer" && customer.account.status !== "active" && <p className="text-sm text-slate-600">Mientras el cliente no esté activo no se preparan nuevos accesos.</p>}
  </>;
}
