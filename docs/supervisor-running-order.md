# Supervisor running order (dev-lite 1.9.0)

This is the live end-to-end order for the dev-lite medical lab on
`insurance-dev-lite-190` (chaincode 1.9.0, sequence 7, LevelDB). It shows one
new customer from sign-up to a Bank-confirmed claim payout. Every amount is
synthetic BDT. Rehearse it once before the meeting.

## 1. Start the lab (about 5 minutes)

Close other heavy programs first: the laptop has 8 GB of RAM. Start Docker
Desktop and wait until it reports that it is running.

Start the existing network. This reuses the retained containers and volumes.
Never run `deploy`, `reset` or `teardown` for a demonstration.

```powershell
wsl.exe -d Ubuntu --cd "E:\4-1\4100 thesis\project\Block-Insure_fabric" --exec bash network/scripts/network.sh --dev-lite up
```

Then start the application in a second PowerShell window and leave it open:

```powershell
cd "E:\4-1\4100 thesis\project\Block-Insure_fabric"
```

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\dev-lite-app.ps1 -TwoOracles -Onboarding
```

- Without `-Email`, every sign-in and payment code appears on screen as a
  "Demo verification code". This is the safest choice for the meeting.
- With `-Email` added, codes are emailed through Brevo and never shown on
  screen. No recipient is mapped, so synthetic `.demo` addresses receive
  nothing. Use `-Email` only with a real address that you can open, and add
  it to `recipients` in `data/dev-lite/email-gateway.json` first.
- `-TwoOracles` leaves the third Oracle worker offline on purpose. Two
  matching results out of three still decide the outcome (2-of-3 quorum).

Open `http://127.0.0.1:3219/workspace` once the window prints "Dev-lite
application is available".

## 2. Use two browser windows

A customer can request only five codes per email address per hour, with a
60-second gap between codes. Do not sign the customer out and in again
between staff steps. Keep the customer in an InPrivate or Incognito window
and the staff roles (Insurer, Hospital, Bank) in a normal window. Staff
sign-in uses the demo identity cards and needs no code.

## 3. Running order

Allow about 25 minutes. The Oracle step waits about one minute. Use a new
customer for each run. The same patient's stays on one day are screened as
possible duplicates, so a second same-day INPATIENT claim for one customer
goes to review instead of paying automatically.

