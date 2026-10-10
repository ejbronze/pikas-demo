import { requirePlatform } from "@/lib/platform/customer-console";
import { ReadFailure } from "../../console-views";
import { CustomerWizard } from "./customer-wizard";
export default async function NewCustomerPage() {
  const { identity, capabilities } = await requirePlatform();
  if (!capabilities.includes("platform:tenant:provision") || !capabilities.includes("platform:customer_admin:provision")) return <ReadFailure kind="forbidden" />;
  return <><h1 className="text-2xl font-bold">Nuevo cliente</h1><p>Crea un cliente con su primera escuela, ubicación y cafetería.</p><CustomerWizard actor={identity.user.id} /></>;
}
