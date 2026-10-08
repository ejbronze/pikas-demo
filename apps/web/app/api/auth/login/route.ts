import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import type { UserRole } from "@pikas/shared-types";
import { isDemoMode } from "@/lib/env";
import { resolvePikasIdentity, pilotHome } from "@/lib/auth/pikas-context";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const schema = z.object({
  role: z.enum(["parent", "student", "pos_operator"]),
  identifier: z.string().trim().min(3).max(254),
  password: z.string().min(4).max(128),
});
const demoHome = (role: UserRole) =>
  role === "parent" ? "/familias" : role === "student" ? "/estudiante" : "/pos";
const fail = (request: NextRequest, code: string) =>
  NextResponse.redirect(new URL(`/login?error=${code}`, request.url), 303);

export async function POST(request: NextRequest) {
  const raw = Object.fromEntries(await request.formData());
  if (raw.role === "pos") raw.role = "pos_operator";
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return fail(request, "invalid");

  const { role, identifier, password } = parsed.data;
  if (isDemoMode()) {
    const response = NextResponse.redirect(
      new URL(demoHome(role), request.url),
      303,
    );
    response.cookies.set(
      "pikas_demo_role",
      role === "pos_operator" ? "pos" : role,
      {
        httpOnly: true,
        sameSite: "lax",
        secure: request.nextUrl.protocol === "https:",
        maxAge: 60 * 60 * 8,
        path: "/",
      },
    );
    return response;
  }

  if (role === "student" || !z.email().safeParse(identifier).success) {
    return fail(request, "pilot_email_required");
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.signInWithPassword({
    email: identifier,
    password,
  });
  if (error || !data.user) return fail(request, "credentials");

  const identity = await resolvePikasIdentity(supabase);
  const target = pilotHome(identity);
  if (!target) {
    const { error: signOutError } = await supabase.auth.signOut();
    if (signOutError) throw signOutError;
    return fail(
      request,
      identity.status === "unlinked" ? "identity" : "membership",
    );
  }

  return NextResponse.redirect(new URL(target, request.url), 303);
}
