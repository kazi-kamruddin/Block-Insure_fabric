# Submission walkthrough (LevelDB dev-lite, 1.9.0 sequence 6)

A second operator can use this guide to check the submitted Fabric build by hand. It uses the
isolated LevelDB dev-lite profile: channel `insurance-dev-lite-190`, chaincode
1.9.0 sequence 6, package SHA-256
`27a6b4e4ef031feae14de9d7c222a1a973891f93ec6b7e556d9c6c5e1acaf225`.
Sequence 6 adds bank account link requests, retries for bounced EFT
collections, and ledger-date checks on premium dates. The medical rules are
unchanged from sequence 5. The
accepted 1.8.0 deployment and the CouchDB profile stay stopped throughout.
All cases are synthetic, and the system runs on one host.

The claim and settlement IDs below were left on the ledger by the
21 November 2026 closeout run on sequence 5. They survived the upgrade to
sequence 6. Before you start, `.\scripts\dev-lite-preflight.ps1` checks
Docker, memory, ports, volumes and the backup without changing anything.

| Case | Claim | What it shows |
| --- | --- | --- |
| Routine payout | `medical-dd367ca9-cca7-4ac1-9753-f947b14bc084` | Oracle 2-of-3 approval at version 1. One BDT 40.00 payout was recovered after its response was lost. Settlement `med-settlement-463a2930-7c5`. |
| Corrected appeal | `medical-c8310aca-ca07-4913-98ff-c3895cc6eab0` | Rejected, corrected and appealed. Version 3 received fresh evidence checks and three approvals. Settlement `med-settlement-044f14b4-ac9`. |
| Suspected duplicate | `medical-0e7d0805-328e-4980-8a57-861c3edcbb4d` | A positive Oracle result still required panel review. Settlement `med-settlement-bd50e423-7ae`. |
| Final rejection | `medical-11cf830e-a30e-4aef-b976-70e4af3a8113` | Voting expired twice and the one procedural recovery was used. BDT 40.00 of cover is still reserved, so this case is ready for Part 3. |
| Bank drill | `medical-c7eae1e1-1f26-4d26-b937-92caa6bc34a4` | The Insurer authorized settlement `med-settlement-cbb65431-1ec`, which is waiting for the Bank. Part 5 uses it. |
| Second final rejection (sequence 6 staging) | `medical-c2164263-ef23-421b-86c5-522ce1245554` | Same state as the first final rejection. Use one to practise Part 3 and keep the other for the demonstration. |
| Payout waiting for the Bank (sequence 6 staging) | `medical-e94d3898-c709-45ba-96f9-fd5e218dfab3` | Settlement `med-settlement-6d33c2cb-d60` is authorized. The Bank can confirm it live in **Load medical settlement** while the app runs in normal custody. |
| EFT collections due (sequence 6 staging) | Policies `prem-policy-rich-67c216d3` and `prem-policy-poor-67c216d3` | Approved mandates due 21 November on accounts `**** 4834` (enough money) and `**** 6558` (BDT 0.50). Part 3b, step 5 uses them; they stay due on later days. |

## Part 1 — Start (about 5 minutes)

Close memory-heavy applications first; the host has 8 GB of RAM. Docker Desktop must be running. Run these from PowerShell in the repository root:

```powershell
wsl.exe -d Ubuntu -- bash -lc "cd '/mnt/e/4-1/4100 thesis/project/Block-Insure_fabric' && DEV_LITE_CHAINCODE_BUILDER=block-insure/fabric-ccenv:2.5.16-go1.26.11 bash network/scripts/network.sh --dev-lite up"
```

TLS handshake errors may appear while the peers boot. The last line must say `insurance-dev-lite-190 ready on five dev-lite peers`.

```powershell
.\scripts\dev-lite-app.ps1 -TwoOracles
```

Leave this window open until the message `Dev-lite application is available` appears. Then open
`http://127.0.0.1:3219/workspace`. Use the role buttons on that page to sign in. **Workspaces** returns you to the role list.

## Part 2 — Follow a claim through each role

1. Sign in as **Policyholder One**. Under **Medical review and appeal**, paste the routine claim ID and select **Load medical case**. The timeline shows Oracle approval, Insurer authorization, the approval certificate hash and **Payout complete**. Expand **Ledger milestones** to see the transaction times.
2. Load the corrected-appeal claim. It shows the first rejection, the clarification, the appeal at version 3 and the fresh approvals.
3. Sign in as **Bangladesh Demo Commercial Bank** and use **Load medical settlement** with `med-settlement-463a2930-7c5`. The Bank sees the amount, accounts and certificate hash, but no clinical facts or evidence.
4. Sign in as **Insurer Administrator**, load the routine claim and select **Export claim dossier**. Save the file as `routine-dossier.json` in the repository root.

