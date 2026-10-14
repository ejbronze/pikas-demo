import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient } from "../../../../../lib/supabase/server";
import { resolveSchoolAccess } from "../../../../../lib/auth/school-access";
import { bulkPayloadLimit, bulkRequestSchema, bulkValidationSchema, bulkCommitSchema } from "../../../../../lib/school/bulk-contracts";
// Only this new route needs room for the bounded 30-second bulk RPC.
export const maxDuration = 40;
export async function POST(request: NextRequest) {
 const fail=(error:string,status:number)=>NextResponse.json({error},{status,headers:{"Cache-Control":"no-store"}});
 if(request.headers.get("origin")!==request.nextUrl.origin)return fail("same_origin_required",403);
 const reader=request.body?.getReader();if(!reader)return fail("invalid_payload",400);
 let length=0;const chunks:Uint8Array[]=[];
 try{for(;;){const {done,value}=await reader.read();if(done)break;length+=value.byteLength;if(length>bulkPayloadLimit){await reader.cancel();return fail("student_bulk_payload_limit",413);}chunks.push(value);}}catch{return fail("invalid_payload",400);}
 let body:unknown;try{body=JSON.parse(Buffer.concat(chunks).toString("utf8"));}catch{return fail("invalid_payload",400);}
 if(body&&typeof body==="object"&&"rows" in body&&Array.isArray(body.rows)&&body.rows.length>200)return fail("student_bulk_row_limit",413);
 const parsed=bulkRequestSchema.safeParse(body);if(!parsed.success)return fail("invalid_payload",400);
 const key=z.uuid().safeParse(request.headers.get("Idempotency-Key"));
 if(parsed.data.action==="commit"&&!key.success)return fail("invalid_request_key",400);
 try{
  const client=await createSupabaseServerClient();const access=await resolveSchoolAccess(client);
  if(access.status==="unauthenticated")return fail("authentication_required",401);
  if(access.status==="unavailable")return fail("authorization_unavailable",503);
  if(access.status!=="authorized"||!access.context.schools.some(s=>s.school_id===parsed.data.schoolId))return fail("school_authority_required",403);
  const args={p_school_id:parsed.data.schoolId,p_rows:parsed.data.rows};
  const commit=parsed.data.action==="commit";
  const result=await client.rpc(commit?"school_student_bulk_commit":"school_student_bulk_validate",commit&&parsed.data.action==="commit"&&key.success?{...args,p_request_id:key.data,p_included_rows:parsed.data.included_rows,p_confirmed:true}:args);
  if(result.error){const code=result.error.code;return fail(code==="42501"?"school_authority_required":code==="23505"?"student_bulk_conflict":code==="22023"?"invalid_batch":"operation_uncertain",code==="42501"?403:code==="23505"?409:code==="22023"?422:502);}
  const response=(commit?bulkCommitSchema:bulkValidationSchema).safeParse(result.data);
  if(!response.success||response.data.school_id!==parsed.data.schoolId||(commit&&"request_id" in response.data&&response.data.request_id!==key.data))return fail("operation_uncertain",502);
  if(parsed.data.action==="commit"&&"status" in response.data&&response.data.status==="committed"){
   const expected=new Set(parsed.data.included_rows),actual=new Set(response.data.created.map(row=>row.source_row));
   if(actual.size!==expected.size||actual.size!==response.data.created.length||[...actual].some(row=>!expected.has(row)))return fail("operation_uncertain",502);
  }
  return NextResponse.json({result:response.data},{headers:{"Cache-Control":"no-store"}});
 }catch{return fail("operation_uncertain",502);}
}
