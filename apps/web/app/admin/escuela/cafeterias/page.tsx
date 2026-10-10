import { isDemoMode } from "@/lib/env";
import { SchoolScreen, type SchoolSearchParams } from "@/components/school-screen";
export default async function Page({ searchParams }: { searchParams: SchoolSearchParams }) {
  if (isDemoMode()) {
    const { Partnerships } = await import("@/components/admin-pages");
    return <Partnerships kind="school" />;
  }
  return <SchoolScreen section="cafeterias" searchParams={searchParams} />;
}
