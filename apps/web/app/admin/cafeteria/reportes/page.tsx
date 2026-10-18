import { notFound } from "next/navigation";
import { isDemoMode } from "@/lib/env";
import { CafeteriaScreen, type CafeteriaSearchParams } from "@/components/cafeteria-screen";
export default async function Page({searchParams}:{searchParams:CafeteriaSearchParams}) {
 if(isDemoMode())notFound();
 return <CafeteriaScreen section="reports" searchParams={searchParams}/>;
}
