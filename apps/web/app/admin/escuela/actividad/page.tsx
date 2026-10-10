import { isDemoMode } from "@/lib/env";
import { SchoolScreen, type SchoolSearchParams } from "@/components/school-screen";
export default async function Page({ searchParams }: { searchParams: SchoolSearchParams }) {
  if (isDemoMode()) {
    const { AuditPage } = await import("@/components/admin-pages");
    return <AuditPage />;
  }
  return <SchoolScreen section="activity" searchParams={searchParams} />;
}
