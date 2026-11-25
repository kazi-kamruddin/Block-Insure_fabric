export type DependencyState = "connected" | "unavailable" | "incompatible";

export type ReadinessPayload = {
  status: "ready" | "not_ready";
  service: "block-insure-web";
  timestamp: string;
  oracleQuorumAvailable: boolean;
  oracleRosterReady: boolean;
  dependencies: {
    fabric: DependencyState;
    chaincode: DependencyState;
    schemaVersion: number | null;
    expectedSchemaVersion: number;
    oracle1: DependencyState;
    oracle2: DependencyState;
    oracle3: DependencyState;
  };
};

type Probe = () => Promise<{ ok: boolean; schemaVersion?: number }>;

export function summarizeOracleReadiness(healthyWorkers: number) {
  return {
    oracleQuorumAvailable: healthyWorkers >= 2,
    oracleRosterReady: healthyWorkers === 3,
  };
}

export async function buildReadinessPayload({
  fabricProbe,
  oracle1Probe,
  oracle2Probe,
  oracle3Probe,
  expectedSchemaVersion = 15,
  now = () => new Date().toISOString(),
}: {
  fabricProbe: Probe;
  oracle1Probe: Probe;
  oracle2Probe: Probe;
  oracle3Probe: Probe;
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
  const [fabric, oracle1, oracle2, oracle3] = await Promise.all([
    safeProbe(fabricProbe), safeProbe(oracle1Probe), safeProbe(oracle2Probe), safeProbe(oracle3Probe),
  ]);
  const schemaVersion = Number.isInteger(fabric.schemaVersion) ? fabric.schemaVersion! : null;
  const compatible = fabric.ok && schemaVersion === expectedSchemaVersion;
  const oracleReadiness = summarizeOracleReadiness([oracle1, oracle2, oracle3].filter(probe => probe.ok).length);
  const ready = compatible && oracleReadiness.oracleRosterReady;
  return {
    status: ready ? "ready" : "not_ready",
    service: "block-insure-web",
    timestamp: now(),
    ...oracleReadiness,
    dependencies: {
      fabric: fabric.ok ? "connected" : "unavailable",
      chaincode: compatible ? "connected" : fabric.ok ? "incompatible" : "unavailable",
      schemaVersion,
      expectedSchemaVersion,
      oracle1: oracle1.ok ? "connected" : "unavailable",
      oracle2: oracle2.ok ? "connected" : "unavailable",
      oracle3: oracle3.ok ? "connected" : "unavailable",
    },
  };
}