## Part 3 — Return the cover of a finally rejected claim

1. Sign in as **Policyholder One** and load `medical-11cf830e-a30e-4aef-b976-70e4af3a8113`.
2. The panel says that BDT 40.00 is reserved and that no further appeal or recovery is available.
3. Select **Return reserved cover to the policy**. The panel then reports the cover as returned. A notification appears for the policyholder and for the Insurer.
4. Reload the case. The button is gone. The chaincode refuses a second release, an appeal or a recovery for this claim.

The chaincode decides this with the transaction time. Under the rules,
cover is held for 30 days after a rejection while an appeal or recovery
remains possible. The live system cannot fast-forward that time, so the
30-day path is covered by Go tests only.

## Part 3b — Bank account, premiums and automatic payment

All of this happens in the browser. It adds new synthetic records.

1. As **Policyholder One**, open **My bank and premiums**. Choose the Bank,
   enter a nickname and the last four digits of an account, and select
   **Request account link**. The request shows as PENDING.
2. As **Bangladesh Demo Commercial Bank**, open **Bank work queue**. Set a
   verified balance (for example 5.00) and select **Verify and link**. The
   customer receives a notification.
3. As the policyholder, buy a medical package in the guided workflow
   (**Accept terms and acquire medical policy**). The policy is
   PENDING_PAYMENT. In **My bank and premiums**, choose the linked account and
   select **Pay first premium now**. The OTP card below is filled in. Select
   **Email OTP**, then **Authorize premium**. The policy becomes ACTIVE.
4. Select **Set up automatic EFT payment**. As the Bank, select
   **Approve mandate**.
5. To see a collection, a bounce and a retry the same day, run
   `.\scripts\stage-dev-lite-demo.ps1 -SkipDeadline -SkipBankPayout` the
   day before. It leaves two mandates due today, one under-funded. Then:
   as the Insurer, **Premium collections and policy status** →
   **Schedule due EFT collections**; as the Bank, **Collect premium** on
   both (one completes, one bounces with insufficient funds); **Record
   customer deposit**; as the Insurer, **Retry collection**; as the Bank,
   **Collect premium** again.
6. Ask the Insurer panel to lapse a policy with a future date through the
   JSON console: the ledger refuses any date after today in Asia/Dhaka.

Start the app with `-Collections` to have the worker schedule and collect
due premiums every minute instead of clicking. With `-Email` and a Brevo
configuration (see `tools/email-gateway/README.md`) the OTP arrives by
email instead of on screen.

## Part 4 — Verify the dossier against the ledger

Read the certificate hash directly from the Insurer peer, bypassing the web Gateway:

```powershell
wsl.exe -d Ubuntu -- bash -lc "cd '/mnt/e/4-1/4100 thesis/project/Block-Insure_fabric' && bash network/scripts/read-dev-lite-certificate.sh medical-dd367ca9-cca7-4ac1-9753-f947b14bc084"
```

Copy `certificateHash` from the output into this command:

```powershell
python tools/verify-dossier/verify_dossier.py routine-dossier.json --expected-certificate-hash PASTE_HASH_HERE
```

The output shows `"anchor": "caller-supplied hash"` and exit code 0. Change one character of the hash and the verifier fails. The closeout run read `5b94b77094506a461ea8e4d7d123ef66099c93e75869e9e221cb6ea8601584d5`. Delete `routine-dossier.json` afterwards; it should not be committed.

## Part 5 — Optional: Bank key under a separate Windows account (F06)

This part checks that the web Gateway's account cannot read the Bank
signing key, and that a separate operator approves the payout. You create
the Windows account and change file permissions yourself. Do this part
last, because the normal Bank workspace cannot confirm payouts while the
key is moved.