| # | Window and role | Action | What to say |
| --- | --- | --- | --- |
| 1 | Customer | **Create an insurance account**: email, code, then profile (name, phone, date of birth 18–100 years, address, 10/13/17-digit NID). | Passwordless email sign-up. The NID is stored off-chain, encrypted and never shown in full. |
| 2 | Staff · Insurer | Customer onboarding queue → **Approve**. | The Insurer CA issues this customer's own Fabric certificate (`role=policyholder`, `subjectId=` member ID). Its private key stays server-side. |
| 3 | Customer | Sign in. Note the member ID on the insurance card. **Request account link** (bank-demo, nickname, last digits). | The name is locked after KYC; only the Insurer can correct it. |
| 4 | Staff · Bank | **Verify and link** with a balance such as BDT 25,000. | The Bank sees accounts and amounts, never medical facts. |
| 5 | Customer | Guided transaction → **Accept terms and acquire medical policy** → Load published packages → **Block-Insure Hospital Care Plus**. Keep the default dates. Submit. | The terms digest is accepted on the ledger. Cover starts on the day the first premium is paid. |
| 6 | Customer | My bank and premiums → **Pay first premium now** → **Email OTP** → enter the code → **Authorize premium**. | BDT 1,250 moves from the customer to the Insurer premium account. The card shows ACTIVE and the paid-through date. |
| 7 | Staff · Hospital (Dhaka Central) | **Save patient intake**: an episode reference, revision 0, the member ID, INPATIENT, today's dates, BDT 85,000. Keep the default service and billing dates. | The member ID is hashed in the browser. The Hospital records facts only. |
| 8 | Staff · Insurer | Episode association queue → **Refresh episodes** → **Resolve association** → check the suggested match → **Submit verified transaction**. | Only the Insurer links a hospital episode to a customer. |
| 9 | Customer | Your medical episodes → **Refresh episodes** → pick the policy and episode → **Prepare claim and calculate reimbursement** → **Accept statement and submit claim**. | (85,000 − 5,000 deductible cap) × 80% = BDT 64,000 payable. |
| 10 | Staff · Insurer | Medical registry approvals → **Propose registry snapshot** (Hospital ID `hospital-demo`). | The registry pins the Hospital records that the Oracles may check. |
| 11 | Staff · Hospital | **Refresh registry proposals** → **Attest this snapshot**. | The Hospital co-signs its own records. |
| 12 | Staff · Insurer | Insurer action queue → **Start claim processing** → **Submit verified transaction**. Wait about one minute, then **Refresh**. | Two Oracle workers commit and reveal; the frozen XGBoost evaluator only routes. The claim becomes APPROVED. |
| 13 | Staff · Insurer | Insurer action queue → **Prepare settlement** (the payout accounts fill in automatically; otherwise use **Find payout accounts**) → **Submit verified transaction**. | The source is the Insurer claims reserve (`**** 7001`); the destination is the customer's linked account. |
| 14 | Staff · Bank | Mandates, collections, and payouts → **Execute payout** on this settlement → enter an EFT reference → **Submit bank instruction**. | Payment is final only after the Bank commits it. |
| 15 | Customer | Refresh: the claim is SETTLED and the balance has risen by BDT 64,000 (BDT 25,000 − 1,250 + 64,000 = BDT 87,750). | End-to-end, every step was a Fabric transaction from the right organization. |

Order that saves customer codes: steps 7–8 and 10–11 need no customer, so
the customer can sign in once for steps 6 and 9 together.

## 4. If something stalls

- **Too many code requests.** Wait for the time shown, or continue with the
  prepared customer that is already signed in in the other window. Never
  edit the code store by hand.
- **ORACLE_FAILED.** The Oracles found the Hospital record incomplete or
  inconsistent. The usual cause is an intake saved without a billing date.
  Have the Hospital save a correction (same episode reference, the current
  revision, with the billing date). The customer then reviews and accepts
  the corrected reimbursement. Propose and attest a new snapshot, then
  start processing again. An existing ORACLE_FAILED claim can also show
  the four-auditor fallback.
- **"Expected the existing LevelDB dev-lite Insurer CA to be stopped."**
  The previous application window was closed without Ctrl+C. Run
  `docker stop block-insure-dev-lite-ca-insurer-1` (this removes nothing)
  and start the application again.
- **The claim stays ORACLE_PENDING for more than two minutes.** Check that
  the application window is still running. Do not start processing twice.
- **A transaction is refused.** Read the message. The chaincode is the
  authority, so it is usually a real business rule (wrong role, unpaid
  period, filing deadline).

## Rehearsal record

On 21 November 2026 (late night) the whole order ran in the browser on
sequence 7 for a new synthetic customer, Nusrat Jahan (`BI-682PQAHA`). Steps:
sign-up, KYC approval with a CA certificate, account link (BDT 25,000),
policy `policy-56c8426d4276`, and the BDT 1,250 OTP premium. Then intake,
association, snapshot `registry-hospital-v46`, and claim
`medical-4076d3da-4672-4bcb-8c31-b492df5988ab`. Both Oracle workers returned
the same `XGB_AUTO` result (EXACT_CONSENSUS), and the claim was APPROVED.
Settlement from `insurer-claims-reserve` was CONFIRMED by the Bank, the claim
was SETTLED, and the customer balance was BDT 87,750.00. Four customer codes
were used.

## 5. Stop after the meeting

Close the application window (Ctrl+C). Then stop the network without
removing anything:

```powershell
docker compose -p block-insure-dev-lite stop
```

The ledger, identities and customer records are kept for the next run.
