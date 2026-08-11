import { getFamilyParent, getFamilyStudents, getStudentControls, getStudentTransactions, getStudentWallet } from "@pikas/data-access";
import FamilyPortal from "./portal";

export default async function Page(){
  const familyId="fam-rosa";
  const [parent,students]=await Promise.all([getFamilyParent(familyId),getFamilyStudents(familyId)]);
  if(!parent) throw new Error("No pudimos cargar el perfil familiar.");
  const records=await Promise.all(students.map(async student=>({student,wallet:await getStudentWallet(student.id),controls:await getStudentControls(student.id),transactions:await getStudentTransactions(student.id)})));
  return <FamilyPortal parent={parent} records={records}/>;
}
