import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isDemoMode } from "@/lib/env";
import { pilotHome, resolvePikasIdentity } from "@/lib/auth/pikas-context";
import { workspaceFor, type AdminRole } from "@/lib/admin-policy";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const demoAccounts = {
  "admin.escuela@demo.pikas.do": {
    password: "pikas-demo",
    role: "school_admin",
  },
  "admin.cafeteria@demo.pikas.do": {
    password: "pikas-demo",
    role: "cafeteria_admin",
  },
  "cafeteria@demo.pikas.do": { password: "pikas-demo", role: "pos_operator" },
} as const;
const schema = z.object({
  identifier: z.string().email(),
  password: z.string().min(4).max(128),
});
const fail = (request: NextRequest, code: string) =>
  NextResponse.redirect(
    new URL(`/admin/login?error=${code}`, request.url),
    303,
  );

export async function POST(request: NextRequest) {
  const parsed = schema.safeParse(
    Object.fromEntries(await request.formData()),
  );

  if (isDemoMode()) {
    if (!parsed.success) return fail(request, "credentials");
    const account =
      demoAccounts[parsed.data.identifier as keyof typeof demoAccounts];
    if (!account || account.password !== parsed.data.password) {
      return fail(request, "credentials");
    }

    const role = account.role as AdminRole;
    const response = NextResponse.redirect(
      new URL(workspaceFor(role), request.url),
      303,
    );
    const secure = request.nextUrl.protocol === "https:";
    response.cookies.set("pikas_demo_role", role === "pos_operator" ? "pos" : "admin", {
      httpOnly: true,
      sameSite: "lax",
      secure,
      maxAge: 60 * 60 * 8,
      path: "/",
    });
    response.cookies.set("pikas_demo_admin_role", role, {
      httpOnly: true,
      sameSite: "lax",
      secure,
      maxAge: 60 * 60 * 8,
      path: "/",
    });
    return response;
  }

  if (!parsed.success) return fail(request, "credentials");

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.signInWithPassword({
    email: parsed.data.identifier,
    password: parsed.data.password,
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
