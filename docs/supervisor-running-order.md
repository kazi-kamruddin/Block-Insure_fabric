# Supervisor running order (dev-lite 1.9.0)

## Current order — R2 on sequence 4 (from 26 November 2026)

Use this section for the meeting. The older order further down reflects the 24 November baseline: an INPATIENT claim approved automatically through the v1 registry path. On the current ledger, Oracle v2 handles DIAGNOSTIC claims with signed sources, so that order no longer applies as written.

**Before the meeting.** Close heavy programs, especially browsers with many tabs, and keep at least 2 GB free on drive C. Docker Desktop must be running. From the Fabric checkout:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\r2-demo.ps1 Start
```

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\r2-demo.ps1 Status
```

Wait for `Status : HEALTHY`, `ExpectedSequence : 4`, `TimingProfile : DEMO`, three workers, `AdapterListeners : 6/6` and `BusinessMemoryReady : True`. Writes are refused below 700 MB available, so if the flag is `False`, close something and check again. To enrol a new customer, stop and start with `-Onboarding`. That also starts the Insurer CA, which uses more memory. Open `http://127.0.0.1:3219/workspace`: the customer in a private window, staff in a normal window.

**Twenty-five minute order.**

| # | Segment | Who and where | What it shows |
| --- | --- | --- | --- |
| 1 | Network and identity | Show `Status`, then the Insurer **Overview** | Five organisations, one orderer, sequence 4 on every peer; the Gateway holds the Fabric keys, the browser never does |
| 2 | Policy and premium | Customer **Policies** and **Payments** (an existing ACTIVE diagnostic policy, or a new customer) | Terms digest on the ledger; EFT mandate or OTP premium; cover follows paid periods |
| 3 | Hospital facts | Chattogram Hospital **Patient billing → Save patient intake** (DIAGNOSTIC); Insurer **Customers → Resolve association** | The Hospital records facts only; only the Insurer links an episode to a customer |
| 4 | Claim | Customer **Claims → Prepare claim and calculate reimbursement → Accept statement and submit claim**; optional receipt under **Documents** and **Confirm receipt details** | The payable amount comes from the issued terms; private facts go to the collection, not the public ledger |
| 5 | Three Oracles | Insurer **Claims → Start claim processing → Submit verified transaction**, then refresh | The publisher signs S-A and S-C feeds; three workers commit then reveal; two exact matches decide. In DEMO the windows are 15 s then 30 s |
| 6 | Automatic payout | Insurer **Prepare settlement**; Bank **Payouts → Execute payout** | The approval certificate binds claim version, amount and evidence; the Bank pays simulated BDT and the claim reads SETTLED |
| 7 | Panel path | Show a referred claim (badge **Oracle did not auto-approve**, Oracle card **Panel review**), for example claim 205 or a receipt mismatch per cookbook recipe 2 | Four sealed ballots: three approvals approve, two rejections reject; no auditor sees a vote before sealing their own |
| 8 | Appeal | Claim 207's record | Rejection, corrected receipt, new claim version, mixed panel, payout |
| 9 | Fault tolerance | `r2-demo.ps1 StopWorker -Worker 3`, run a claim, then `RestartWorker -Worker 3` | Two of three Oracles still finalise; with fewer, the request times out and the claimant can escalate |
| 10 | Integrity | Export a claim dossier and verify it against a separate peer readback | Evidence integrity and agreement, not clinical truth |

The detailed clicks, eligible customers and timings for each segment are in the [scenario cookbook](scenario-cookbook.md); the evidence to point at is in the [defence walkthrough](defence-walkthrough.md).

**If something stalls.** `ORACLE_FAILED` means the Oracles did not auto-approve. Read the Oracle card, then prepare the panel. A claim stuck in `ORACLE_PENDING` past the DEMO windows usually means a worker or adapter stopped; check `Status`. A refused write is usually a real business rule. Read the message instead of retrying.

