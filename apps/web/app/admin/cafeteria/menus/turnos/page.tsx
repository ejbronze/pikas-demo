import { isDemoMode } from "@/lib/env";
import { CafeteriaScreen, type CafeteriaSearchParams } from "@/components/cafeteria-screen";
export default async function Page({searchParams}:{searchParams:CafeteriaSearchParams}) {
 if(isDemoMode()){const { CafeteriaMenus } = await import("@/components/cafeteria-menus"); return <CafeteriaMenus shifts/>;}
 return <CafeteriaScreen section="shifts" searchParams={searchParams}/>;
}
