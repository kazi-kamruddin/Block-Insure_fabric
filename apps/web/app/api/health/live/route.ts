import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(
    { status: "alive", service: "block-insure-web", timestamp: new Date().toISOString() },
    { headers: { "Cache-Control": "no-store" } },
  );
}
