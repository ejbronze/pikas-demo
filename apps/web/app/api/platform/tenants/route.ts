import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { resolvePikasIdentity } from "@/lib/auth/pikas-context";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const provisioningSchema = z
  .object({
    accountCode: z.string().trim().min(1).max(64),
    accountName: z.string().trim().min(1).max(200),
    schoolCode: z.string().trim().min(1).max(64),
    schoolName: z.string().trim().min(1).max(200),
    businessTimezone: z.string().trim().min(1).max(100),
    locationCode: z.string().trim().min(1).max(64),
    locationName: z.string().trim().min(1).max(200),
    cafeteriaCode: z.string().trim().min(1).max(64),
    cafeteriaName: z.string().trim().min(1).max(200),
  })
  .strict();

const provisioningResultSchema = z.object({
  account_id: z.uuid(),
  school_id: z.uuid(),
  location_id: z.uuid(),
  cafeteria_id: z.uuid(),
});

const requiredCapability = "platform:tenant:provision";

function hasSameOrigin(request: NextRequest): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;

  try {
    return new URL(origin).origin === request.nextUrl.origin;
  } catch {
    return false;
  }
}

function errorCode(error: unknown): string {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = error.code;
    if (typeof code === "string") return code;
  }
  if (error instanceof Error) return error.name;
  return "unknown";
}

export async function POST(request: NextRequest) {
  if (!hasSameOrigin(request)) {
    return NextResponse.json({ error: "same_origin_required" }, { status: 403 });
  }

  const requestId = z.uuid().safeParse(request.headers.get("Idempotency-Key"));
  if (!requestId.success) {
    return NextResponse.json({ error: "invalid_idempotency_key" }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
  }

  const parsed = provisioningSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
  }

  let supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>;
  let identity: Awaited<ReturnType<typeof resolvePikasIdentity>>;
  try {
    supabase = await createSupabaseServerClient();
    identity = await resolvePikasIdentity(supabase);
  } catch (error) {
    console.error("Platform tenant provisioning authorization failed", {
      code: errorCode(error),
    });
    return NextResponse.json({ error: "authorization_unavailable" }, { status: 503 });
  }

  if (identity.status === "unauthenticated") {
    return NextResponse.json({ error: "authentication_required" }, { status: 401 });
  }

  if (
    identity.status !== "ready" ||
    identity.platform?.role !== "platform_admin" ||
    !identity.platform.capabilities.includes(requiredCapability)
  ) {
    return NextResponse.json({ error: "platform_authorization_required" }, { status: 403 });
  }

  let data: unknown;
  let error: { code: string } | null;
  try {
    const rpcResponse = await supabase.rpc("platform_provision_tenant", {
      p_request_id: requestId.data,
      p_account_code: parsed.data.accountCode,
      p_account_name: parsed.data.accountName,
      p_school_code: parsed.data.schoolCode,
      p_school_name: parsed.data.schoolName,
      p_business_timezone: parsed.data.businessTimezone,
      p_location_code: parsed.data.locationCode,
      p_location_name: parsed.data.locationName,
      p_cafeteria_code: parsed.data.cafeteriaCode,
      p_cafeteria_name: parsed.data.cafeteriaName,
    });
    data = rpcResponse.data;
    error = rpcResponse.error;
  } catch (rpcError) {
    console.error("Platform tenant provisioning RPC failed", {
      code: errorCode(rpcError),
    });
    return NextResponse.json({ error: "provisioning_unavailable" }, { status: 502 });
  }

  if (error) {
    console.error("Platform tenant provisioning RPC rejected the request", {
      code: error.code,
    });
    if (error.code === "42501") {
      return NextResponse.json(
        { error: "platform_authorization_required" },
        { status: 403 },
      );
    }
    if (error.code === "23505") {
      return NextResponse.json({ error: "provisioning_conflict" }, { status: 409 });
    }
    return NextResponse.json({ error: "provisioning_unavailable" }, { status: 502 });
  }

  const result = provisioningResultSchema.safeParse(data);
  if (!result.success) {
    console.error("Platform tenant provisioning RPC returned an invalid result");
    return NextResponse.json({ error: "provisioning_unavailable" }, { status: 502 });
  }

  return NextResponse.json({ result: result.data });
}
