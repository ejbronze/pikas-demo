import { NextResponse } from "next/server";

// Retired: the old "Nuevo cliente" creation accepted a customer name separate from the colegio,
// which let a person's name become the customer name. Agregar colegio (/api/platform/schools/onboard)
// is the only supported creation path; it derives the customer name from the colegio.
export async function POST() {
  return NextResponse.json({ error: "route_retired", replacement: "/api/platform/schools/onboard" }, { status: 410, headers: { "Cache-Control": "no-store" } });
}
