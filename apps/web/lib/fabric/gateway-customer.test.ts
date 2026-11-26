import { expect, it, vi } from "vitest";
import { withFabricContract } from "./gateway";

const { currentSession, loadCustomerCredentials, loadRoleCredentials } = vi.hoisted(() => ({
  currentSession: vi.fn(), loadCustomerCredentials: vi.fn(), loadRoleCredentials: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/current-session", () => ({ currentSession }));
vi.mock("@/lib/customers/settings", () => ({ onboardingEnabled: () => true }));
vi.mock("@/lib/customers/wallet", () => ({ loadCustomerCredentials }));
vi.mock("./credentials", () => ({ loadRoleCredentials }));

it("fails before loading any signing identity if the authoritative session is inactive", async () => {
  currentSession.mockResolvedValue(null);
  const action = vi.fn();
  await expect(withFabricContract("policyholder", action)).rejects.toThrow("An active policyholder session is required");
  expect(loadCustomerCredentials).not.toHaveBeenCalled();
  expect(loadRoleCredentials).not.toHaveBeenCalled();
  expect(action).not.toHaveBeenCalled();
});
