import { NextResponse } from "next/server";
import { readHospitalRegistrySnapshot } from "@/lib/oracle/hospital-registry";
import { verifyBearerToken } from "@/lib/security/bearer-token";

export const runtime = "nodejs";
type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: RouteContext) {
  const headers = { "cache-control": "no-store" };
  if (!verifyBearerToken(request.headers.get("authorization"), process.env.ORACLE_REGISTRY_API_TOKEN)) {
    return NextResponse.json({ message: "Authorized Oracle context access is required" }, { status: 403, headers });
  }
  try {
    const snapshot = await readHospitalRegistrySnapshot((await context.params).id);
    return NextResponse.json(snapshot, { headers });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return NextResponse.json({ message: code === "ENOENT" ? "Registry snapshot not found" : "Invalid registry snapshot" }, { status: code === "ENOENT" ? 404 : 400, headers });
  }
}
