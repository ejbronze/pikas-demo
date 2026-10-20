import Link from "next/link";
import { z } from "zod";
import { readPlatform, requirePlatform } from "@/lib/platform/customer-console";
import { CUSTOMER_OPERATIONS_MANAGE, CUSTOMER_OPERATIONS_READ, operationsOverviewSchema } from "../../../../../lib/platform/customer-operations";
import { CustomerStructure, SupportContext } from "../../../../../components/platform/customer-operations";
import { ErrorState } from "../../../../../components/state-panels";

// Backoffice Customer Management: the customer's operational structure, read as the PIKAS employee.
export default async function CustomerManagementPage({ params }: { params: Promise<{ accountId: string }> }) {
  const session = await requirePlatform();
  if (!session.capabilities.includes(CUSTOMER_OPERATIONS_READ)) return <ErrorState title="No tienes permiso para gestionar la operación de clientes." retry={<Link className="btn-secondary" href="/platform/clientes">Volver a Clientes</Link>} />;
  const id = z.guid().safeParse((await params).accountId);
  const read = id.success ? await readPlatform(session, CUSTOMER_OPERATIONS_READ, "platform_customer_operations_overview", { p_account_id: id.data }, operationsOverviewSchema) : { kind: "missing" as const };
  if (read.kind !== "ready") return <ErrorState title={read.kind === "unavailable" ? "No pudimos cargar el cliente." : "No encontramos este cliente o no se gestiona desde aquí."}
    retry={<Link className="btn-secondary" href="/platform/clientes">Volver a Clientes</Link>} />;
  const o = read.value;
  return <div className="space-y-5">
    <SupportContext accountId={o.account.id} accountName={o.account.name} accountStatus={o.account.status} canManage={session.capabilities.includes(CUSTOMER_OPERATIONS_MANAGE)} />
    <header><h1 className="text-2xl font-black sm:text-3xl">Administrar cliente</h1>
      <p className="text-sm text-slate-600">Elige una cafetería para consultar su operación y, con permiso de gestión, actualizar su catálogo y cajas. Estudiantes, padres y personal los administra el colegio.</p></header>
    <CustomerStructure overview={o} />
  </div>;
}
