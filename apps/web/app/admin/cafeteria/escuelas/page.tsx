import { isDemoMode } from "@/lib/env";
import { CafeteriaScreen, type CafeteriaSearchParams } from "@/components/cafeteria-screen";
export default async function Page({searchParams}:{searchParams:CafeteriaSearchParams}) {
 if(isDemoMode()){const { Partnerships } = await import("@/components/admin-pages"); return <Partnerships kind="cafeteria"/>;}
 return <CafeteriaScreen section="schools" searchParams={searchParams}/>;
}
