import Link from "next/link";
import { z } from "zod";
import { readPlatform, requirePlatform } from "@/lib/platform/customer-console";
import { CUSTOMER_OPERATIONS_READ, operationsOverviewSchema, supportCafeteriaReadSchema } from "../../../../../../../lib/platform/customer-operations";
import { CafeteriaSwitcher, SectionNav, SupportContext, SupportProducts, SupportRegisters, SupportStaff, SupportSummary, sections, managementHref, cafeteriaHref, type Section } from "../../../../../../../components/platform/customer-operations";
import { CafeteriaTransactions } from "../../../../../../../components/cafeteria-transactions";
import { CafeteriaReports } from "../../../../../../../components/cafeteria-reports";
import { ErrorState } from "../../../../../../../components/state-panels";

// Backoffice Customer Management: one cafeteria of one customer, read-only. Every read goes through
// the platform_support_* wrappers, which re-validate the account, the cafeteria and the capability.
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
  return <div className="space-y-5">
    <SupportContext accountId={a} accountName={d.scope.account_name} accountStatus={d.scope.account_status} cafeteriaName={`${d.scope.cafeteria_name} · ${d.scope.location_name}`} />
    <CafeteriaSwitcher overview={overview.value} accountId={a} selected={c} section={section} />
    <SectionNav accountId={a} cafeteriaId={c} current={section} />
    {section === "resumen" && <SupportSummary data={d} />}
    {section === "productos" && <SupportProducts data={d} />}
    {section === "cajas" && <SupportRegisters data={d} />}
    {section === "personal" && <SupportStaff data={d} />}
    {section === "transacciones" && <CafeteriaTransactions cafeteriaId={c} sandbox={false} source={{ endpoint: "/api/platform/customer-operations/transactions", accountId: a }} />}
    {section === "reportes" && <CafeteriaReports cafeteriaId={c} sandbox={false} reconciliation source={{ endpoint: "/api/platform/customer-operations/reports", accountId: a }} cajasHref={cafeteriaHref(a, c, "cajas")} />}
  </div>;
}