**After the meeting.**

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\r2-demo.ps1 Stop
```

This keeps every volume, identity and record.

## 24 November 2026 baseline order (historical)

This is the live end-to-end order for the dev-lite medical lab on
`insurance-dev-lite-190` (chaincode 1.9.0, LevelDB) as it stood before R1. It shows one
new customer from sign-up to a Bank-confirmed claim payout. Every amount is
synthetic BDT.

The ledger was rebuilt on 24 November 2026: the sequence-7 package
(`d6da2d77…`) is committed at sequence 1 on a fresh ledger. It holds a small
seeded set (`scripts/seed-dev-lite-demo.ps1`), so the lists are not empty:

- Four partner agreements: Dhaka Central Medical Hospital, Chattogram
  Metropolitan Hospital, Rajshahi Community Hospital and Bangladesh Demo
  Commercial Bank.
- Five published plans, one service each: Shastho Shurokkha Hospital Cover
  (BDT 950), Hospital Care Plus (BDT 2,450), Surgical Shield (BDT 1,500),
  Diagnostics Care (BDT 650) and Doctor Visit Care (BDT 450) per 30 days.
- Five customers, each with a verified account and an active policy:
  Kazi Kamruddin Ahmed, Sumit Majumder, Abdullah Ishtiaq, Sadik Rahman and
  Rakibul Islam. Rakibul pays by EFT mandate; his first premium is still due.
  They sign in with `firstname.lastname@example.com` (Kazi:
  `kazi.ahmed@example.com`); the codes appear on screen.
- Three claims: `CLM-2026-000201` (Kazi, BDT 64,000 paid),
  `CLM-2026-000202` (Sumit, BDT 47,600 authorized, waiting for the Bank) and
  `CLM-2026-000203` (Abdullah, diagnostics, submitted).

Do not run the automated journeys (`test-dev-lite-*.ps1`,
`stage-dev-lite-demo.ps1`) on this ledger before the meeting: they add their
own test partners, packages and customers.

### 1. Start the lab (about 5 minutes)

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
powershell -ExecutionPolicy Bypass -File .\scripts\dev-lite-app.ps1 -Onboarding
```

- Without `-Email`, every sign-in and payment code appears on screen as a
  "Demo verification code". This is the safest choice for the meeting.
- With `-Email` added, codes are emailed through Brevo and never shown on
  screen. No recipient is mapped, so synthetic `.demo` addresses receive
  nothing. Use `-Email` only with a real address that you can open, and add
  it to `recipients` in `data/dev-lite/email-gateway.json` first.
- The normal run starts all three Oracle workers. In the fault-tolerance
  segment, restart the app with `-TwoOracles`. The two available workers
  wait about 60 seconds for the commit deadline before revealing.

Open `http://127.0.0.1:3219/workspace` once the window prints "Dev-lite
application is available".

### 2. Use two browser windows

A customer can request only five codes per email address per hour, with a
60-second gap between codes. Do not sign the customer out and in again
between staff steps. Keep the customer in an InPrivate or Incognito window
and the staff roles (Insurer, Hospital, Bank) in a normal window. Staff
sign-in uses the demo identity cards and needs no code.

### 3. Running order

Allow about 25 minutes. Use a new
customer for each run. The same patient's stays on one day are screened as
possible duplicates, so a second same-day INPATIENT claim for one customer
goes to review instead of paying automatically.

Each workspace has a sidebar of pages. The **page** named first in each action is the sidebar entry to open.

