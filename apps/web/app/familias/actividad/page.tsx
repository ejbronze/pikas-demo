import { GuardianActivity } from "@/components/family/guardian-pages";
import { readGuardianOverview } from "@/lib/family/demo-read";
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams, one = (v: string | string[] | undefined) => typeof v === "string" ? v : undefined;
  const { read, scenario } = await readGuardianOverview();
  return <GuardianActivity read={read} scenario={scenario} studentParam={one(params.estudiante)} viewParam={one(params.vista)} />;
}
