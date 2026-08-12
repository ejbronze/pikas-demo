import { PosDashboard } from "@/components/pos-dashboard";
import { requireRole } from "@/lib/auth/require-role";

export default async function Page(){
  const session=await requireRole("pos_operator");
  return <PosDashboard demo={session.demo}/>;
}
