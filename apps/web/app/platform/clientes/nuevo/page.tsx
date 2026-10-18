import { requirePlatform } from "@/lib/platform/customer-console";
import { ReadFailure } from "../../console-views";
import { AppPageHeader } from "../../../../components/app-page-header";
import { CustomerWizard } from "./customer-wizard";
export default async function NewCustomerPage() {
  const { identity, capabilities } = await requirePlatform();
  if (!capabilities.includes("platform:tenant:provision") || !capabilities.includes("platform:customer_admin:provision")) return <ReadFailure kind="forbidden" />;
  return <><AppPageHeader back={{ href: "/platform/clientes", label: "Clientes" }} title="Nuevo cliente" description="Crea un cliente con su primera escuela, ubicación y cafetería." /><CustomerWizard actor={identity.user.id} /></>;
}
