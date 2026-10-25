import { requirePlatform } from "../../../lib/platform/customer-console";
import { canReadFinanceReports, canReadNetworkReports } from "../../../lib/platform/report-access";
import { ReadFailure } from "../console-views";
import { PlatformReportsIndex } from "../../../components/platform/report-views";

// Platform Reportes landing (shell and navigation come from the Platform layout): only the reports this role can open.
export default async function Page() {
  const session = await requirePlatform(), network = canReadNetworkReports(session.capabilities), finance = canReadFinanceReports(session.capabilities);
  return network || finance ? <PlatformReportsIndex network={network} finance={finance} /> : <ReadFailure kind="forbidden" />;
}
