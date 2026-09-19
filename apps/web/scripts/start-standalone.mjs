import {
  loadApplicationEnvironment,
  makeApplicationPathsAbsolute,
} from "./load-environment.mjs";

loadApplicationEnvironment();
makeApplicationPathsAbsolute();
await import("../.next/standalone/server.js");
