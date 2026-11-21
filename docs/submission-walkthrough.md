# Submission walkthrough (LevelDB dev-lite, 1.9.0 sequence 7)

A second operator can use this guide to check the submitted Fabric build by hand. It uses the
isolated LevelDB dev-lite profile: channel `insurance-dev-lite-190`, chaincode
1.9.0 sequence 7, package SHA-256
`d6da2d7759681c5c50c895187844f3d6bd0e1b8a3caa31949c58e89000843ec9`.
Sequence 7 uses realistic taka amounts (a BDT 1,250 premium per 30 days,
BDT 300,000 of cover, and a BDT 85,000 hospital bill that pays BDT 64,000)
and adds the medical cover rules: no backdated cover, cover from the first
paid premium, a 15-day grace period, Insurer reinstatement after a lapse,
and EFT for the first premium. Sequence 6 added bank account links, EFT
retries and ledger-date checks; sequence 5 the medical rules. The
accepted 1.8.0 deployment and the CouchDB profile stay stopped throughout.
All cases are synthetic, and the system runs on one host.

The first five claims below were left on the ledger by the 21 November
2026 closeout run on sequence 5 and still use its small amounts (BDT 40.00
payouts). They survived the upgrades to sequences 6 and 7. Before you start, `.\scripts\dev-lite-preflight.ps1` checks
Docker, memory, ports, volumes and the backup without changing anything.

| Case | Claim | What it shows |
| --- | --- | --- |
| Routine payout | `medical-dd367ca9-cca7-4ac1-9753-f947b14bc084` | Oracle 2-of-3 approval at version 1. One BDT 40.00 payout was recovered after its response was lost. Settlement `med-settlement-463a2930-7c5`. |
| Corrected appeal | `medical-c8310aca-ca07-4913-98ff-c3895cc6eab0` | Rejected, corrected and appealed. Version 3 received fresh evidence checks and three approvals. Settlement `med-settlement-044f14b4-ac9`. |
| Suspected duplicate | `medical-0e7d0805-328e-4980-8a57-861c3edcbb4d` | A positive Oracle result still required panel review. Settlement `med-settlement-bd50e423-7ae`. |
| Final rejection | `medical-11cf830e-a30e-4aef-b976-70e4af3a8113` | Voting expired twice and the one procedural recovery was used. BDT 40.00 of cover is still reserved, so this case is ready for Part 3. |
| Bank drill | `medical-c7eae1e1-1f26-4d26-b937-92caa6bc34a4` | The Insurer authorized settlement `med-settlement-cbb65431-1ec`, which is waiting for the Bank. Part 5 uses it. |
| Final rejection, realistic amounts (sequence 7 staging) | `medical-580007c9-2b0c-467f-9d4f-5c5fa5810a6b` | A BDT 190,000 surgery claim whose voting expired twice and whose one recovery was used. Its cover is still reserved. Use this or the claim above for Part 3. |
| Payout waiting for the Bank (sequence 7 staging) | `medical-328c1075-969c-4726-a454-28127ba8f4be` | The same stay as routine claim `med-concurrent-ce3a3d8c-199` was claimed again on the same policy, referred as a suspected duplicate and approved by the panel. Settlement `med-settlement-cca3c736-52c` (BDT 64,000.00) is authorized. The Bank can confirm it live in **Load medical settlement** while the app runs in normal custody. |
| EFT first premiums due (sequence 7 staging) | Policies `prem-policy-rich-dc7d1795` and `prem-policy-poor-dc7d1795` | Both start on 22 November and pay their first BDT 1,250.00 premium by an approved EFT mandate due that day, from accounts `**** 3696` (enough money) and `**** 7489` (under-funded). Part 3b, step 5 uses them. They can be collected until the first-premium deadline, 7 December. `prem-policy-otp-dc7d1795` was paid by OTP. |

Sequence 6 staging also left final rejection `medical-c2164263-ef23-421b-86c5-522ce1245554` and authorized settlement `med-settlement-6d33c2cb-d60` (claim `medical-e94d3898-…`) with the older small amounts.

