import type { FabricRole } from "@/lib/fabric/config";

export type DemoAccountId = keyof typeof demoAccounts;

export type DemoAccount = {
  id: DemoAccountId;
  displayName: string;
  organization: string;
  role: FabricRole;
  subjectId?: string;
};

export const demoAccounts = {
  "insurer-admin": {
    id: "insurer-admin",
    displayName: "Insurer Administrator",
    organization: "InsurerMSP",
    role: "insurerAdmin",
  },
  "policyholder-1": {
    id: "policyholder-1",
    displayName: "Policyholder One",
    organization: "InsurerMSP",
    role: "policyholder",
    subjectId: "policyholder1",
  },
  "hospital-officer": {
    id: "hospital-officer",
    displayName: "Hospital Officer",
    organization: "HospitalMSP",
    role: "hospitalOfficer",
  },
  auditor: {
    id: "auditor",
    displayName: "Independent Auditor",
    organization: "AuditorMSP",
    role: "auditor",
  },
  "bank-officer": {
    id: "bank-officer",
    displayName: "Bank Officer",
    organization: "BankMSP",
    role: "bankOfficer",
  },
} as const satisfies Record<string, Omit<DemoAccount, "id"> & { id: string }>;

export function findDemoAccount(id: string): DemoAccount | undefined {
  return demoAccounts[id as DemoAccountId] as DemoAccount | undefined;
}

export const workspaceByRole: Record<FabricRole, string> = {
  insurerAdmin: "insurer",
  policyholder: "policyholder",
  hospitalOfficer: "hospital",
  auditor: "auditor",
  bankOfficer: "bank",
};

export function workspaceForAccount(account: DemoAccount) {
  return workspaceByRole[account.role];
}
