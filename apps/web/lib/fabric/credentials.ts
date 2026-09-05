import { promises as fs } from "node:fs";
import path from "node:path";

export async function findSingleCredential(directory: string): Promise<string> {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && !entry.name.startsWith("."))
    .map((entry) => path.join(directory, entry.name))
    .sort();

  if (files.length !== 1) {
    throw new Error(`Expected exactly one credential file in ${directory}; found ${files.length}`);
  }

  return files[0];
}

export async function loadRoleCredentials(userMspPath: string) {
  const certificatePath = await findSingleCredential(path.join(userMspPath, "signcerts"));
  const privateKeyPath = await findSingleCredential(path.join(userMspPath, "keystore"));

  const [certificate, privateKey] = await Promise.all([
    fs.readFile(certificatePath),
    fs.readFile(privateKeyPath),
  ]);

  return { certificate, privateKey };
}
