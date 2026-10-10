import { isDemoMode } from "@/lib/env";
import { SchoolScreen, type SchoolSearchParams } from "@/components/school-screen";
export default async function Page({ searchParams }: { searchParams: SchoolSearchParams }) {
  if (isDemoMode()) {
    const { SchoolDashboard } = await import("@/components/admin-pages");
    return <SchoolDashboard />;
  }
  return <SchoolScreen section="summary" searchParams={searchParams} />;
}
