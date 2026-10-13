import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { applicationSessionSchema } from "../../../../lib/auth/application-session";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const schema = z.object({ action: z.enum(["status", "activity"]), surface: z.enum(["admin", "pos"]), session_id: z.uuid().optional() }).strict();
export async function POST(request: NextRequest) {
  if (request.headers.get("origin") !== request.nextUrl.origin) return NextResponse.json({ error: "origin_required" }, { status: 403 });
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "invalid" }, { status: 400 }); }
  const parsed = schema.safeParse(body);
  if (!parsed.success || (parsed.data.action === "activity" && !parsed.data.session_id)) return NextResponse.json({ error: "invalid" }, { status: 400 });
  const supabase = await createSupabaseServerClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return NextResponse.json({ error: "authentication_required" }, { status: 401 });
  const result = await supabase.rpc(`pikas_session_${parsed.data.action}`, { p_expected_session_id: parsed.data.session_id ?? null, p_pos: parsed.data.surface === "pos" });
  if (result.error) return NextResponse.json({ error: result.error.message }, { status: result.error.code === "PT409" ? 409 : result.error.code === "42501" ? 401 : 503 });
  const session = applicationSessionSchema.safeParse(result.data);
  if (!session.success) return NextResponse.json({ error: "session_unavailable" }, { status: 503 });
  return NextResponse.json({ session: session.data }, { headers: { "Cache-Control": "no-store" } });
}
