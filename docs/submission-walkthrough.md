# Submission walkthrough (LevelDB dev-lite, 1.9.0)

A second operator can use this guide to check the submitted Fabric build by hand. It uses the
isolated LevelDB dev-lite profile: channel `insurance-dev-lite-190`, chaincode
1.9.0, package SHA-256
`d6da2d7759681c5c50c895187844f3d6bd0e1b8a3caa31949c58e89000843ec9`
(the sequence-7 realism build, committed at sequence 1 on the ledger rebuilt
on 24 November 2026). It uses realistic taka amounts (a BDT 85,000 hospital
admission under Hospital Care Plus pays BDT 64,000) and adds the medical cover rules: no backdated cover, cover from the first
paid premium, a 15-day grace period, Insurer reinstatement after a lapse,
and EFT for the first premium. Sequence 6 added bank account links, EFT
retries and ledger-date checks; sequence 5 the medical rules. The
accepted 1.8.0 deployment and the CouchDB profile stay stopped throughout.
All cases are synthetic, and the system runs on one host.

**24 November 2026: the dev-lite ledger was rebuilt.** The same package
(`d6da2d77…`) is now committed at sequence 1 on a fresh ledger. The claim,
settlement and policy IDs in the history table further down were on the
replaced ledger and no longer exist. The fresh ledger holds only the set
seeded by `scripts/seed-dev-lite-demo.ps1` (summary in
`data/dev-lite/demo-seed/`):

- **Partners:** Dhaka Central Medical Hospital, Chattogram Metropolitan
  Hospital, Rajshahi Community Hospital and Bangladesh Demo Commercial Bank.
- **Plans (one service each):** Shastho Shurokkha Hospital Cover (BDT 950),
  Hospital Care Plus (BDT 2,450), Surgical Shield (BDT 1,500), Diagnostics
  Care (BDT 650) and Doctor Visit Care (BDT 450).
- **Customers:** Kazi Kamruddin Ahmed, Sumit Majumder, Abdullah Ishtiaq,
  Sadik Rahman and Rakibul Islam. They sign in at **Customer sign-in** with
  `kazi.ahmed@example.com` or `firstname.lastname@example.com`; the code is
  shown on screen.
- **Policies:** `POL-2026-000101`…`000105`. Rakibul's first premium (EFT
  mandate `MND-2026-0105`) is still due.
- **Claims:**
  - `CLM-2026-000201`: Kazi, BDT 64,000 SETTLED. Use it for Parts 2 and 4.
    Its certificate hash is
    `6c7021fb3d4e2f83be17c0e7c6ab1477b86b6bf357e58edc14625475ec54f38a`.
  - `CLM-2026-000202`: Sumit, settlement `STL-2026-000202` of BDT 47,600
    authorized and waiting for the Bank. Use it for Part 5, with
    `data/dev-lite/demo-seed/bank-signing-request-STL-2026-000202.json` and
    transfer `TRF-CLM-2026-000202`.
  - `CLM-2026-000203`: Abdullah, diagnostics, submitted.
- **Not seeded:** no appeal, duplicate or final-rejection case. Showing
  those needs the automated journeys or `stage-dev-lite-demo.ps1`, which add
  their own test records.

Before you start, `.\scripts\dev-lite-preflight.ps1` checks Docker, memory,
ports and volumes without changing anything.

The table below records the cases on the replaced ledger (history only):

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
The seeded customers sign in under **Customer sign-in**. The legacy
**Policyholder One** test sign-in is hidden; the automated journeys use it.

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
5. The Hospital can type the member ID in any case or with spaces; it is
   normalised to the issued ID before hashing. The customer's name is locked
   once the Insurer approves it. In **Customer onboarding** the Insurer can
   suspend a customer (sign-in and transactions stop at once) and later
   **Reactivate customer** with the same member ID. A second application
   with a national ID that an active customer already holds cannot be
   approved, and a policyholder must be 18 or older.
6. To take this customer through to a Bank payout, follow steps 7–15 of the
   [supervisor running order](supervisor-running-order.md). The Hospital
   intake now pre-fills the service and billing dates; keep them, because a
   stay without a billing date blocks automatic Oracle routing for that
   Hospital (F49). **Authorize settlement** has **Find payout accounts**,
   which fills the Insurer reserve and the customer's linked account. Keep
   the customer in a private browser window while you switch staff roles.

## Part 2 — Follow a claim through each role

1. Sign in as **Kazi Kamruddin Ahmed** (`kazi.ahmed@example.com`). The
   **Overview** shows the insurance card, policy `POL-2026-000101`, claim
   `CLM-2026-000201` as SETTLED and the balance of account `**** 4821`
   (BDT 185,000.00 − 2,450.00 premium + 64,000.00 payout = BDT 246,550.00).
   On the **Claims** page, paste `CLM-2026-000201` under **Medical review
   and appeal** and select **Load medical case**. The timeline shows Oracle
   approval, Insurer authorization, the approval certificate hash and
   **Payout complete**. Expand **Ledger milestones** to see the transaction
   times.
