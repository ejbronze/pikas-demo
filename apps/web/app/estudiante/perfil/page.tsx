import { StudentProfileView } from "@/components/family/student-experience";
import { readStudentActivity } from "@/lib/family/demo-read";
export default async function Page() { const { read, scenario } = await readStudentActivity(); return <StudentProfileView read={read} scenario={scenario} />; }
