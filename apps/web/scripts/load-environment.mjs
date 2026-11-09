import nextEnvironment from "@next/env";
import { isAbsolute, resolve } from "node:path";

const { loadEnvConfig } = nextEnvironment;
const configuredPathNames = [
  "FABRIC_NETWORK_ROOT",
  "EVENT_PROJECTION_ROOT",
  "EVIDENCE_STORAGE_ROOT",
  "OTP_STATE_ROOT",
];

export function loadApplicationEnvironment(directory = process.cwd()) {
  loadEnvConfig(directory);
}

export function makeApplicationPathsAbsolute(directory = process.cwd()) {
  process.env.OTP_STATE_ROOT ||= resolve(directory, "../../data/otp");
  for (const name of configuredPathNames) {
    const value = process.env[name];
    if (value && !isAbsolute(value)) process.env[name] = resolve(directory, value);
  }
}
