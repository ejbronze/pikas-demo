import { isDemoMode } from "@/lib/env";
import { SchoolScreen, type SchoolSearchParams } from "@/components/school-screen";
export default async function Page({ searchParams }: { searchParams: SchoolSearchParams }) {
  if (isDemoMode()) {
    const { StudentRoster } = await import("@/components/admin-pages");
    return <StudentRoster />;
  }
  return <SchoolScreen section="students" searchParams={searchParams} />;
}
