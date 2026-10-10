import { isDemoMode } from "@/lib/env";
import { CafeteriaScreen, type CafeteriaSearchParams } from "@/components/cafeteria-screen";
export default async function Page({searchParams}:{searchParams:CafeteriaSearchParams}) {
 if(isDemoMode()){const { CafeteriaEmployees } = await import("@/components/cafeteria-employees"); return <CafeteriaEmployees/>;}
 return <CafeteriaScreen section="staff" searchParams={searchParams}/>;
}
