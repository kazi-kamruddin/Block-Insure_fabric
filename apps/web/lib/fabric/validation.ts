import { z } from "zod";

// Keep HTTP input aligned with the chaincode's stateKey validation.
export const ledgerIdSchema = z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/);
export const ledgerDateSchema = z.iso.date();
