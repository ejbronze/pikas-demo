import { StudentHome } from "@/components/family/student-experience";
import { readStudentActivity } from "@/lib/family/demo-read";
export default async function Page() { const { read, scenario } = await readStudentActivity(); return <StudentHome read={read} scenario={scenario} />; }
