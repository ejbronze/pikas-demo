import { NextResponse } from "next/server";
import { isDemoMode } from "@/lib/env";

function unavailable() {
  const demo = isDemoMode();
  return NextResponse.json(
    { error: demo ? "demo_mode" : "pilot_feature_not_ready" },
    { status: demo ? 409 : 501 },
  );
}

export async function GET() {
  return unavailable();
}

export async function POST() {
  return unavailable();
}

export async function PATCH() {
  return unavailable();
}
