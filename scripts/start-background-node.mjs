import { spawn } from "node:child_process";
import { closeSync, openSync } from "node:fs";

// Child stdio uses explicit files and ignored input. Native host job/pipe
// lifetime is separate from this helper's detached-process lifetime.
const args = process.argv.slice(2), separator = args.indexOf("--");
if (separator !== 6 || args[0] !== "--directory" || args[2] !== "--stdout" || args[4] !== "--stderr" || !args[7]) {
  throw new Error("Expected --directory <path> --stdout <new-log> --stderr <new-log> -- <node arguments>");
}
const output = openSync(args[3], "ax");
let errors;
try {
  errors = openSync(args[5], "ax");
  const child = spawn(process.execPath, args.slice(7), { cwd: args[1], detached: true, windowsHide: true, stdio: ["ignore", output, errors] });
  await new Promise((resolve, reject) => { child.once("spawn", resolve); child.once("error", reject); });
  child.unref();
  process.stdout.write(JSON.stringify({ id: child.pid }) + "\n");
} finally {
  closeSync(output);
  if (errors !== undefined) closeSync(errors);
}
