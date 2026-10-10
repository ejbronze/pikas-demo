import { isDemoMode } from "@/lib/env";
import { CafeteriaScreen, type CafeteriaSearchParams } from "@/components/cafeteria-screen";
export default async function Page({searchParams}:{searchParams:CafeteriaSearchParams}) {
 if(isDemoMode()){const { RegisterSessions } = await import("@/components/register-sessions"); return <RegisterSessions admin/>;}
 return <CafeteriaScreen section="registers" searchParams={searchParams}/>;
}