| # | Window and role | Action | What to say |
| --- | --- | --- | --- |
| 1 | Customer | **Create an insurance account**: email, code, then profile (name, phone, date of birth 18–100 years, address, 10/13/17-digit NID). | Passwordless email sign-up. The NID is stored off-chain, encrypted and never shown in full. |
| 2 | Staff · Insurer | **Customers** page → Customer onboarding → **Approve**. | The Insurer CA issues this customer's own Fabric certificate (`role=policyholder`, `subjectId=` member ID). Its private key stays server-side. |
| 3 | Customer | Sign in. Note the member ID on the insurance card (**Overview**). **Payments** page → **Request account link** (bank-demo, nickname, last digits). | The name is locked after KYC; only the Insurer can correct it. |
| 4 | Staff · Bank | **Accounts** page → **Verify and link** with a balance such as BDT 25,000. | The Bank sees accounts and amounts, never medical facts. |
| 5 | Customer | **Policies** page → **Accept terms and acquire medical policy** → Load published packages → **Hospital Care Plus**. Keep the default dates. Submit. | The terms digest is accepted on the ledger. Cover starts on the day the first premium is paid. |
| 6 | Customer | **Payments** page → **Pay first premium now** → **Email OTP** → enter the code → **Authorize premium**. | BDT 2,450 moves from the customer to the Insurer premium account. The card shows ACTIVE and the paid-through date. |
| 7 | Staff · Hospital (Dhaka Central) | **Patient billing** page → **Save patient intake**: an episode reference, revision 0, the member ID, INPATIENT, today's dates, BDT 85,000. Keep the default service and billing dates. | The member ID is hashed in the browser. The Hospital records facts only. |
| 8 | Staff · Insurer | **Customers** page → Episode association queue → **Refresh episodes** → **Resolve association** → check the suggested match → **Submit verified transaction**. | Only the Insurer links a hospital episode to a customer. |
| 9 | Customer | **Claims** page → Your medical episodes → **Refresh episodes** → pick the policy and episode → **Prepare claim and calculate reimbursement** → **Accept statement and submit claim**. | (85,000 − 5,000 deductible cap) × 80% = BDT 64,000 payable. |
| 10 | Staff · Insurer | **Partners** page → Medical registry approvals → **Propose registry snapshot** (Hospital ID `hospital-demo`). | The registry pins the Hospital records that the Oracles may check. |
| 11 | Staff · Hospital | **Registry** page → **Refresh registry proposals** → **Check proposed records** → **Attest this snapshot** once the root matches. | The Hospital checks its scoped records and attests the recomputed root. |
| 12 | Staff · Insurer | **Overview** → Insurer action queue → **Start claim processing** (opens the **Claims** page with the form filled) → **Submit verified transaction**. Refresh after Oracle finalization. | Two matching reveals from the three-worker roster reach quorum. The frozen XGBoost evaluator routes the claim to approval or review. |
| 13 | Staff · Insurer | **Overview** → Insurer action queue → **Prepare settlement** (opens **Claims**) (the payout accounts fill in automatically; otherwise use **Find payout accounts**) → **Submit verified transaction**. | The source is the Insurer claims reserve (`**** 7002`); the destination is the customer's linked account. |
| 14 | Staff · Bank | **Payouts** page → **Execute payout** on this settlement → enter an EFT reference → **Submit bank instruction**. | Payment is final only after the Bank commits it. |
| 15 | Customer | Refresh: the claim is SETTLED and the balance has risen by BDT 64,000 (BDT 25,000 − 2,450 + 64,000 = BDT 86,550). | End-to-end, every step was a Fabric transaction from the right organization. |

Order that saves customer codes: steps 7–8 and 10–11 need no customer, so
the customer can sign in once for steps 6 and 9 together.

The seed opened premium collection account `**** 7001` at BDT 0 and claims
reserve account `**** 7002` at BDT 25,00,000. The preflight ledger check reports
the current balances after recorded premiums and payouts.

### 4. If something stalls

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

### Rehearsal record

On 21 November 2026 (late night) the whole order ran in the browser on
sequence 7 for a new synthetic customer, Nusrat Jahan (`BI-682PQAHA`). Steps:
sign-up, KYC approval with a CA certificate, account link (BDT 25,000),
policy `policy-56c8426d4276`, and the BDT 1,250 OTP premium. Then intake,
association, snapshot `registry-hospital-v46`, and claim
`medical-4076d3da-4672-4bcb-8c31-b492df5988ab`. Both Oracle workers returned
the same `XGB_AUTO` result (EXACT_CONSENSUS), and the claim was APPROVED.
Settlement from `insurer-claims-reserve` was CONFIRMED by the Bank, the claim
was SETTLED, and the customer balance was BDT 87,750.00. Four customer codes
were used. That ledger was replaced on 24 November 2026; its records are
no longer on the network.

### 5. Stop after the meeting

Close the application window (Ctrl+C). Then stop the network without
removing anything:

```powershell
docker compose -p block-insure-dev-lite stop
```

The ledger, identities and customer records are kept for the next run.
