import { isDemoMode } from "@/lib/env";
import { CafeteriaScreen, type CafeteriaSearchParams } from "@/components/cafeteria-screen";
export default async function Page({searchParams}:{searchParams:CafeteriaSearchParams}) {
 if(isDemoMode()){const { PosSettings } = await import("@/components/pos-settings"); return <PosSettings/>;}
 return <CafeteriaScreen section="settings" searchParams={searchParams}/>;
}
