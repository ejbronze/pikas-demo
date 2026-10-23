import Link from "next/link";
import { z } from "zod";
import { customerOverviewSchema } from "../../../../lib/platform/customer-contracts";
import { readPlatform, requirePlatform } from "@/lib/platform/customer-console";
import { ColegioProfile, CustomerHierarchy, ReadFailure } from "../../console-views";
import { EmptyState, ErrorState } from "../../../../components/state-panels";
import { customerActivationStatusSchema } from "../../../../lib/platform/customer-activation";
import { CustomerLifecyclePanel } from "./lifecycle-panel";
import { AddLocationAction } from "./add-location-action";
import { EditProfileAction, RenameAction } from "./profile-actions";
import { CUSTOMER_PROFILE_MANAGE, PROFILE_EDITABLE_STATUSES } from "../../../../lib/platform/customer-profile";
import { CUSTOMER_ACCESS_READ, customerAccessSchema } from "../../../../lib/platform/customer-access";
import { CustomerAccessSection } from "./customer-access";
import { IDENTITY_SUPPORT_CAPABILITY } from "../../../../lib/identity/contracts";
import { CUSTOMER_ACCESS_PROVISION } from "../../../../lib/platform/customer-provisioning";
import { CUSTOMER_OPERATIONS_MANAGE, CUSTOMER_OPERATIONS_READ, supportCafeteriaReadSchema } from "../../../../lib/platform/customer-operations";
import { ADD_LOCATION_CAPABILITY } from "../../../../lib/platform/school-location";
import { LIFECYCLE_MANAGE, lifecycleHistorySchema } from "../../../../lib/platform/customer-lifecycle";
import { READINESS_CAPABILITY, readinessSchema } from "../../../../lib/platform/readiness";
import { CustomerOperationsEntry } from "../../../../components/platform/customer-operations-entry";
import { cafeteriaHref } from "../../../../components/platform/customer-operations";
import { CustomerContextBar } from "../../../../components/platform/customer-context";
import { SetupMap, type CafeteriaService } from "../../../../components/platform/customer-resumen";
import { InitialAdministrator } from "../../../../components/platform/initial-administrator";
import { activityLabel, customerActivity, isWorkspaceSection, workspaceHref, type WorkspaceSection } from "../../../../lib/platform/workspace";

const auditSchema = z.array(z.object({ id: z.uuid(), occurred_at: z.string(), action: z.string(), target_account_id: z.uuid().nullish(), actor_person_id: z.uuid().nullish(), outcome: z.string().nullish() }));
const when = (iso: string) => new Date(iso).toLocaleString("es-DO", { timeZone: "America/Santo_Domingo", dateStyle: "medium", timeStyle: "short" });

