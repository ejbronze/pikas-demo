import {createClient} from "@supabase/supabase-js";

if(process.env.NODE_ENV==="production")throw new Error("This seed is development-only.");
const url=process.env.NEXT_PUBLIC_SUPABASE_URL;
const key=process.env.SUPABASE_SERVICE_ROLE_KEY;
const password=process.env.PIKAS_DEMO_PASSWORD;
if(!url||!key||!password)throw new Error("Set NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and PIKAS_DEMO_PASSWORD for a development Supabase project.");
const supabase=createClient(url,key,{auth:{autoRefreshToken:false,persistSession:false}});
const accounts=[
  {email:"admin.escuela@demo.pikas.do",name:"Elena Méndez",role:"school_admin",organizationId:"60000000-0000-0000-0000-000000000001"},
  {email:"admin.cafeteria@demo.pikas.do",name:"María Castillo",role:"cafeteria_admin",organizationId:"60000000-0000-0000-0000-000000000002",locationId:"61000000-0000-0000-0000-000000000001"},
  {email:"cafeteria@demo.pikas.do",name:"Caja Demo",role:"pos_operator",organizationId:"60000000-0000-0000-0000-000000000002",locationId:"61000000-0000-0000-0000-000000000001"},
];
for(const account of accounts){
  const {data,error}=await supabase.auth.admin.createUser({email:account.email,password,email_confirm:true,user_metadata:{fictional_demo:true}});
  let user=data.user;
  if(error){const {data:list,listError}=await supabase.auth.admin.listUsers();if(listError)throw listError;user=list.users.find(candidate=>candidate.email===account.email);if(!user)throw error}
  const {error:profileError}=await supabase.from("profiles").upsert({id:user.id,email:account.email,full_name:account.name,role:account.role,school_id:account.role==="school_admin"||account.role==="pos_operator"?"10000000-0000-0000-0000-000000000001":null});if(profileError)throw profileError;
  const {error:membershipError}=await supabase.from("organization_memberships").upsert({profile_id:user.id,organization_id:account.organizationId,location_id:account.locationId??null,role:account.role,status:"active"},{onConflict:"profile_id,organization_id,role"});if(membershipError)throw membershipError;
}
console.log(`Seeded ${accounts.length} fictional development Auth accounts.`);
