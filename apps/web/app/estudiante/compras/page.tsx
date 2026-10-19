import { StudentPurchases } from "@/components/family/student-experience";
import { readStudentActivity } from "@/lib/family/demo-read";
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const vista = (await searchParams).vista;
  const { read, scenario } = await readStudentActivity();
  return <StudentPurchases read={read} scenario={scenario} viewParam={typeof vista === "string" ? vista : undefined} />;
}
