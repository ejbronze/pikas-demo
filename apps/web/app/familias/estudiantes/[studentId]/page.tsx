import {StudentDetail} from "@/components/family-pages";export default async function Page({params}:{params:Promise<{studentId:string}>}){return <StudentDetail id={(await params).studentId}/>}
