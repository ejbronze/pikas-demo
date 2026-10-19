import { GuardianHome } from "@/components/family/guardian-pages";
import { readGuardianOverview } from "@/lib/family/demo-read";
export default async function Page() { const { read, scenario } = await readGuardianOverview(); return <GuardianHome read={read} scenario={scenario} />; }
