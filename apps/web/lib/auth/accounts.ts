import type { FabricRole } from "@/lib/fabric/config";

export type DemoAccountId = keyof typeof demoAccounts;

export type DemoAccount = {
  id: DemoAccountId;
  displayName: string;
  organization: string;
  role: FabricRole;
  subjectId?: string;
  fabricUserName?: string;
  email?: string;
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
    email: "policyholder1@block-insure.demo",
  },
  "hospital-officer": {
    id: "hospital-officer",
    displayName: "Dhaka Central Medical Hospital",
    organization: "HospitalMSP",
    role: "hospitalOfficer",
    subjectId: "hospital-demo",
    fabricUserName: "hospital1",
  },
  "hospital-officer-2": {
    id: "hospital-officer-2",
    displayName: "Chattogram Metropolitan Hospital",
    organization: "HospitalMSP",
    role: "hospitalOfficer",
    subjectId: "hospital-2",
    fabricUserName: "hospital2",
  },
  "hospital-officer-3": {
    id: "hospital-officer-3",
    displayName: "Rajshahi Community Hospital",
    organization: "HospitalMSP",
    role: "hospitalOfficer",
    subjectId: "hospital-3",
    fabricUserName: "hospital3",
  },
  "hospital-officer-4": {
    id: "hospital-officer-4",
    displayName: "Khulna Riverside Hospital",
    organization: "HospitalMSP",
    role: "hospitalOfficer",
    subjectId: "hospital-4",
    fabricUserName: "hospital4",
  },
  "hospital-officer-5": {
    id: "hospital-officer-5",
    displayName: "Sylhet Valley Hospital",
    organization: "HospitalMSP",
    role: "hospitalOfficer",
    subjectId: "hospital-5",
    fabricUserName: "hospital5",
  },
  auditor: {
    id: "auditor",
    displayName: "Independent Auditor One",
    organization: "AuditorMSP",
    role: "auditor",
    subjectId: "auditor1",
    fabricUserName: "auditor1",
  },
  "auditor-2": {
    id: "auditor-2",
    displayName: "Independent Auditor Two",
    organization: "AuditorMSP",
    role: "auditor",
    subjectId: "auditor2",
    fabricUserName: "auditor2",
  },
  "auditor-3": {
    id: "auditor-3",
    displayName: "Independent Auditor Three",
    organization: "AuditorMSP",
    role: "auditor",
    subjectId: "auditor3",
    fabricUserName: "auditor3",
  },
  "auditor-4": {
    id: "auditor-4",
    displayName: "Independent Auditor Four",
    organization: "AuditorMSP",
    role: "auditor",
    subjectId: "auditor4",
    fabricUserName: "auditor4",
  },
  "bank-officer": {
    id: "bank-officer",
    displayName: "Bangladesh Demo Commercial Bank",
    organization: "BankMSP",
    role: "bankOfficer",
    subjectId: "bank-demo",
  },
} as const satisfies Record<string, Omit<DemoAccount, "id"> & { id: string }>;

export function findDemoAccount(id: string): DemoAccount | undefined {
  return demoAccounts[id as DemoAccountId] as DemoAccount | undefined;
}

export function findDemoAccountBySubject(subjectId: string): DemoAccount | undefined {
  return Object.values(demoAccounts).find((account) => "subjectId" in account && account.subjectId === subjectId) as DemoAccount | undefined;
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