## Part 1 — Start (about 5 minutes)

Close memory-heavy applications first; the host has 8 GB of RAM. Docker Desktop must be running. Run these from PowerShell in the repository root:

```powershell
wsl.exe -d Ubuntu -- bash -lc "cd '/mnt/e/4-1/4100 thesis/project/Block-Insure_fabric' && DEV_LITE_CHAINCODE_BUILDER=block-insure/fabric-ccenv:2.5.16-go1.26.11 bash network/scripts/network.sh --dev-lite up"
```

TLS handshake errors may appear while the peers boot. The last line must say `insurance-dev-lite-190 ready on five dev-lite peers`.

```powershell
.\scripts\dev-lite-app.ps1 -TwoOracles -Onboarding
```

Leave this window open until the message `Dev-lite application is available` appears. Open
`http://127.0.0.1:3219/workspace`. Choose **Customer sign-in** for your own account or
choose a role under **Staff sign-in (demo)**. **Workspaces** returns you to that page.
The archived cases below belong to the legacy policyholder. To show those cases
in the browser, set `$env:SHOW_LEGACY_POLICYHOLDER_LOGIN='true'` in the launcher
PowerShell window before starting the app. This enables the legacy **Policyholder
One** button for that session.

### Sign up a new customer

1. Choose **Create an insurance account**. Enter a synthetic email address, select
   **Send code**, verify the on-screen demo code, and submit a synthetic profile
   with consent. This rehearsal runs without the email connector.
2. Sign in as **Insurer Administrator**. Open **Customer onboarding**, refresh
   the queue, and approve the pending profile. Approval enrolls a distinct
   Fabric identity and makes the account active.
3. Use **Customer sign-in** once the 60-second resend window has passed.
   **My profile** shows the account details. The printable **Insurance card**
   shows the member ID, and shows policy and cover dates after a purchase.
4. Buy a published medical package, link a Bank account, and pay the first
   premium in **My bank and premiums**. At the Hospital, enter the member ID
   from the card when recording a stay. The Insurer opens **Episode association
   queue**, selects **Resolve association**, reviews the suggested match, and
   confirms the covered patient through the existing association action.

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
   verified balance (the default is 25,000.00) and select **Verify and link**. The
   customer receives a notification.
3. As the policyholder, buy a medical package in the guided workflow
   (**Accept terms and acquire medical policy**). The start date must be
   today or up to 60 days ahead, and the term at most one year; a past start
   date is refused because cover is never backdated. The policy is
   PENDING_PAYMENT. In **My bank and premiums**, choose the linked account and
   select **Pay first premium now** (BDT 1,250.00). The OTP card below is
   filled in. Select **Email OTP**, then **Authorize premium**. The policy
   becomes ACTIVE and shows **cover from** today: cover starts when the
   first premium is paid, not before.
4. Select **Set up automatic EFT payment**. As the Bank, select
   **Approve mandate**. A second mandate for the same policy is refused.
5. To see a collection, a bounce and a retry, run
   `.\scripts\stage-dev-lite-demo.ps1 -SkipDeadline -SkipBankPayout` the
   day before. It buys two policies that start on demo day and pay their
   first premium by EFT, one from an under-funded account. Then:
   as the Insurer, **Premium collections and policy status** →
   **Schedule due EFT collections**; as the Bank, **Collect premium** on
   both. One policy becomes ACTIVE; the other bounces with insufficient
   funds and stays PENDING_PAYMENT. **Record customer deposit**; as the
   Insurer, **Retry collection**; as the Bank, **Collect premium** again,
   and the second policy becomes ACTIVE.
6. Ask the Insurer panel to lapse a policy with a future date through the
   JSON console: the ledger refuses any date after today in Asia/Dhaka.

An installment can be paid until 15 days after its due date. After that the
policy has lapsed: the panel disables payment, and the Insurer's **Lapsed
medical policies** list offers **Reinstate from today**. The reinstatement
premium must be paid that day, the days in between stay uncovered and the
waiting period restarts. A live demonstration would need 15 days of ledger
time, so this path is covered by Go tests only.

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
