export type GovernanceRole = "insurerAdmin" | "auditor" | "hospitalOfficer";
type Field = { name: string; label: string; type?: "number" | "json"; optional?: boolean };
type Action = { label: string; roles: GovernanceRole[]; fields: Field[] };
const issuer = { name: "issuerId", label: "Issuer ID" };
const key = { name: "keyVersion", label: "Key version", type: "number" } as const;
const roster = { name: "version", label: "Roster version" };
const release = { name: "releaseId", label: "Release ID" };
const hash = (label: string) => ({ name: "digest", label });

export const oracleGovernanceActions = {
  ProposeSourceIssuer: { label: "Propose issuer", roles: ["insurerAdmin"], fields: [
    issuer, { name: "kind", label: "Kind" }, { name: "publicKey", label: "Ed25519 public key (base64url SPKI)" }, key,
    { name: "validFrom", label: "Valid from (UTC timestamp)" }, { name: "validUntil", label: "Valid until (UTC timestamp)" },
    { name: "facts", label: "Authorized facts (JSON array)", type: "json" }, { name: "controlDomain", label: "Control domain" },
    { name: "hospitalId", label: "Hospital ID for a HIS issuer", optional: true },
  ] },
  ApproveSourceIssuer: { label: "Approve issuer key", roles: ["insurerAdmin", "auditor", "hospitalOfficer"], fields: [issuer, key] },
  RevokeSourceIssuer: { label: "Revoke issuer key", roles: ["insurerAdmin", "auditor"], fields: [issuer, key] },
  AnchorSourceFeed: { label: "Anchor a signed feed", roles: ["hospitalOfficer", "insurerAdmin"], fields: [
    issuer, key, { name: "feedVersion", label: "Feed version", type: "number" }, hash("Merkle root"),
    { name: "effectiveAt", label: "Effective at (UTC timestamp)" }, { name: "coverageHash", label: "Coverage hash" },
    { name: "signature", label: "Anchor signature (base64url)" },
  ] },
  ProposeOracleRoster: { label: "Propose three-subject roster", roles: ["insurerAdmin"], fields: [
    roster, { name: "subjects", label: "Three subject IDs and key versions (JSON array)", type: "json" },
  ] },
  ApproveOracleRoster: { label: "Approve roster", roles: ["insurerAdmin", "auditor"], fields: [roster] },
  ActivateOracleRoster: { label: "Activate roster", roles: ["insurerAdmin"], fields: [roster] },
  RevokeOracleSubject: { label: "Revoke Oracle key", roles: ["insurerAdmin", "auditor"], fields: [
    { name: "subject", label: "Oracle subject" }, key, hash("Revocation reason hash"),
  ] },
  RegisterMedicalModelRelease: { label: "Register model release", roles: ["insurerAdmin"], fields: [
    release, { name: "modelVersion", label: "Model version" }, hash("Evaluator artifact hash"),
    { name: "featureSchema", label: "Feature schema" }, { name: "calibrationVersion", label: "Calibration version" },
    { name: "task", label: "ROUTING or ADVISORY" },
  ] },
  ShadowMedicalModelRelease: { label: "Record shadow evidence", roles: ["insurerAdmin"], fields: [release, hash("Shadow evidence hash")] },
  ApproveMedicalModelRelease: { label: "Approve model release", roles: ["insurerAdmin", "auditor"], fields: [release] },
  ActivateMedicalModelRelease: { label: "Activate approved release", roles: ["insurerAdmin"], fields: [release] },
  HoldMedicalModelRelease: { label: "Hold release", roles: ["insurerAdmin", "auditor"], fields: [release, hash("Hold reason hash")] },
  RequestMedicalModelResume: { label: "Request held release resume", roles: ["insurerAdmin"], fields: [release, hash("Resume reason hash")] },
} satisfies Record<string, Action>;

export type GovernanceAction = keyof typeof oracleGovernanceActions;
export type GovernanceRecord = { id?: string; issuerId?: string; kind?: string; keyVersion?: number; feedVersion?: number;
  hospitalId?: string;
  root?: string; version?: string; status?: string; approvedAt?: string; subjects?: Array<{ subjectId: string; keyVersion: number }>;
  approvedMsps?: string[]; modelVersion?: string; activationEligibleAt?: string };
export type GovernanceView = { supported: boolean; issuers: GovernanceRecord[]; feeds: GovernanceRecord[];
  rosters: GovernanceRecord[]; releases: GovernanceRecord[] };