// Platform Operations & Support Console: the customer workspace. One route, sections by ?seccion=,
// the customer context persistent above them. Each section reads only what it shows; every read
// keeps its own capability and the database re-checks customer scope.
export default async function CustomerPage({ params, searchParams }: { params: Promise<{ accountId: string }>; searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requirePlatform();
  const id = z.guid().safeParse((await params).accountId);
  if (!id.success) return <ReadFailure kind="missing" />;
  const sp = (await searchParams) ?? {}, requested = typeof sp.seccion === "string" ? sp.seccion : "resumen", personParam = typeof sp.persona === "string" && z.guid().safeParse(sp.persona).success ? sp.persona : null;
  const result = await readPlatform(session, "platform:tenant:lifecycle:read", "platform_get_customer_overview", { p_account_id: id.data }, customerOverviewSchema);
  if (result.kind !== "ready") return <ReadFailure kind={result.kind} failure={result.failure} reason={"reason" in result ? result.reason : undefined} />;
  const customer = result.value, isCustomer = customer.tenant_kind === "customer", active = customer.account.status === "active";
  const can = (c: string) => session.capabilities.includes(c);
  const showAccess = isCustomer && can(CUSTOMER_ACCESS_READ), showOperations = isCustomer && can(CUSTOMER_OPERATIONS_READ), showActivity = can("platform:audit:read");
  const available: WorkspaceSection[] = ["resumen", "estructura", ...(isCustomer ? ["personas" as const] : []), ...(showOperations ? ["operacion" as const] : []), ...(showActivity ? ["actividad" as const] : []), ...(isCustomer ? ["estado" as const] : [])];
  const section: WorkspaceSection = isWorkspaceSection(requested) && available.includes(requested) ? requested : "resumen";
  // Launch readiness feeds the context bar on every section; the other reads belong to one section each.
  const readiness = isCustomer && can(READINESS_CAPABILITY) ? await readPlatform(session, READINESS_CAPABILITY, "platform_customer_readiness", { p_account_id: customer.account.id }, readinessSchema) : null;
  const launch = readiness?.kind === "ready" ? readiness.value?.customers?.find(c => c.account_id === customer.account.id) ?? null : null;
  const cafeterias = customer.schools.flatMap(s => s.locations.flatMap(l => l.cafeterias.map(c => ({ id: c.id, name: c.name, status: c.status, location: `${s.name} · ${l.name}`, school: s.name, place: l.name }))));
  const activeCafeterias = cafeterias.filter(c => c.status === "active");

  let body: React.ReactNode;
  if (section === "resumen") {
    // School-owned student service per active cafetería, from the support read's aggregate status (no students).
    const services: CafeteriaService[] | null = showOperations ? await Promise.all(activeCafeterias.slice(0, 8).map(async c => {
      const read = await readPlatform(session, CUSTOMER_OPERATIONS_READ, "platform_support_cafeteria_read", { p_account_id: customer.account.id, p_cafeteria_id: c.id }, supportCafeteriaReadSchema);
      return { id: c.id, name: c.name, location: c.place, school: c.school, status: read.kind === "ready" && read.value?.scope?.cafeteria_id === c.id ? read.value.student_service ?? null : null, read: read.kind === "ready" ? "ready" as const : "unavailable" as const };
    })) : null;
    body = <SetupMap customer={customer} launch={launch} readinessFailed={!!readiness && !launch} services={isCustomer ? services : null} />;
  } else if (section === "estructura") {
    const canEditProfile = isCustomer && PROFILE_EDITABLE_STATUSES.includes(customer.account.status) && can(CUSTOMER_PROFILE_MANAGE);
    body = <div className="space-y-5">
      <ColegioProfile customer={customer} action={canEditProfile ? (school) => <EditProfileAction accountId={customer.account.id} schoolId={school.id} renamesAccount={customer.schools.length === 1} accountName={customer.account.name}
        current={{ name: school.name, rnc: school.rnc ?? null, address: school.address ?? null, province: school.province ?? null }} /> : undefined} />
      <CustomerHierarchy customer={customer} schoolAction={isCustomer && active && can(ADD_LOCATION_CAPABILITY) ? (school) => school.status === "active" ? <AddLocationAction accountId={customer.account.id} schoolId={school.id} schoolName={school.name} /> : null : undefined}
        locationAction={canEditProfile ? (location) => <RenameAction accountId={customer.account.id} kind="location" targetId={location.id} currentName={location.name} /> : undefined}
        cafeteriaAction={canEditProfile ? (cafeteria) => <RenameAction accountId={customer.account.id} kind="cafeteria" targetId={cafeteria.id} currentName={cafeteria.name} /> : undefined}
        cafeteriaLink={showOperations ? (cafeteria) => <Link className="btn-tertiary" href={cafeteriaHref(customer.account.id, cafeteria.id)} aria-label={`Operación de ${cafeteria.name}`}>Operación</Link> : undefined} />
    </div>;
  } else if (section === "personas") {
    const canPrepare = isCustomer && active && can("platform:customer_admin:provision"), canComplete = canPrepare && can("platform:identity:link");
    const initialIntents = customer.administrator_intents.filter(i => i.role_code === "account_admin" && i.scope_kind === "account");
    const activation = await Promise.all(initialIntents.map(async intent => {
      if (!canPrepare || !["pending", "linked"].includes(intent.status)) return null;
      const read = await readPlatform(session, "platform:customer_admin:provision", "platform_customer_activation_status", { p_intent_id: intent.id }, customerActivationStatusSchema);
      return read.kind === "ready" && read.value.intent_id === intent.id && read.value.account_id === customer.account.id ? read.value : null;
    }));
    const access = showAccess ? await readPlatform(session, CUSTOMER_ACCESS_READ, "platform_customer_access_read", { p_account_id: customer.account.id }, customerAccessSchema) : null;
    const canProvision = isCustomer && can(CUSTOMER_ACCESS_PROVISION);
    // Caja options for one-step POS access come from the support read (operations:read), per active cafetería.
    const registers = canProvision && active && showOperations ? await Promise.all(activeCafeterias.map(async c => {
      const read = await readPlatform(session, CUSTOMER_OPERATIONS_READ, "platform_support_cafeteria_read", { p_account_id: customer.account.id, p_cafeteria_id: c.id }, supportCafeteriaReadSchema);
      return { id: c.id, name: c.name, location: c.place, registers: read.kind === "ready" ? (read.value?.registers ?? []).filter(r => r.status === "active").map(r => ({ id: r.id, name: r.name, code: r.code })) : [] };
    })) : activeCafeterias.map(c => ({ id: c.id, name: c.name, location: c.place, registers: [] }));
    body = <div className="space-y-5">
      {showAccess && <CustomerAccessSection access={access?.kind === "ready" && access.value?.account_id === customer.account.id ? access.value : null} identities={can(IDENTITY_SUPPORT_CAPABILITY)} openPerson={personParam} customerName={customer.account.name}
        actions={{ accountId: customer.account.id, provision: canProvision && active, rename: canProvision && PROFILE_EDITABLE_STATUSES.includes(customer.account.status), cafeterias: registers, staffAccess: canProvision && active && can(IDENTITY_SUPPORT_CAPABILITY) }} />}
      <InitialAdministrator customer={customer} intents={initialIntents} activation={activation} actor={session.identity.user.id} canPrepare={canPrepare} canComplete={canComplete} />
    </div>;
  } else if (section === "operacion") {
    body = <CustomerOperationsEntry accountId={customer.account.id} cafeterias={activeCafeterias.map(c => ({ id: c.id, name: c.name, location: c.location }))} canManage={can(CUSTOMER_OPERATIONS_MANAGE) && active} />;
  } else if (section === "actividad") {
    const audit = await readPlatform(session, "platform:audit:read", "platform_read_audit", { p_limit: 100 }, auditSchema);
    const events = audit.kind === "ready" ? customerActivity(audit.value, customer.account.id) : [];
    body = <section aria-labelledby="actividad-title" className="card space-y-3 p-5"><div><h2 id="actividad-title" className="text-lg font-bold">Actividad de plataforma</h2><p className="text-sm text-slate-600">Acciones de PIKAS sobre este cliente, de las últimas 100 registradas en la plataforma. No incluye la operación de la cafetería ni actividad del colegio.</p></div>
      {audit.kind !== "ready" ? <ErrorState title="No pudimos cargar la actividad de este cliente." description="Inténtalo de nuevo. Si continúa, vuelve a esta sección más tarde." retryHref={workspaceHref(customer.account.id, "actividad")} />
        : events.length === 0 ? <EmptyState title="Sin actividad de plataforma reciente para este cliente." description="Las acciones de PIKAS sobre el cliente aparecerán aquí." />
        : <ol className="divide-y rounded-xl border text-sm">{events.map(e => <li key={e.id} className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-3"><span className="font-bold">{activityLabel(e.action)}{e.outcome && e.outcome !== "success" ? <span className="font-normal text-slate-600"> · {e.outcome}</span> : null}</span><time className="text-slate-500">{when(e.occurred_at)}</time></li>)}</ol>}
    </section>;
  } else {
    const history = await readPlatform(session, "platform:tenant:lifecycle:read", "platform_customer_lifecycle_history", { p_account_id: customer.account.id }, lifecycleHistorySchema);
    body = <CustomerLifecyclePanel accountId={customer.account.id} name={customer.account.name} status={customer.account.status} canManage={can(LIFECYCLE_MANAGE)} history={history.kind === "ready" ? history.value.events : null} />;
  }
  return <div className="ws space-y-5">
    <CustomerContextBar accountId={customer.account.id} name={customer.account.name} code={customer.account.code} status={customer.account.status} kind={customer.tenant_kind} launch={launch} section={section} available={available} />
    {body}
  </div>;
}
