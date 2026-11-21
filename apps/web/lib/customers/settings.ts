import path from "node:path";
import { medicalDevLiteChannel } from "@/lib/fabric/medical-channel";

export function onboardingEnabled() {
  return process.env.DEV_LITE_ONBOARDING === "true" && process.env.FABRIC_CHANNEL_NAME === medicalDevLiteChannel;
}

export function customerStateRoot() {
  const root = process.env.CUSTOMER_STATE_ROOT;
  if (!onboardingEnabled() || !root || !path.isAbsolute(root)) throw new Error("Customer onboarding storage is unavailable");
  return root;
}

export function localCustomerCodes() {
  const origin = process.env.APP_ORIGIN;
  return onboardingEnabled() && process.env.ENABLE_DEMO_AUTH === "true" && !process.env.EMAIL_GATEWAY_URL?.trim()
    && !!origin && new URL(origin).hostname === "127.0.0.1";
}
