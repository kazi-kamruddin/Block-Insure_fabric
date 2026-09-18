import { describe, expect, it } from "vitest";
import { buildReadinessPayload } from "./readiness";

const okOracle = async () => ({ ok: true });

describe("dependency readiness", () => {
  it("is ready only for the expected live Fabric schema and both Oracles", async () => {
    const payload = await buildReadinessPayload({
      fabricProbe: async () => ({ ok: true, schemaVersion: 9 }),
      oracle1Probe: okOracle,
      oracle2Probe: okOracle,
      now: () => "2026-09-13T12:00:00.000Z",
    });
    expect(payload).toMatchObject({ status: "ready", dependencies: { fabric: "connected", chaincode: "connected", oracle1: "connected", oracle2: "connected" } });
  });

  it("fails closed without exposing dependency errors", async () => {
    const payload = await buildReadinessPayload({
      fabricProbe: async () => { throw new Error("secret peer detail"); },
      oracle1Probe: okOracle,
      oracle2Probe: async () => ({ ok: false }),
    });
    expect(payload.status).toBe("not_ready");
    expect(payload.dependencies).toMatchObject({ fabric: "unavailable", chaincode: "unavailable", oracle2: "unavailable" });
    expect(JSON.stringify(payload)).not.toMatch(/secret|peer detail/i);
  });

  it("reports a reachable but incompatible chaincode schema", async () => {
    const payload = await buildReadinessPayload({
      fabricProbe: async () => ({ ok: true, schemaVersion: 6 }),
      oracle1Probe: okOracle,
      oracle2Probe: okOracle,
    });
    expect(payload).toMatchObject({ status: "not_ready", dependencies: { fabric: "connected", chaincode: "incompatible", schemaVersion: 6, expectedSchemaVersion: 9 } });
  });
});
