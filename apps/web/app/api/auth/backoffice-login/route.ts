import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isDemoMode } from "@/lib/env";
import { backofficeHome, resolvePikasIdentity } from "@/lib/auth/pikas-context";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const schema = z.object({
  identifier: z.string().email(),
  password: z.string().min(4).max(128),
});

const fail = (request: NextRequest, code: string) =>
  NextResponse.redirect(
    new URL(`/backoffice/login?error=${code}`, request.url),
    303,
  );

export async function POST(request: NextRequest) {
  if (isDemoMode()) return fail(request, "unavailable");

  const parsed = schema.safeParse(Object.fromEntries(await request.formData()));
  if (!parsed.success) return fail(request, "credentials");

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.signInWithPassword({
    email: parsed.data.identifier,
    password: parsed.data.password,
  });
  if (error || !data.user) return fail(request, "credentials");

  const identity = await resolvePikasIdentity(supabase);
  const target = backofficeHome(identity);
  if (!target) {
    const { error: signOutError } = await supabase.auth.signOut();
    if (signOutError) throw signOutError;
    return fail(request, identity.status === "unlinked" ? "identity" : "platform");
  }

  return NextResponse.redirect(new URL(target, request.url), 303);
}
