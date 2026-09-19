export type DependencyState = "connected" | "unavailable" | "incompatible";

export type ReadinessPayload = {
  status: "ready" | "not_ready";
  service: "block-insure-web";
  timestamp: string;
  dependencies: {
    fabric: DependencyState;
    chaincode: DependencyState;
    schemaVersion: number | null;
    expectedSchemaVersion: number;
    oracle1: DependencyState;
    oracle2: DependencyState;
  };
};

type Probe = () => Promise<{ ok: boolean; schemaVersion?: number }>;

export async function buildReadinessPayload({
  fabricProbe,
  oracle1Probe,
  oracle2Probe,
  expectedSchemaVersion = 10,
  now = () => new Date().toISOString(),
}: {
  fabricProbe: Probe;
  oracle1Probe: Probe;
  oracle2Probe: Probe;
  expectedSchemaVersion?: number;
  now?: () => string;
}): Promise<ReadinessPayload> {
  const safeProbe = async (probe: Probe) => {
    try {
      return await probe();
    } catch {
      return { ok: false };
    }
  };
  const [fabric, oracle1, oracle2] = await Promise.all([
    safeProbe(fabricProbe), safeProbe(oracle1Probe), safeProbe(oracle2Probe),
  ]);
  const schemaVersion = Number.isInteger(fabric.schemaVersion) ? fabric.schemaVersion! : null;
  const compatible = fabric.ok && schemaVersion === expectedSchemaVersion;
  const ready = compatible && oracle1.ok && oracle2.ok;
  return {
    status: ready ? "ready" : "not_ready",
    service: "block-insure-web",
    timestamp: now(),
    dependencies: {
      fabric: fabric.ok ? "connected" : "unavailable",
      chaincode: compatible ? "connected" : fabric.ok ? "incompatible" : "unavailable",
      schemaVersion,
      expectedSchemaVersion,
      oracle1: oracle1.ok ? "connected" : "unavailable",
      oracle2: oracle2.ok ? "connected" : "unavailable",
    },
  };
}
