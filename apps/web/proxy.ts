import { createServerClient } from "@supabase/ssr";
import { NextRequest, NextResponse } from "next/server";
import { isDemoMode } from "@/lib/env";
import { getSupabasePublicConfig } from "@/lib/supabase/config";
import { hasAppRole, resolvePikasIdentity } from "@/lib/auth/pikas-context";
import { resolvePosAccess } from "@/lib/auth/pos-access";

const requiredRole = (path: string) =>
  path.startsWith("/familias")
    ? "parent"
    : path.startsWith("/estudiante")
      ? "student"
      : path.startsWith("/pos")
        ? "pos_operator"
        : path.startsWith("/admin/escuela")
          ? "school_admin"
          : path.startsWith("/admin/cafeteria")
            ? "cafeteria_admin"
            : undefined;

const demoRole = (request: NextRequest) => {
  const base = request.cookies.get("pikas_demo_role")?.value;
  const admin = request.cookies.get("pikas_demo_admin_role")?.value;
  return base === "admin" ? admin : base === "pos" ? "pos_operator" : base;
};

function loginRedirect(request: NextRequest) {
  return NextResponse.redirect(
    new URL(`/login?next=${encodeURIComponent(request.nextUrl.pathname)}`, request.url),
  );
}

export async function proxy(request: NextRequest) {
  const needed = requiredRole(request.nextUrl.pathname);
  const connectionPage = request.nextUrl.pathname === "/pilot/connected";
  if (!needed && !connectionPage) return NextResponse.next();

  if (isDemoMode()) {
    if (connectionPage) return NextResponse.redirect(new URL("/", request.url));
    if (!needed) return NextResponse.next();
    const role = demoRole(request);
    if (!role) return loginRedirect(request);
    if (role !== needed) {
      const target =
        role === "parent"
          ? "/familias"
          : role === "student"
            ? "/estudiante"
            : role === "pos_operator" || role === "pos"
              ? "/pos"
              : role === "school_admin"
                ? "/admin/escuela"
                : "/admin/cafeteria";
      return NextResponse.redirect(
        new URL(`${target}?aviso=sin-permiso`, request.url),
      );
    }
    return NextResponse.next();
  }

  const { url, anonKey } = getSupabasePublicConfig();
  let response = NextResponse.next({ request });
  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(values) {
        values.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        values.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, options);
        });
      },
    },
  });
  const redirectWithCookies = (target: URL) => {
    const redirected = NextResponse.redirect(target);
    response.cookies.getAll().forEach((cookie) => redirected.cookies.set(cookie));
    return redirected;
  };

  if (needed === "pos_operator") {
    const access = await resolvePosAccess(supabase);
    if (access.status === "authorized") return response;
    if (access.status === "unauthenticated") {
      return redirectWithCookies(new URL(`/login?next=${encodeURIComponent(request.nextUrl.pathname)}`, request.url));
    }
    return redirectWithCookies(new URL(
      access.status === "forbidden" ? "/login?error=pos_authority" : "/login?error=pos_unavailable",
      request.url,
    ));
  }

  const identity = await resolvePikasIdentity(supabase);

  if (identity.status === "unauthenticated") {
    if (connectionPage) return redirectWithCookies(new URL("/login", request.url));
    return redirectWithCookies(
      new URL(
        `/login?next=${encodeURIComponent(request.nextUrl.pathname)}`,
        request.url,
      ),
    );
  }
  if (identity.status !== "ready") {
    return redirectWithCookies(
      new URL("/login?error=identity", request.url),
    );
  }

  if (connectionPage) {
    if (identity.memberships.length === 0) {
      return redirectWithCookies(
        new URL("/login?error=membership", request.url),
      );
    }
    return response;
  }

  if (!needed) return response;

  const authorized =
    needed === "school_admin" || needed === "cafeteria_admin"
      ? hasAppRole(identity, needed)
      : false;

  if (!authorized) {
    return redirectWithCookies(
      new URL("/pilot/connected?aviso=sin-permiso", request.url),
    );
  }

  return redirectWithCookies(new URL("/pilot/connected", request.url));
}

export const config = {
  matcher: [
    "/familias/:path*",
    "/estudiante/:path*",
    "/pos/:path*",
    "/admin/escuela/:path*",
    "/admin/cafeteria/:path*",
    "/pilot/connected",
  ],
};
