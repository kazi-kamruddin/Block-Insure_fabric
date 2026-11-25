# Medical certificate model

`MedicalCertificate.tla` models one medical claim under one dev-lite 1.9.0
policy. The configuration bounds the claim to two versions, three assigned
Oracle subjects, four assigned auditors and two units of normalized cover.

The model distinguishes Oracle quorum, audit sampling, panel preparation and
voting, certification, and Bank confirmation. Oracle outcomes stand for
distinct full-result digests. The panel closes on three approvals or two
rejections, with one vote per assigned auditor per round. A confirmation must
carry the effective certificate for the current version. Version advancement
supersedes an unpaid authorization and changes the reservation by the
difference between the old and new payable amounts. Confirmed payment moves
reserved cover to paid cover, and a final rejection permits release.

The certificate invariant counts effective certificates. The original
certificate and a same-version held-release panel replacement can coexist
under different audit keys. `ReadMedicalApprovalCertificate` in
`medical_approval.go` gives priority to the replacement. `ConfirmSettlement`
still matches the effective certificate after authorization. Dev-lite 1.9.0
checks the model hold at authorization and does not repeat the hold check at
confirmation.

The model allows claimant escalation for a submitted claim, a submitted
appeal or a pending Oracle request after the relevant deadline. It also models
Insurer preparation after Oracle failure or a positive result requiring
review, and the current rejection and single procedural recovery for an
expired review. The future U18 edges are marked in the model.

## Fairness and scope

Timeout and escalation actions abstract elapsed deadlines. Opening voting
abstracts completion of the role and evidence checks. One reveal stands for a
valid opening of an assigned commitment. Wall-clock timing, identities,
private data, funds outside the policy and eligibility checks are outside
this model.

The liveness configuration weakly requires Oracle timeout or claimant
escalation when continuously eligible. It also assumes the audit seed
eventually becomes available to the resolver, the Insurer eventually
prepares or authorizes as eligible, and the Bank eventually confirms a
continuously payable authorization. Preparation and voting time out when
continuously eligible. These assumptions describe actor participation and
funding. Chaincode cannot guarantee either. In particular, an unrevealed
audit seed can stall dev-lite 1.9.0.

`SubmittedProgress` admits panel preparation, rejection, settlement or a
corrected quote with zero payable cover as a milestone. The stronger
`PayableSubmissionProgress` restricts traces to payable versions and requires
settlement, rejection or panel preparation. This represents the requested
progress property while retaining the current `NO_PAYABLE_AMOUNT` transition.
The model permits no more than two claim versions, so a second correction
cannot occur in this configuration.

## TLC

With the Fabric stack stopped and an approved local JRE available, run from
this directory:

```powershell
java -XX:+UseSerialGC -Xmx512m -cp ../insurance-workflow/.cache/tla2tools.jar tlc2.TLC -workers 1 -config MedicalCertificate.cfg MedicalCertificate.tla
```
