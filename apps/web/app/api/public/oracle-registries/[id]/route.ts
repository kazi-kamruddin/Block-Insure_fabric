import { NextResponse } from "next/server";
import { readHospitalRegistrySnapshot } from "@/lib/oracle/hospital-registry";

export const runtime = "nodejs";
type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: RouteContext) {
  try {
    const snapshot = await readHospitalRegistrySnapshot((await context.params).id);
    return NextResponse.json(snapshot, { headers: { "cache-control": "public, max-age=31536000, immutable" } });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return NextResponse.json({ message: code === "ENOENT" ? "Registry snapshot not found" : "Invalid registry snapshot" }, { status: code === "ENOENT" ? 404 : 400 });
  }
}
