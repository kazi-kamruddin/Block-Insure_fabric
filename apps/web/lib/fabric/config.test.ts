import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadFabricConfig, resolveAuditorProfile, resolveRoleProfile } from "./config";

describe("Fabric configuration", () => {
  it("uses safe local defaults", () => {
    const config = loadFabricConfig({} as NodeJS.ProcessEnv);

    expect(config.channelName).toBe("insurance-channel");
    expect(config.chaincodeName).toBe("insurance-contract");
    expect(config.networkRoot).toBe(path.resolve(process.cwd(), "../../network"));
  });

  it("only resolves the four server-owned auditor certificate profiles", () => {
    const config = loadFabricConfig({ FABRIC_NETWORK_ROOT: "X:/fabric-network" } as unknown as NodeJS.ProcessEnv);
    expect(resolveAuditorProfile("auditor3", config).userMspPath).toContain("auditor3@auditor.blockinsure.test");
    expect(() => resolveAuditorProfile("arbitrary-user", config)).toThrow("Unknown server-owned auditor");
  });

  it("maps each application role to its own organization identity", () => {
    const environment = { FABRIC_NETWORK_ROOT: "X:/fabric-network" } as unknown as NodeJS.ProcessEnv;
    const config = loadFabricConfig(environment);
    const hospital = resolveRoleProfile("hospitalOfficer", config);
    const bank = resolveRoleProfile("bankOfficer", config);

    expect(hospital.mspId).toBe("HospitalMSP");
    expect(hospital.peerEndpoint).toBe("localhost:8051");
    expect(hospital.userMspPath).toContain("hospitalOfficer@hospital.blockinsure.test");
    expect(bank.mspId).toBe("BankMSP");
    expect(bank.peerEndpoint).toBe("localhost:12051");
  });

  it("honors an explicit network root for packaged deployments", () => {
    const config = loadFabricConfig({ FABRIC_NETWORK_ROOT: "X:/fabric-network" } as unknown as NodeJS.ProcessEnv);
    expect(config.networkRoot).toBe(path.resolve(process.cwd(), "X:/fabric-network"));
  });
});
