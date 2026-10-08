import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isDemoMode } from "@/lib/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const schema = z.object({ email: z.email() });

export async function POST(req: NextRequest) {
  const parsed = schema.safeParse(Object.fromEntries(await req.formData()));

  if (parsed.success && !isDemoMode()) {
    try {
      const origin = new URL(req.url).origin;
      await (await createSupabaseServerClient()).auth.resetPasswordForEmail(
        parsed.data.email,
        { redirectTo: `${origin}/auth/callback` },
      );
    } catch {
      // Keep the response generic so the endpoint does not reveal account state.
    }
  }

  return NextResponse.json({ ok: true });
}
