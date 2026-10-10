import { isDemoMode } from "@/lib/env";
import { SchoolScreen, type SchoolSearchParams } from "@/components/school-screen";
export default async function Page({ searchParams }: { searchParams: SchoolSearchParams }) {
  if (isDemoMode()) {
    const { AdminUsers } = await import("@/components/admin-pages");
    return <AdminUsers kind="school" />;
  }
  return <SchoolScreen section="administrators" searchParams={searchParams} />;
}
