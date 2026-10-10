import { isDemoMode } from "@/lib/env";
import { CafeteriaScreen, type CafeteriaSearchParams } from "@/components/cafeteria-screen";
export default async function Page({searchParams}:{searchParams:CafeteriaSearchParams}) {
 if(isDemoMode()){const { CafeteriaDashboard } = await import("@/components/admin-pages"); return <CafeteriaDashboard/>;}
 return <CafeteriaScreen section="summary" searchParams={searchParams}/>;
}
