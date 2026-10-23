import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import type { UserRole } from "@pikas/shared-types";
import { isDemoMode } from "@/lib/env";
import { resolvePikasIdentity, pilotHome } from "@/lib/auth/pikas-context";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { invitationProvider } from "@/lib/auth/activation";
import { organizationDenial } from "../../../../lib/auth/tenant-lifecycle";
import { isEmailIdentifier, isValidUsername, normalizeUsername } from "../../../../lib/identity/username";

const schema = z.object({
  role: z.enum(["parent", "student", "pos_operator"]).optional(),
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
    if (!role) return fail(request, "invalid");
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

  // Phase 6A: "Correo / Usuario". A PIKAS username resolves server-side (service role only) to the
  // SAME Auth email; malformed or unknown identifiers get the same generic error as a bad password.
  let email: string | null = null;
  if (isEmailIdentifier(identifier)) {
    if (z.email().safeParse(identifier).success) email = identifier;
  } else {
    const username = normalizeUsername(identifier);
    if (isValidUsername(username)) {
      try {
        const resolved = await invitationProvider().rpc("login_identifier_email", { p_username: username });
        if (!resolved.error && typeof resolved.data === "string") email = resolved.data;
        else if (resolved.error) return fail(request, "session");
      } catch {
        return fail(request, "session");
      }
    }
  }
  if (!email) return fail(request, "credentials");

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });
  if (error || !data.user) return fail(request, "credentials");

  const started = await supabase.rpc("pikas_session_start");
  if (started.error) {
    await supabase.auth.signOut({ scope: "local" });
    // UX 12B closure: the database refuses an unused temporary password older than 15 minutes.
    return fail(request, started.error.message === "temporary_access_expired" ? "temporary_expired" : "session");
  }

  // Phase 6A (after the application session exists; the pre-request guard requires it): a
  // suspended login is signed out generically; a temporary password must be replaced first.
  const credential = await supabase.rpc("identity_credential_state");
  const state = (credential.data ?? {}) as { must_change_password?: boolean; login_suspended?: boolean; temporary_expired?: boolean };
  if (credential.error || state.login_suspended || state.temporary_expired) {
    await supabase.auth.signOut({ scope: "local" });
    return fail(request, credential.error ? "session" : state.temporary_expired ? "temporary_expired" : "credentials");
  }
  if (state.must_change_password) {
    return NextResponse.redirect(new URL("/actualizar-contrasena?motivo=temporal", request.url), 303);
  }

  const identity = await resolvePikasIdentity(supabase);
  const target = pilotHome(identity);
  if (!target) {
    const organization = identity.status === "ready" ? await organizationDenial(supabase) : null;
    // Lifecycle & Access Management: suspended or deactivated accesses are named as such (scope, not login).
    let access: "access_suspended" | "access_inactive" | null = null;
    if (identity.status === "ready" && !organization) {
      const summary = await supabase.rpc("identity_access_summary");
      const memberships = ((summary.data ?? {}) as { memberships?: { status: string }[] }).memberships ?? [];
      access = memberships.some(m => m.status === "suspended") ? "access_suspended" : memberships.some(m => m.status === "inactive") ? "access_inactive" : null;
    }
    const { error: signOutError } = await supabase.auth.signOut({ scope: "local" });
    if (signOutError) throw signOutError;
    return fail(
      request,
      organization ?? access ?? (identity.status === "unlinked" ? "identity" : "membership"),
    );
  }

  return NextResponse.redirect(new URL(target, request.url), 303);
}
