import { isDemoMode } from "@/lib/env";
import { CafeteriaScreen, type CafeteriaSearchParams } from "@/components/cafeteria-screen";
export default async function Page({searchParams}:{searchParams:CafeteriaSearchParams}) {
 if(isDemoMode()) return <p className="card p-5" role="status">Las liquidaciones no existen en el modo de demostración.</p>;
 return <CafeteriaScreen section="settlements" searchParams={searchParams}/>;
}
