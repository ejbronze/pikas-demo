import { isDemoMode } from "@/lib/env";
import { CafeteriaScreen, type CafeteriaSearchParams } from "@/components/cafeteria-screen";
export default async function Page({searchParams}:{searchParams:CafeteriaSearchParams}) {
 if(isDemoMode()){const { MenuAdmin } = await import("@/components/admin-pages"); return <MenuAdmin/>;}
 return <CafeteriaScreen section="products" searchParams={searchParams}/>;
}
