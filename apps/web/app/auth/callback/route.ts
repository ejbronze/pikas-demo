import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const recoveryPath = "/actualizar-contrasena";
const recoveryRequestPath = "/forgot-password";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  if (!code) {
    return NextResponse.redirect(new URL(recoveryRequestPath, request.url));
  }

  try {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (error) {
      return NextResponse.redirect(new URL(recoveryRequestPath, request.url));
    }

    return NextResponse.redirect(new URL(recoveryPath, request.url));
  } catch {
    return NextResponse.redirect(new URL(recoveryRequestPath, request.url));
  }
}
