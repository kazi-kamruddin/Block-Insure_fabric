import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { readHospitalRegistrySnapshot } from "@/lib/oracle/hospital-registry";

export const runtime = "nodejs";
type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: RouteContext) {
  try {
    const snapshot = await readHospitalRegistrySnapshot((await context.params).id);
    if (snapshot.modelContext) {
      const secret = process.env.ORACLE_REGISTRY_API_TOKEN ?? "";
      const expected = Buffer.from(`Bearer ${secret}`);
      const supplied = Buffer.from(request.headers.get("authorization") ?? "");
      if (secret.length < 32 || expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) {
        return NextResponse.json({ message: "Authorized Oracle context access is required" }, { status: 403, headers: { "cache-control": "no-store" } });
      }
      return NextResponse.json(snapshot, { headers: { "cache-control": "no-store" } });
    }
    return NextResponse.json(snapshot, { headers: { "cache-control": "public, max-age=31536000, immutable" } });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return NextResponse.json({ message: code === "ENOENT" ? "Registry snapshot not found" : "Invalid registry snapshot" }, { status: code === "ENOENT" ? 404 : 400 });
  }
}
