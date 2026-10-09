import { PosDashboard } from "@/components/pos-dashboard";
import { requirePosAccess } from "@/lib/auth/pos-access";

export default async function Page(){
  const session=await requirePosAccess();
  return <PosDashboard access={session}/>;
}
