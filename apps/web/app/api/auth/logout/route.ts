import { NextRequest, NextResponse } from "next/server";
import { isDemoMode } from "@/lib/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  if (!isDemoMode()) {
    const { error } = await (await createSupabaseServerClient()).auth.signOut();
    if (error) {
      return NextResponse.json(
        { error: "Unable to terminate the Supabase session." },
        { status: 503 },
      );
    }
  }

  const response = NextResponse.redirect(
    new URL("/login", request.url),
    303,
  );
  response.cookies.delete("pikas_demo_role");
  response.cookies.delete("pikas_demo_admin_role");
  return response;
}