1. Stop the app (Ctrl+C in its window). In **PowerShell run as administrator**:

   ```powershell
   New-LocalUser -Name bankop -Description "Block-Insure synthetic Bank operator"
   ```

   ```powershell
   New-Item -ItemType Directory C:\BankCustody
   ```

   ```powershell
   $bank = 'E:\4-1\4100 thesis\project\Block-Insure_fabric\data\dev-lite\organizations\peerOrganizations\bank.blockinsure.test'
   Copy-Item "$bank\users\bankOfficer@bank.blockinsure.test\msp\signcerts\cert.pem" C:\BankCustody\bank-officer-cert.pem
   Copy-Item "$bank\peers\peer0.bank.blockinsure.test\tls\ca.crt" C:\BankCustody\bank-peer-tls-ca.crt
   Move-Item "$bank\users\bankOfficer@bank.blockinsure.test\msp\keystore\3fc3840da919cf96b180f674e3698d3370eeb57984530db9866c9a3dfd7e4a95_sk" C:\BankCustody\bank-officer.key
   ```

   ```powershell
   icacls C:\BankCustody /inheritance:r /grant:r "bankop:(OI)(CI)R" "SYSTEM:(OI)(CI)F"
   ```

   ```powershell
   icacls C:\BankCustody\bank-officer.key /setowner bankop
   ```

2. In a normal (not administrator) PowerShell, run `Get-Content C:\BankCustody\bank-officer.key`. It must fail with *Access to the path is denied*. Note this result.
3. Restart the app in external custody mode:

   ```powershell
   $env:FABRIC_DEV_LITE_BANK_CUSTODY = 'external'; .\scripts\dev-lite-app.ps1 -TwoOracles
   ```

4. Open a shell as the operator with `runas /user:bankop powershell`, then run:

   ```powershell
   cd 'E:\4-1\4100 thesis\project\Block-Insure_fabric'
   node tools/bank-signer/confirm-dev-lite.mjs data\dev-lite\closeout-20261121\bank-signing-request.json C:\BankCustody\bank-officer-cert.pem C:\BankCustody\bank-officer.key C:\BankCustody\bank-peer-tls-ca.crt
   ```

   If `bankop` cannot read the repository, an administrator can grant read access with `icacls "E:\4-1\4100 thesis\project\Block-Insure_fabric" /grant "bankop:(OI)(CI)RX"`. Compare what the CLI displays with claim `medical-c7eae1e1-1f26-4d26-b937-92caa6bc34a4`, settlement `med-settlement-cbb65431-1ec`, BDT 40.00 and transfer `med-payout-cbb65431-1ec`. Then type `APPROVE med-settlement-cbb65431-1ec`.
5. Check the payout with `read-dev-lite-certificate.sh medical-c7eae1e1-1f26-4d26-b937-92caa6bc34a4`. Its `status` must be `SETTLED`.
6. **Put the key back.** In an administrator PowerShell:

   ```powershell
   $bank = 'E:\4-1\4100 thesis\project\Block-Insure_fabric\data\dev-lite\organizations\peerOrganizations\bank.blockinsure.test'
   takeown /f C:\BankCustody\bank-officer.key
   icacls C:\BankCustody\bank-officer.key /grant "${env:USERNAME}:F"
   Move-Item C:\BankCustody\bank-officer.key "$bank\users\bankOfficer@bank.blockinsure.test\msp\keystore\3fc3840da919cf96b180f674e3698d3370eeb57984530db9866c9a3dfd7e4a95_sk"
   ```

   Then delete the folder with `Remove-Item -Recurse C:\BankCustody`, optionally remove the account with `Remove-LocalUser bankop`, and restart the app without `FABRIC_DEV_LITE_BANK_CUSTODY`.

Limit: an administrator can always take ownership of the key. This
drill shows that the Gateway's ordinary account is denied and that a
different account signs. It is not hardware-backed custody.

To stage another authorized payout for the drill, run the duplicate
journey with `MEDICAL_STOP_BEFORE_BANK=true`. Use the environment of
`scripts/test-dev-lite-medical.ps1`'s duplicate step and set
`MEDICAL_PRIOR_CLAIM_ID` to a settled claim. The run writes
`authorized-result.json`. With the app in external mode, generate the
signing request as the Bank with a POST of the `confirmSettlement`
command to `/api/medical/bank-signing-request`.

## Part 6 — Optional automated rehearsal, then stop

With the app running, `.\scripts\test-dev-lite-medical.ps1` repeats the
routine, appeal and duplicate journeys. It takes about 15 minutes and adds
new synthetic claims. `.\scripts\test-dev-lite-premium.ps1` repeats the
premium journey in about 2 minutes. Run it while the app is started without
`-Collections`, so the worker does not race the scripted Bank clicks.

To stop, press Ctrl+C in the app window, then run:

```powershell
wsl.exe -d Ubuntu -- bash -lc "cd '/mnt/e/4-1/4100 thesis/project/Block-Insure_fabric' && bash network/scripts/network.sh --dev-lite stop"
```

`stop` keeps the six ledger volumes. Never run `reset`, `teardown`, Docker prune or `CleanBootstrap` for this walkthrough.
