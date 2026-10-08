import { NextResponse } from "next/server";
import { resolvePikasIdentity } from "@/lib/auth/pikas-context";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function GET() {
  const identity = await resolvePikasIdentity(
    await createSupabaseServerClient(),
  );

  if (identity.status === "unauthenticated") {
    return NextResponse.json({ error: "authentication_required" }, { status: 401 });
  }
  if (identity.status === "unlinked") {
    return NextResponse.json({ error: "person_link_required" }, { status: 409 });
  }
  if (identity.memberships.length === 0 && identity.platform === null) {
    return NextResponse.json({ error: "active_membership_required" }, { status: 403 });
  }

  return NextResponse.json({
    authenticated: true,
    person: { displayName: identity.person.displayName },
    memberships: identity.memberships.map(({ roleCode, scopeKind }) => ({
      role: roleCode,
      scope: scopeKind,
    })),
    platform: identity.platform,
  });
}
