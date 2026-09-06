# Policy, premium, benefit, and banking lifecycles

Issue `#8` extends the original claim-focused vertical slice into governed
coverage acquisition and external-fiat reconciliation. Hyperledger Fabric is
the shared authority for obligations, approvals, state transitions, immutable
receipts, and safe references. It does not transfer BDT, store bank-account
numbers, deliver production OTPs, or replace a bank core.

## Policy lifecycle

```text
AcquirePolicy -> PENDING_PAYMENT
  -> first confirmed premium -> ACTIVE
  -> overdue -> GRACE -> LAPSED
  -> confirmed premium -> ACTIVE (reinstated)
  -> coverage end -> EXPIRED -> RenewPolicy -> PENDING_PAYMENT
  -> owner/insurer cancellation -> CANCELLED
```

An acquired or renewed policy snapshots the published package version, premium,
coverage limit, and terms hash. It records a 30-day payment interval, 15-day
grace period, paid-through date, and next due date. The insurer invokes
`AdvancePolicyLifecycle` with an explicit business date; deterministic chaincode
then accepts only a transition that is actually due. Claims for expired policies
remain possible when the incident date is inside the historical coverage period.

The policy statement route, `GET /api/policies/[id]/statement`, reconciles the
policy with its premiums, reversals, mandates, collection jobs, claims, benefits,
and liabilities. Policyholder sessions may export only an owned policy.

## Bank references, mandates, and premiums

BankMSP registers an irreversible SHA-256 token representing an account held in
an external bank vault. The shared ledger never receives an account or routing
number. A policyholder can request a mandate only for an owned policy and an
owned verified token. BankMSP approves or rejects it; the owner can cancel it,
and BankMSP can expire it after its expiry date.

Premium receipts contain integer poisha, their covered date range, collection
method, and a hash of the external receipt. An external-reference composite key
prevents replay under another payment ID. Repeating the same payment ID and
receipt is idempotent; changing its details is rejected. Append-only
`PremiumAdjustment` assets model reversals and cannot cumulatively exceed the
original receipt. They never erase history or silently roll coverage backward.

## Manual OTP boundary

The policyholder workspace provides a manual-premium card:

1. `POST /api/banking/otp` verifies policy and active-mandate ownership.
2. The server creates a cryptographically random six-digit challenge bound to
   the session subject, policy, and mandate.
3. The challenge expires after five minutes, locks after five failures, and is
   consumed exactly once.
4. `POST /api/banking/premium-payment` consumes the challenge and submits the
   bank-confirmed receipt with the fixed BankMSP service identity.

`ENABLE_DEMO_AUTH=true` returns the code to the local UI so the thesis workflow
is demonstrable. A deployment must replace that response with a bank/SMS
delivery adapter and use a separate long random `OTP_SECRET`. Neither OTP values
nor external receipt plaintext is written to Fabric.

## Durable scheduled collection

`QueuePremiumCollection` creates an on-ledger `DUE` work item for the mandate's
exact next due date. Bank processing either completes it and atomically creates
an `AUTODEBIT` receipt, or records a hashed failure. Failed work becomes `RETRY`
for two attempts and `FAILED` on the third, preserving every attempt count.

The integration boundary is `POST /api/internal/banking/collections`, protected
by `BANKING_WORKER_SECRET`. Its commands are:

- `listDue` with an `asOfDate` to obtain `DUE`/`RETRY` ledger work;
- `complete` with an external receipt hash; or
- `fail` with a private failure-reference hash.

The durable queue is Fabric state, so an application restart cannot lose the
collection obligation. A production scheduler/bank adapter calls this API and
keeps its own delivery/checkpoint telemetry.

## Benefits and liabilities

An insurer creates and publishes one current versioned benefit plan per package.
Publishing a replacement requires retiring the current plan. Policies snapshot
the plan ID, version, amounts, and rules hash, so later revisions cannot change
accepted coverage. The plan defines death, surrender, and maturity values.
The policyholder records one to ten beneficiary allocations; unique shares must
total exactly 10,000 basis points. Each benefit request snapshots those
allocations and the configured amount.

```text
SUBMITTED -> REJECTED
          -> FUNDING_REQUIRED -> PAYMENT_READY -> PAID
```

Approval creates an explicit benefit liability. The insurer must anchor an
external funding authorization before BankMSP can confirm a payout. Settlement
authorization likewise creates a claim liability, and bank confirmation closes
both settlement and liability. Allocation records and transfer hashes provide
audit evidence; actual BDT allocation and movement remain in the external bank.

## Verification

The Go suite covers authorization, invalid allocation totals, payment replay,
reversal limits, policy grace/lapse/reinstatement, mandate/collection state, and
benefit/liability closure. The CLI smoke workflow and Playwright regression both
execute the multi-organization lifecycle against the live channel. Run all gates
with `./scripts/verify-all.ps1` from Windows PowerShell.
