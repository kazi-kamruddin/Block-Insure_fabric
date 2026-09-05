import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { sessionCookieName } from "@/lib/auth/current-session";

export async function POST() {
  (await cookies()).delete(sessionCookieName);
  return NextResponse.json({ status: "signed-out" });
}
