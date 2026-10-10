import { isDemoMode } from "@/lib/env";
import { CafeteriaScreen, type CafeteriaSearchParams } from "@/components/cafeteria-screen";
export default async function Page({searchParams}:{searchParams:CafeteriaSearchParams}) {
 if(isDemoMode()){const { TransactionsAdmin } = await import("@/components/admin-pages"); return <TransactionsAdmin/>;}
 return <CafeteriaScreen section="transactions" searchParams={searchParams}/>;
}
