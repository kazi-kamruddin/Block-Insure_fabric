/** Deployment identity supplied by the dev-lite launcher after a block-1 read. */
export function configuredLedgerProvisioningId(environment: NodeJS.ProcessEnv = process.env) {
  const id = environment.FABRIC_LEDGER_INSTANCE_ID;
  return id && /^[a-f0-9]{64}$/.test(id) ? id : undefined;
}
