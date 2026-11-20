export const medicalCandidateChannel = "insurance-medical-reimbursement";
export const medicalDevLiteChannel = "insurance-dev-lite-190";

export function isMedicalChannel(channel: string) {
  return channel === medicalCandidateChannel || channel === medicalDevLiteChannel;
}
