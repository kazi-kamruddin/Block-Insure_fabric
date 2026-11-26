import type { HospitalRegistrySnapshotFile } from "./registry-manifest";

export function archiveRegistrySnapshot(directory: string, snapshot: HospitalRegistrySnapshotFile): Promise<string>;
