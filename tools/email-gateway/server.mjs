import { readFileSync } from "node:fs";
import { createGateway } from "./gateway.mjs";

const configPath = process.env.EMAIL_GATEWAY_CONFIG;
if (!configPath) throw new Error("EMAIL_GATEWAY_CONFIG must name the ignored email-gateway.json file");
const port = Number(process.env.EMAIL_GATEWAY_PORT ?? 3330);
const gateway = createGateway({
  config: JSON.parse(readFileSync(configPath, "utf8")),
  token: process.env.EMAIL_GATEWAY_TOKEN ?? "",
  log: (entry) => console.log(JSON.stringify({ timestamp: new Date().toISOString(), service: "email-gateway", ...entry })),
});
gateway.listen(port, "127.0.0.1", () => console.log(JSON.stringify({ service: "email-gateway", status: "ONLINE", port })));
