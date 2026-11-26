# Signing and key custody

Dev-lite uses enrolled Fabric identities and shared workstation custody. A
browser session identifies a person to the application. The Gateway or a
staff-side service holds the credentials that sign Fabric operations.
Distinct institutions in the model would need distinct operators and
protected signing environments. Per-organisation gateways remain future work.

| Key or credential | Current custodian | What it authorizes or protects |
| --- | --- | --- |
| Insurer staff Fabric identity | Gateway process and its OS operator, using the enrolled Insurer staff MSP directory | Fabric proposals, evaluations and transactions as insurerAdmin. Covers product publication, association verification, review preparation, Oracle request creation and settlement authorization as permitted by chaincode. |
| Hospital staff Fabric identities | Gateway process and its OS operator, with the hospital-specific enrollment selected by the server | Fabric proposals and transactions as the assigned hospital subject, including episode revisions and attestation for that hospital's scoped registry. |
| Four Auditor Fabric identities | Gateway process and its OS operator, using the four enrolled Auditor subjects | Fabric transactions to confirm evidence and cast the assigned reviewer vote. The review enforces three approvals or two rejections. |
| Bank staff Fabric identity, ordinary demo | Gateway process and its OS operator | Fabric account, payout and premium operations authorized for the Bank role. The Bank and Insurer peers endorse Bank collection changes. |
| Bank staff Fabric identity, external F06 mode | Separate Windows Bank operator, through the standalone signer | The Bank signer signs its peer evaluations and the explicitly approved settlement proposal and transaction. Application external mode disables Bank Fabric connections. |
| Onboarded customer Fabric identities | Gateway-controlled encrypted customer wallet | Evaluation and submissions for the signed-in customer subject. The Gateway verifies the active session again before signing. The preserved legacy demo account uses its enrolled server-side identity. |
| Insurer CA registrar and CA signing keys | Registrar credential under the Gateway onboarding configuration. CA issuer keys stay with the CA operator. | The registrar signs enrollment registration requests. The CA issues enrollment certificates. Neither operation grants a browser direct Fabric signing access. |
| Oracle Fabric identities | Each Oracle process loads the enrolled private key for its configured Oracle subject | Evaluations and that subject's commits and reveals. The service also uses its private key bytes as input to deterministic salt generation and pinned decision authentication. The demo processes share one OS operator and one OracleMSP. |
| Peer and orderer MSP and TLS keys | Fabric peer/orderer processes and network operator | Peer endorsement and other node signatures, ordering, and TLS endpoint authentication. End-user transaction intent uses a separate client enrollment. |
| Application auth and OTP secrets | Gateway and the ignored profile application secret store | HMAC application sessions and OTP verification. These credentials have no Fabric signing authority. |
| Wallet and PII keys | Gateway profile application secret store | Wallet key seals customer identity private keys. PII key protects local customer information and identity matching fields. |
| Review messages and reason-receipt keys | Gateway profile application secret store | Separate AES-GCM custody for review notes and bound vote reason receipts. Authorized application disclosure depends on the Gateway operator maintaining these keys. |
| Registry bearer and service credentials | Gateway and the relevant processes on the workstation | Access to the private registry snapshot API and authenticated app services. Bearer access does not confer a Fabric role. |
| Evidence content passphrase | Originating customer or other authorized holder, shared through the evidence procedure | Browser-side evidence encryption and decryption. Ledger hashes bind evidence; they do not transfer the content secret. |
| Duplicate-index secret | Oracle PDC for authorized chaincode peers | Keys the duplicate screening index. It is a secret for application matching and has no Fabric signing authority. |
| Phase 2 issuer Ed25519 keys | Design assigns one issuer key to each adapter/operator | Sign source records, feed and coverage manifests, and optional retrieval receipts within the configured issuer authority. The approval/anchor transaction still uses a Fabric identity. |

Sources [Gateway configuration](../apps/web/lib/fabric/config.ts)
[Gateway signing](../apps/web/lib/fabric/gateway.ts)
[Customer wallet](../apps/web/lib/customers/wallet.ts)
[CA registration](../apps/web/lib/fabric/ca-client.ts)
[Oracle signing](../services/oracle-worker/src/gateway.mjs)
[Oracle decisions](../services/oracle-worker/src/index.mjs)
[Application secrets](../scripts/dev-lite-app.ps1)
[Evidence security](evidence-security.md)
[Collection activation](../chaincode/insurance-contract/src/medical_approval.go)