2. Sign in as **Bangladesh Demo Commercial Bank** and use **Load medical settlement** with `STL-2026-000201`. The Bank sees the amount, accounts and certificate hash, but no clinical facts or evidence.
3. Sign in as **Insurer Administrator**, load `CLM-2026-000201` and select **Export claim dossier**. Save the file as `routine-dossier.json` in the repository root.

## Part 3 — Return the cover of a finally rejected claim

No finally rejected claim is seeded. To show this part, run
`.\scripts\stage-dev-lite-demo.ps1 -SkipPremium -SkipBankPayout` the day
before. It adds its own test partner, package and claim to the ledger.
Then:

1. Start the app with `$env:SHOW_LEGACY_POLICYHOLDER_LOGIN='true'`, sign in
   as **Policyholder One** and load the newest REJECTED claim.
2. The panel shows how much cover is reserved and that no further appeal or recovery is available.
3. Select **Return reserved cover to the policy**. The panel then reports the cover as returned. A notification appears for the policyholder and for the Insurer.
4. Reload the case. The button is gone. The chaincode refuses a second release, an appeal or a recovery for this claim.

The chaincode decides this with the transaction time. Under the rules,
cover is held for 30 days after a rejection while an appeal or recovery
remains possible. The live system cannot fast-forward that time, so the
30-day path is covered by Go tests only.

## Part 3b — Bank account, premiums and automatic payment

All of this happens in the browser. It adds new synthetic records.

1. As a customer without a linked account (for example the one created in
   Part 1), open the **Payments** page (**My bank and premiums**). Choose the Bank,
   enter a nickname and the last four digits of an account, and select
   **Request account link**. The request shows as PENDING.
2. As **Bangladesh Demo Commercial Bank**, open the **Accounts** page (**Account link requests**). Set a
   verified balance (the default is 25,000.00) and select **Verify and link**. The
   customer receives a notification.
3. As the policyholder, buy a medical package on the **Policies** page
   (**Accept terms and acquire medical policy**). The start date must be
   today or up to 60 days ahead, and the term at most one year; a past start
   date is refused because cover is never backdated. The policy is
   PENDING_PAYMENT. In **My bank and premiums**, choose the linked account and
   select **Pay first premium now** (the plan's premium, for example
   BDT 2,450.00 for Hospital Care Plus). The OTP card below is
   filled in. Select **Email OTP**, then **Authorize premium**. The policy
   becomes ACTIVE and shows **cover from** today: cover starts when the
   first premium is paid, not before.
4. Select **Set up automatic EFT payment**. As the Bank, select
   **Approve mandate**. A second mandate for the same policy is refused.
5. Rakibul Islam's first premium (BDT 950.00, mandate `MND-2026-0105`)
   was due on 24 November and can be collected until 9 December. As the
   Insurer, **Premium collections and policy status** → **Schedule due EFT
   collections**; as the Bank, **Collect premium**. `POL-2026-000105` then
   becomes ACTIVE. This can be shown once.
6. To see a bounce and a retry as well, run
   `.\scripts\stage-dev-lite-demo.ps1 -SkipDeadline -SkipBankPayout` the
   day before (it adds test records). It buys two policies that start on demo day and pay their
   first premium by EFT, one from an under-funded account. Then:
   as the Insurer, **Premium collections and policy status** →
   **Schedule due EFT collections**; as the Bank, **Collect premium** on
   both. One policy becomes ACTIVE; the other bounces with insufficient
   funds and stays PENDING_PAYMENT. **Record customer deposit**; as the
   Insurer, **Retry collection**; as the Bank, **Collect premium** again,
   and the second policy becomes ACTIVE.
7. Ask the Insurer panel to lapse a policy with a future date through the
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
wsl.exe -d Ubuntu -- bash -lc "cd '/mnt/e/4-1/4100 thesis/project/Block-Insure_fabric' && bash network/scripts/read-dev-lite-certificate.sh CLM-2026-000201"
```

Copy `certificateHash` from the output into this command:

```powershell
python tools/verify-dossier/verify_dossier.py routine-dossier.json --expected-certificate-hash PASTE_HASH_HERE
```

The output shows `"anchor": "caller-supplied hash"` and exit code 0. Change one character of the hash and the verifier fails. On 24 November 2026 the peer returned `6c7021fb3d4e2f83be17c0e7c6ab1477b86b6bf357e58edc14625475ec54f38a` for this claim. Delete `routine-dossier.json` afterwards; it should not be committed.

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
   node tools/bank-signer/confirm-dev-lite.mjs data\dev-lite\demo-seed\bank-signing-request-STL-2026-000202.json C:\BankCustody\bank-officer-cert.pem C:\BankCustody\bank-officer.key C:\BankCustody\bank-peer-tls-ca.crt
   ```

   If `bankop` cannot read the repository, an administrator can grant read access with `icacls "E:\4-1\4100 thesis\project\Block-Insure_fabric" /grant "bankop:(OI)(CI)RX"`. Compare what the CLI displays with claim `CLM-2026-000202`, settlement `STL-2026-000202`, BDT 47,600.00 and transfer `TRF-CLM-2026-000202`. Then type `APPROVE STL-2026-000202`.
5. Check the payout with `read-dev-lite-certificate.sh CLM-2026-000202`. Its `status` must be `SETTLED`.
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
