import { NextResponse } from "next/server";
import { currentSession } from "@/lib/auth/current-session";
import { loadFabricConfig } from "@/lib/fabric/config";
import { ledger } from "@/lib/fabric/ledger";
import { isMedicalChannel } from "@/lib/fabric/medical-channel";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await currentSession().catch(() => null);
  if (!session || session.role !== "policyholder") return NextResponse.json({ message: "Policyholder access required" }, { status: 403 });
  if (!isMedicalChannel(loadFabricConfig().channelName)) return NextResponse.json({ message: "Medical candidate unavailable" }, { status: 404 });
  try {
    const packages = (await ledger.listPolicyPackages()).filter(pkg => pkg.status === "PUBLISHED" && pkg.medicalRulesVersion === 1);
    const offers = await Promise.all(packages.map(async pkg => ({
      id: pkg.id, name: pkg.name, premiumMinor: pkg.premiumMinor, coverageLimitMinor: pkg.coverageLimitMinor,
      rules: await ledger.readMedicalRules(pkg.id),
    })));
    return NextResponse.json({ offers }, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return NextResponse.json({ message: "Published medical offers are unavailable" }, { status: 503 });
  }
}
