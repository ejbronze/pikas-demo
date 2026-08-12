import {NextRequest,NextResponse} from "next/server";
import {isDemoMode} from "@/lib/env";
import {createSupabaseServerClient} from "@/lib/supabase/server";
import {z} from "zod";

const updateSchema=z.object({id:z.string().uuid(),name:z.string().trim().min(1).max(120),description:z.string().max(500),category:z.string().trim().min(1).max(80),priceMinor:z.number().int().nonnegative(),available:z.boolean(),ingredients:z.array(z.string().max(80)).max(30),allergens:z.array(z.string().max(80)).max(30),dietaryTags:z.array(z.string().max(80)).max(30),imageUrl:z.string().url().nullable()});
const createSchema=updateSchema.omit({id:true});

export async function GET(){
  if(isDemoMode())return NextResponse.json({error:"demo_mode"},{status:409});
  try{
    const supabase=await createSupabaseServerClient();
    const {data:{user}}=await supabase.auth.getUser();if(!user)return NextResponse.json({error:"unauthorized"},{status:401});
    const {data,error}=await supabase.from("menu_items").select("id,name,description,category,price_minor,available,ingredients,allergens,dietary_tags,image_url").order("name");
    if(error)throw error;
    return NextResponse.json({items:data.map(i=>({id:i.id,name:i.name,description:i.description,category:i.category,priceMinor:Number(i.price_minor),available:i.available,ingredients:i.ingredients,allergens:i.allergens,restrictionTags:i.dietary_tags,imageUrl:i.image_url}))});
  }catch{return NextResponse.json({error:"supabase_unavailable"},{status:503})}
}

export async function PATCH(req:NextRequest){
  if(isDemoMode())return NextResponse.json({error:"demo_mode"},{status:409});
  const parsed=updateSchema.safeParse(await req.json().catch(()=>null));if(!parsed.success)return NextResponse.json({error:"invalid"},{status:400});
  try{
    const supabase=await createSupabaseServerClient();const {data:{user}}=await supabase.auth.getUser();if(!user)return NextResponse.json({error:"unauthorized"},{status:401});
    const {data:profile}=await supabase.from("profiles").select("role").eq("id",user.id).single();if(profile?.role!=="cafeteria_admin")return NextResponse.json({error:"forbidden"},{status:403});
    const item=parsed.data;const {error}=await supabase.from("menu_items").update({name:item.name,description:item.description,category:item.category,price_minor:item.priceMinor,available:item.available,ingredients:item.ingredients,allergens:item.allergens,dietary_tags:item.dietaryTags,image_url:item.imageUrl}).eq("id",item.id);if(error)throw error;
    return NextResponse.json({ok:true});
  }catch{return NextResponse.json({error:"supabase_unavailable"},{status:503})}
}

export async function POST(req:NextRequest){
  if(isDemoMode())return NextResponse.json({error:"demo_mode"},{status:409});
  const parsed=createSchema.safeParse(await req.json().catch(()=>null));if(!parsed.success)return NextResponse.json({error:"invalid"},{status:400});
  try{
    const supabase=await createSupabaseServerClient();const {data:{user}}=await supabase.auth.getUser();if(!user)return NextResponse.json({error:"unauthorized"},{status:401});
    const {data:membership}=await supabase.from("organization_memberships").select("organization_id,location_id").eq("profile_id",user.id).eq("role","cafeteria_admin").eq("status","active").limit(1).maybeSingle();if(!membership)return NextResponse.json({error:"forbidden"},{status:403});
    const {data:partnership}=await supabase.from("partnerships").select("school_id,organizations!partnerships_school_id_fkey(school_id)").eq("cafeteria_id",membership.organization_id).eq("status","active").limit(1).maybeSingle();
    const organization=Array.isArray(partnership?.organizations)?partnership.organizations[0]:partnership?.organizations;if(!organization?.school_id)return NextResponse.json({error:"scope"},{status:403});
    const item=parsed.data;const {data,error}=await supabase.from("menu_items").insert({school_id:organization.school_id,cafeteria_id:membership.organization_id,location_id:membership.location_id,name:item.name,description:item.description,category:item.category,price_minor:item.priceMinor,available:item.available,ingredients:item.ingredients,allergens:item.allergens,dietary_tags:item.dietaryTags,image_url:item.imageUrl}).select("id").single();if(error)throw error;
    return NextResponse.json({id:data.id},{status:201});
  }catch{return NextResponse.json({error:"supabase_unavailable"},{status:503})}
}
