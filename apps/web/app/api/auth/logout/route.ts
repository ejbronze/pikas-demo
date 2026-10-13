import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isDemoMode } from "@/lib/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  const json = request.headers.get("content-type")?.includes("application/json");
  if (request.headers.get("origin") !== request.nextUrl.origin) return NextResponse.json({ error: "origin_required" }, { status: 403 });
  if (!json && !isDemoMode()) return NextResponse.json({ error: "expected_session_required" }, { status: 400 });
  let expected: string | undefined;
  if (json) {
    let body: unknown;
    try { body = await request.json(); } catch { return NextResponse.json({ error: "invalid" }, { status: 400 }); }
    const parsed = z.object({ session_id: z.uuid() }).strict().safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: "invalid" }, { status: 400 });
    expected = parsed.data.session_id;
  }
  if (!isDemoMode()) {
    const supabase = await createSupabaseServerClient();
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) return NextResponse.json({ error: "authentication_required" }, { status: 401 });
    const ended = await supabase.rpc("pikas_session_end", { p_expected_session_id: expected ?? null });
    if (ended.error) return NextResponse.json({ error: ended.error.message }, { status: ended.error.code === "PT409" ? 409 : 503 });
    const { error } = await supabase.auth.signOut({ scope: "local" });
    if (error) return NextResponse.json({ error: "Unable to terminate the Supabase session." }, { status: 503 });
  }
  const response = json ? NextResponse.json({ ok: true }) : NextResponse.redirect(new URL("/login", request.url), 303);
  response.cookies.delete("pikas_demo_role");
  response.cookies.delete("pikas_demo_admin_role");
  return response;
}
