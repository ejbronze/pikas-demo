import Link from "next/link";
import { z } from "zod";
import { readPlatform, requirePlatform } from "@/lib/platform/customer-console";
import { CUSTOMER_OPERATIONS_MANAGE, CUSTOMER_OPERATIONS_READ, operationsOverviewSchema } from "../../../../../lib/platform/customer-operations";
import { CustomerStructure, SupportContext } from "../../../../../components/platform/customer-operations";
import { ErrorState, LoadFailure } from "../../../../../components/state-panels";

// Backoffice Customer Management: the customer's operational structure, read as the PIKAS employee.
export default async function CustomerManagementPage({ params }: { params: Promise<{ accountId: string }> }) {
  const session = await requirePlatform();
  if (!session.capabilities.includes(CUSTOMER_OPERATIONS_READ)) return <ErrorState kind="permission" title="No tienes permiso para gestionar la operación de clientes." description="Lo administra un administrador de la plataforma de PIKAS." action={<Link className="btn-secondary" href="/platform/clientes">Volver a Clientes</Link>} />;
  const id = z.guid().safeParse((await params).accountId);
  const read = id.success ? await readPlatform(session, CUSTOMER_OPERATIONS_READ, "platform_customer_operations_overview", { p_account_id: id.data }, operationsOverviewSchema) : { kind: "missing" as const, failure: "not_found" as const };
  const back = <Link className="btn-secondary" href="/platform/clientes">Volver a Clientes</Link>;
  if (read.kind === "unavailable") return <LoadFailure what="el cliente" invalidResponse={read.reason === "invalid_response"} retryHref={`/platform/clientes/${id.success ? id.data : ""}/gestion`} />;
  if (read.kind === "forbidden" && read.failure === "lifecycle") return <ErrorState kind="lifecycle" title="Este cliente no se puede gestionar en su estado actual." description="Está suspendido o cerrado. Solo la gestión de clientes de PIKAS puede restaurarlo." action={back} />;
  // The operator holds the capability (checked above): a refusal here is a scope mismatch, i.e. this account is not managed from here.
  if (read.kind !== "ready") return <ErrorState kind="not_found" title="No encontramos este cliente o no se gestiona desde aquí." description="Puede haber sido cerrado o la dirección ya no es válida." action={back} />;
  const o = read.value;
  return <div className="space-y-5">
    <SupportContext accountId={o.account.id} accountName={o.account.name} accountStatus={o.account.status} canManage={session.capabilities.includes(CUSTOMER_OPERATIONS_MANAGE)} />
    <header><h1 className="text-2xl font-black sm:text-3xl">Administrar cliente</h1>
      <p className="text-sm text-slate-600">Elige una cafetería para consultar su operación y, con permiso de gestión, actualizar su catálogo y cajas. Estudiantes, padres y personal los administra el colegio.</p></header>
    <CustomerStructure overview={o} />
  </div>;
}
