import "server-only";
import { z } from "zod";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const codeSchema=z.string().trim().toUpperCase().regex(/^PK-\d{5}$/);
const checkoutSchema=z.object({studentCode:codeSchema,items:z.array(z.object({itemId:z.string().uuid(),quantity:z.number().int().min(1).max(20)})).min(1).max(30),idempotencyKey:z.string().min(8).max(128)});

async function requirePosProfile(){
  const supabase=await createSupabaseServerClient();
  const {data:{user}}=await supabase.auth.getUser();
  if(!user)throw new Error("not_authenticated");
  const {data:profile,error}=await supabase.from("profiles").select("id,school_id,role").eq("id",user.id).single();
  if(error||profile?.role!=="pos"||!profile.school_id)throw new Error("not_authorized");
  return {supabase,profile};
}

export async function findStudentForPos(rawCode:string){
  const code=codeSchema.parse(rawCode);
  const {profile}=await requirePosProfile();
  const admin=createSupabaseAdminClient();
  const {data:student,error}=await admin.from("students").select("id,preferred_name,first_name,last_name,grade,status,school_id,avatar_url,wallets(id,status),student_controls(daily_spending_limit_minor,per_transaction_limit_minor),student_allergies(allergies(name)),blocked_products(product_name)").eq("student_code",code).eq("school_id",profile.school_id).maybeSingle();
  if(error)throw new Error("student_lookup_failed");
  if(!student||student.status!=="active")return null;
  return student;
}

export async function completeSupabasePosPurchase(input:unknown){
  const parsed=checkoutSchema.parse(input);
  const {supabase}=await requirePosProfile();
  const {data,error}=await supabase.rpc("complete_pos_purchase",{p_student_code:parsed.studentCode,p_items:parsed.items,p_idempotency_key:parsed.idempotencyKey});
  if(error)throw new Error(error.message);
  return data as string;
}

export async function listSupabasePosPurchases(){
  const {supabase,profile}=await requirePosProfile();
  const {data,error}=await supabase.from("purchases").select("id,total_minor,status,created_at,completed_by,students(preferred_name),purchase_items(item_name,quantity,unit_price_minor)").eq("school_id",profile.school_id).order("created_at",{ascending:false}).limit(100);
  if(error)throw new Error("purchase_history_failed");
  return data;
}
