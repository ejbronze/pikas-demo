import Link from "next/link";
import { z } from "zod";
import { readPlatform, requirePlatform } from "@/lib/platform/customer-console";
import { CUSTOMER_OPERATIONS_MANAGE, CUSTOMER_OPERATIONS_READ, operationsOverviewSchema, supportCafeteriaReadSchema } from "../../../../../../../lib/platform/customer-operations";
import { CafeteriaSwitcher, SectionNav, SupportContext, SupportProducts, SupportRegisters, SupportStaff, SupportSummary, sections, managementHref, cafeteriaHref, type Section } from "../../../../../../../components/platform/customer-operations";
import { CafeteriaTransactions } from "../../../../../../../components/cafeteria-transactions";
import { CafeteriaReports } from "../../../../../../../components/cafeteria-reports";
import { ErrorState } from "../../../../../../../components/state-panels";
import { ConnectedCafeteriaProvider } from "../../../../../../../components/connected-cafeteria-provider";
import { SupportCafeteriaManagement } from "../../../../../../../components/connected-cafeteria-pages";
import type { CafeteriaRead } from "../../../../../../../lib/cafeteria/contracts";

// Every read and bounded command goes through a platform_support_* wrapper that re-validates the
// real Platform actor, capability and explicit customer scope.
export default async function CustomerCafeteriaPage({ params, searchParams }: { params: Promise<{ accountId: string; cafeteriaId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requirePlatform();
  if (!session.capabilities.includes(CUSTOMER_OPERATIONS_READ)) return <ErrorState title="No tienes permiso para gestionar la operación de clientes." retry={<Link className="btn-secondary" href="/platform/clientes">Volver a Clientes</Link>} />;
  const raw = await params, account = z.guid().safeParse(raw.accountId), cafeteria = z.guid().safeParse(raw.cafeteriaId);
  const requested = (await searchParams).seccion, section: Section = sections.some(([k]) => k === requested) ? requested as Section : "resumen";
  const notFound = <ErrorState title="No encontramos esta cafetería para este cliente." retry={<Link className="btn-secondary" href={account.success ? managementHref(account.data) : "/platform/clientes"}>Ver cafeterías del cliente</Link>} />;
  if (!account.success || !cafeteria.success) return notFound;
  const [overview, read] = await Promise.all([
    readPlatform(session, CUSTOMER_OPERATIONS_READ, "platform_customer_operations_overview", { p_account_id: account.data }, operationsOverviewSchema),
    readPlatform(session, CUSTOMER_OPERATIONS_READ, "platform_support_cafeteria_read", { p_account_id: account.data, p_cafeteria_id: cafeteria.data }, supportCafeteriaReadSchema),
  ]);
  if (overview.kind !== "ready" || read.kind !== "ready") return overview.kind === "unavailable" || read.kind === "unavailable" ? <ErrorState title="No pudimos cargar la cafetería." retryHref={managementHref(account.data)} /> : notFound;
  const d = read.value, a = account.data, c = cafeteria.data;
  if (d.scope.account_id !== a || d.scope.cafeteria_id !== c) return notFound;
  const canManage=session.capabilities.includes(CUSTOMER_OPERATIONS_MANAGE)&&d.scope.account_status==="active";
  const current:Section=!canManage&&(["menus","turnos","configuracion"] as Section[]).includes(section)?"resumen":section;
  const managed=(view:'products'|'menus'|'shifts'|'registers'|'settings')=><ConnectedCafeteriaProvider data={d as CafeteriaRead} recoveryActorId={d.scope.actor_id} source={{endpoint:"/api/platform/customer-operations/cafeteria",accountId:a}}><SupportCafeteriaManagement section={view} data={d as CafeteriaRead}/></ConnectedCafeteriaProvider>;
  return <div className="space-y-5">
    <SupportContext accountId={a} accountName={d.scope.account_name} accountStatus={d.scope.account_status} cafeteriaName={`${d.scope.cafeteria_name} · ${d.scope.location_name}`} canManage={canManage} />
    <CafeteriaSwitcher overview={overview.value} accountId={a} selected={c} section={current} />
    <SectionNav accountId={a} cafeteriaId={c} current={current} canManage={canManage} />
    {current === "resumen" && <SupportSummary data={d} />}
    {current === "productos" && (canManage?managed("products"):<SupportProducts data={d} />)}
    {current === "menus" && canManage&&managed("menus")}
    {current === "turnos" && canManage&&managed("shifts")}
    {current === "configuracion" && canManage&&managed("settings")}
    {current === "cajas" && (canManage?managed("registers"):<SupportRegisters data={d} />)}
    {current === "personal" && <SupportStaff data={d} />}
    {current === "transacciones" && <CafeteriaTransactions cafeteriaId={c} sandbox={false} source={{ endpoint: "/api/platform/customer-operations/transactions", accountId: a }} />}
    {current === "reportes" && <CafeteriaReports cafeteriaId={c} sandbox={false} reconciliation source={{ endpoint: "/api/platform/customer-operations/reports", accountId: a }} cajasHref={cafeteriaHref(a, c, "cajas")} />}
  </div>;
}