For the demonstration, open four named browser profiles for `auditor1`
through `auditor4`. Verify the signed-in identity in each profile before
voting and record each simulated role separately. Browser profiles isolate
session presentation while the demo Gateway retains all four signers.

## F06 Bank key access drill

**Status: BLOCKED-OWNER.** The previously recorded external signer transaction
demonstrated application mode and a separate process. This drill adds the
separate Windows identity and access-control check. Only the owner performs
ACL administration or authorizes a synthetic payout. [Earlier F06 finding](results/FINDINGS.md)
[Bank signer operator guide](../tools/bank-signer/README.md)

1. Choose a synthetic, already authorized payout on the approved LevelDB
   dev-lite test fixture. Record the expected settlement ID, amount, accounts,
   current claim version and certificate hash. Stop the dev-lite app with
   the approved shutdown procedure before altering key access. Record its
   original custody mode and the original ACL in restricted operator records.
2. Use distinct, non-elevated Windows accounts for the Gateway process and
   Bank signing operator. An administrator should give the Bank operator read
   access to the Bank signer and nonsecret certificate, TLS CA and unsigned
   request. Restrict access to the existing enrolled Bank key in place. Give
   the Bank operator read data permission and deny that permission to the
   Gateway account. Review ownership, inherited ACEs, group membership,
   accessible backups and duplicate credentials. Keep administrative recovery
   access under separate custody. Limit permissions on the checkout to the
   files the standalone signer needs.
3. In an ordinary shell under the Bank operator account, set `$BankKeyPath` to
   the agreed enrolled file and run the following probe. Record
   `READ_HANDLE_OPENED`. Use the same exact file under the Gateway service's
   ordinary Windows account and record `ACCESS_DENIED`. Verify the actual
   account for each shell with `whoami`. A missing file, unreadable parent
   path from misconfiguration or another I/O error requires diagnosis before
   accepting either result.

   ```powershell
   $keyHandle = $null
   try {
       $keyHandle = [System.IO.File]::Open(
           $BankKeyPath, [System.IO.FileMode]::Open,
           [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite
       )
       'READ_HANDLE_OPENED'
   } catch [System.UnauthorizedAccessException] {
       'ACCESS_DENIED'
   } finally {
       if ($null -ne $keyHandle) { $keyHandle.Dispose() }
   }
   ```

   The probe requests a read handle and closes it without consuming or printing
   key bytes. Treat a readable Gateway handle as a failed drill.

4. Start the app under the Gateway account with
   `FABRIC_DEV_LITE_BANK_CUSTODY=external` and confirm the app is in the
   external signing path. In a Bank-authenticated session, obtain an unsigned
   request from `/api/medical/bank-signing-request`. Pass that request to
   the Bank operator using the approved local handoff. Gateway custody of
   other roles and ordinary policyholder workflows continues.
5. Under the Bank account, set `$RequestJson`, `$BankCertPath`,
   `$BankKeyPath` and `$BankPeerTlsCaPath` to the agreed local files. Use
   the standalone signer with installed web dependencies from this repo:

   ```powershell
   node tools/bank-signer/confirm-dev-lite.mjs $RequestJson $BankCertPath $BankKeyPath $BankPeerTlsCaPath
   ```

   Compare the signer readback against the staged settlement. Enter the CLI's
   confirmation phrase only after explicit owner approval for the ledger
   write. Record successful commit status, transaction ID and an independent
   settlement readback. A lost response requires readback before retrying.
6. Preserve the enrolled identity and audit evidence. Restore the authorized
   original ACL and app mode only if the owner wants routine Gateway Bank
   custody again. Record the two OS roles, handle probe outcomes, test
   settlement, commit status and any remaining readable copies. Keep
   credentials out of the drill record.

An administrator with ownership or backup privileges can bypass routine ACL
separation. F06 measures ordinary OS account separation and independent
operator confirmation on one host.
