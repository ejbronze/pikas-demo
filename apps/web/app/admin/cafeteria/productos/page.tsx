import { isDemoMode } from "@/lib/env";
import { CafeteriaScreen, type CafeteriaSearchParams } from "@/components/cafeteria-screen";
export default async function Page({searchParams}:{searchParams:CafeteriaSearchParams}) {
 if(isDemoMode()){const { CafeteriaProducts } = await import("@/components/cafeteria-products"); return <CafeteriaProducts/>;}
 return <CafeteriaScreen section="products" searchParams={searchParams}/>;
}
