--------------------------- MODULE MedicalCertificate ---------------------------
EXTENDS Naturals, FiniteSets

CONSTANTS MaxVersion, OracleCount, AuditorCount, CoverLimit
ASSUME MaxVersion = 2 /\ OracleCount = 3 /\ AuditorCount = 4 /\ CoverLimit = 2

Versions == 1..MaxVersion
Oracles == 1..OracleCount
Auditors == 1..AuditorCount
ResultTags == {"PositiveA", "PositiveB", "Negative"}
VoteTags == {"Approve", "Reject"}
CertificateKinds == {"Oracle", "Panel", "HeldPanel"}
PanelStages == {"MEDICAL_REVIEW_PREPARING", "UNDER_REVIEW"}
SubmittedStages == {"SUBMITTED", "APPEAL_SUBMITTED"}
TerminalStages == {"SETTLED", "REJECTED", "NO_PAYABLE_AMOUNT"}
Stages == {"DRAFT", "ORACLE_PENDING", "ORACLE_FAILED", "MEDICAL_AUDIT_PENDING",
           "MEDICAL_REVIEW_REQUIRED", "APPROVED", "SETTLEMENT_AUTHORIZED"}
          \cup SubmittedStages \cup PanelStages \cup TerminalStages

VARIABLE s

Init ==
  s = [ stage |-> "DRAFT", version |-> 1,
        reserved |-> 0, paid |-> 0, available |-> CoverLimit,
        requested |-> FALSE, reveals |-> {}, votes |-> {},
        sampledPeriod |-> FALSE, panelRequired |-> FALSE,
        modelHeld |-> FALSE, heldPanel |-> FALSE,
        recoveryUsed |-> FALSE, appealUsed |-> FALSE, rejection |-> "None", windowEnded |-> FALSE,
        certificates |-> {}, superseded |-> {}, settlement |-> "None",
        bankExecuted |-> FALSE, postPaymentAudit |-> FALSE, settlementCertificate |-> <<0, "None">> ]

Count(entries, tag) == Cardinality({entry \in entries : entry[2] = tag})

EffectiveCertificates(version) ==
  {cert \in s.certificates \ s.superseded : cert[1] = version}

Submit ==
  /\ s.stage = "DRAFT"
  /\ s' = [s EXCEPT !.stage = "SUBMITTED", !.reserved = 1, !.available = @ - 1]

RequestOracle ==
  /\ s.stage \in SubmittedStages
  /\ ~s.modelHeld
  /\ \E period \in BOOLEAN, requirePanel \in BOOLEAN :
       s' = [s EXCEPT !.stage = "ORACLE_PENDING", !.requested = TRUE, !.sampledPeriod = period,
                    !.panelRequired = @ \/ requirePanel]

Reveal ==
  /\ s.stage = "ORACLE_PENDING"
  /\ ~s.modelHeld
  \* Each abstract reveal represents a valid opening of a previously committed result.
  /\ \E oracle \in Oracles, result \in ResultTags :
       /\ \A prior \in s.reveals : prior[1] # oracle
       /\ LET revealed == s.reveals \cup {<<oracle, result>>}
              quorum == Count(revealed, result) >= 2
              outcome == CASE quorum /\ result = "Negative" -> "ORACLE_FAILED"
                           [] quorum /\ s.panelRequired -> "MEDICAL_REVIEW_REQUIRED"
                           [] quorum /\ s.sampledPeriod -> "MEDICAL_AUDIT_PENDING"
                           [] quorum -> "APPROVED"
                           [] Cardinality(revealed) = OracleCount -> "ORACLE_FAILED"
                           [] OTHER -> s.stage
          IN s' = [s EXCEPT !.reveals = IF outcome = "ORACLE_PENDING" THEN revealed ELSE {}, !.stage = outcome,
                   !.certificates = IF outcome = "APPROVED" THEN @ \cup {<<s.version, "Oracle">>} ELSE @]

OracleTimeout ==
  /\ s.stage = "ORACLE_PENDING"
  /\ \E actor \in {"Claimant", "Insurer", "AssignedAuditor"} :
       s' = [s EXCEPT !.stage = "ORACLE_FAILED", !.reveals = {}]

ResolveAudit ==
  /\ s.stage = "MEDICAL_AUDIT_PENDING"
  \* Action represents a revealed seed followed by a permissionless resolver.
  /\ \E selected \in BOOLEAN :
       IF selected \/ s.modelHeld
       THEN s' = [s EXCEPT !.stage = "MEDICAL_REVIEW_REQUIRED", !.heldPanel = s.modelHeld]
       ELSE s' = [s EXCEPT !.stage = "APPROVED", !.certificates = @ \cup {<<s.version, "Oracle">>}]

HoldModel ==
  /\ ~s.modelHeld
  /\ s.stage # "DRAFT"
  /\ s.stage \notin TerminalStages
  /\ s' = [s EXCEPT !.modelHeld = TRUE]

PreparePanel(held) ==
  s' = [s EXCEPT !.stage = "MEDICAL_REVIEW_PREPARING", !.votes = {}, !.heldPanel = held,
                 !.rejection = "None", !.windowEnded = FALSE]

InsurerPrepare ==
  /\ s.stage \in {"ORACLE_FAILED", "MEDICAL_REVIEW_REQUIRED"}
  /\ s.rejection # "Procedural"
  /\ PreparePanel(s.modelHeld /\ s.requested)

PrepareHeld ==
  /\ s.modelHeld /\ ~s.heldPanel
  /\ s.stage \in SubmittedStages \cup {"ORACLE_PENDING", "APPROVED", "SETTLEMENT_AUTHORIZED"}
  /\ (s.stage \in {"APPROVED", "SETTLEMENT_AUTHORIZED"} => <<s.version, "Oracle">> \in EffectiveCertificates(s.version))
  /\ ~s.bankExecuted
  /\ s' = [s EXCEPT !.stage = "MEDICAL_REVIEW_PREPARING", !.heldPanel = TRUE, !.reveals = {}, !.votes = {},
                   !.settlement = IF s.stage = "SETTLEMENT_AUTHORIZED" THEN "RETIRED" ELSE @,
                   !.settlementCertificate = <<0, "None">>]

ClaimantEscalate ==
  \* Each action abstracts the ledger-time deadline for its source stage.
  /\ s.stage \in SubmittedStages \cup {"ORACLE_PENDING", "ORACLE_FAILED", "MEDICAL_REVIEW_REQUIRED", "MEDICAL_AUDIT_PENDING"}
  /\ s.rejection # "Procedural"
  /\ PreparePanel(FALSE)

OpenReview ==
  /\ s.stage = "MEDICAL_REVIEW_PREPARING"
  /\ s' = [s EXCEPT !.stage = "UNDER_REVIEW"]

PanelVote ==
  /\ s.stage = "UNDER_REVIEW"
  /\ \E auditor \in Auditors, vote \in VoteTags :
       /\ \A prior \in s.votes : prior[1] # auditor
       /\ LET voted == s.votes \cup {<<auditor, vote>>}
              outcome == CASE Count(voted, "Approve") >= 3 -> "APPROVED"
                           [] Count(voted, "Reject") >= 2 -> "REJECTED"
                           [] OTHER -> s.stage
              cert == <<s.version, IF s.heldPanel THEN "HeldPanel" ELSE "Panel">>
          IN s' = [s EXCEPT !.votes = IF outcome = "UNDER_REVIEW" THEN voted ELSE {}, !.stage = outcome,
                   !.rejection = IF outcome = "REJECTED" THEN "Merits" ELSE @,
                   !.certificates = IF outcome = "APPROVED" THEN @ \cup {cert} ELSE @,
                   !.superseded = IF outcome = "APPROVED" /\ s.heldPanel
                                  THEN @ \cup ({<<s.version, "Oracle">>} \cap s.certificates) ELSE @]

ExpireReview ==
  /\ s.stage \in PanelStages
  /\ \E actor \in {"Claimant", "Insurer", "AssignedAuditor"} :
       s' = [s EXCEPT !.stage = IF s.stage = "MEDICAL_REVIEW_PREPARING" THEN "MEDICAL_REVIEW_REQUIRED" ELSE "REJECTED",
                      !.votes = {}, !.rejection = "Procedural"]

RecoverReview ==
  /\ s.rejection = "Procedural"
  /\ s.stage = "MEDICAL_REVIEW_REQUIRED" \/ (s.stage = "REJECTED" /\ ~s.windowEnded /\ ~s.recoveryUsed)
  /\ s.reserved > 0
  /\ s' = [s EXCEPT !.stage = "MEDICAL_REVIEW_PREPARING", !.votes = {},
                 !.recoveryUsed = TRUE, !.rejection = "None"]

AdvanceVersion(stage, amount, isAppeal) ==
  s' = [s EXCEPT !.stage = stage, !.version = @ + 1,
                 !.available = @ + s.reserved - amount, !.reserved = amount,
                 !.requested = FALSE, !.reveals = {}, !.votes = {},
                 !.sampledPeriod = FALSE, !.panelRequired = TRUE, !.heldPanel = FALSE,
                 !.appealUsed = @ \/ isAppeal, !.rejection = "None", !.windowEnded = FALSE,
                 !.superseded = @ \cup EffectiveCertificates(s.version),
                 !.settlement = IF @ \in {"AUTHORIZED", "PAYMENT_FAILED"} THEN "SUPERSEDED" ELSE @,
                 !.settlementCertificate = <<0, "None">> ]

CorrectClaim ==
  /\ s.version < MaxVersion /\ s.reserved > 0 /\ s.stage \notin TerminalStages
  /\ ~s.bankExecuted
  /\ \E amount \in 0..CoverLimit : AdvanceVersion(IF amount = 0 THEN "NO_PAYABLE_AMOUNT" ELSE "SUBMITTED", amount, FALSE)

AppealClaim ==
  /\ s.stage = "REJECTED" /\ s.rejection = "Merits" /\ ~s.windowEnded /\ ~s.appealUsed
  /\ s.version < MaxVersion /\ s.reserved > 0
  /\ \E amount \in 1..CoverLimit : AdvanceVersion("APPEAL_SUBMITTED", amount, TRUE)

CloseRejectionWindow ==
  /\ s.stage = "REJECTED" /\ ~s.windowEnded
  /\ s' = [s EXCEPT !.windowEnded = TRUE]

ReleaseCover ==
  /\ s.stage = "REJECTED" /\ s.reserved > 0
  /\ s.windowEnded \/ (s.rejection = "Merits" /\ s.appealUsed)
                   \/ (s.rejection = "Procedural" /\ s.recoveryUsed)
  /\ s' = [s EXCEPT !.available = @ + s.reserved, !.reserved = 0]

Authorize ==
  /\ s.stage = "APPROVED" /\ s.reserved > 0
  /\ ~s.modelHeld \/ ~s.requested \/ s.heldPanel
  /\ \E certificate \in EffectiveCertificates(s.version) :
       s' = [s EXCEPT !.stage = "SETTLEMENT_AUTHORIZED", !.settlement = "AUTHORIZED", !.settlementCertificate = certificate]

PaymentFailed ==
  /\ s.stage = "SETTLEMENT_AUTHORIZED" /\ s.settlement = "AUTHORIZED"
  /\ ~s.bankExecuted /\ (~s.modelHeld \/ s.settlementCertificate[2] # "Oracle")
  /\ s' = [s EXCEPT !.settlement = "PAYMENT_FAILED"]

ExecuteBankTransfer ==
  /\ s.stage = "SETTLEMENT_AUTHORIZED" /\ s.settlement = "AUTHORIZED" /\ ~s.bankExecuted
  /\ s.settlementCertificate \in EffectiveCertificates(s.version)
  /\ ~s.modelHeld \/ s.settlementCertificate[2] # "Oracle"
  /\ s' = [s EXCEPT !.bankExecuted = TRUE]

Confirm ==
  /\ s.stage = "SETTLEMENT_AUTHORIZED" /\ s.settlement \in {"AUTHORIZED", "PAYMENT_FAILED"}
  /\ s.settlementCertificate \in EffectiveCertificates(s.version)
  /\ ~s.modelHeld \/ s.settlementCertificate[2] # "Oracle" \/ s.bankExecuted
  /\ s' = [s EXCEPT !.stage = "SETTLED", !.settlement = "CONFIRMED", !.paid = @ + s.reserved, !.reserved = 0,
                    !.postPaymentAudit = s.modelHeld /\ s.settlementCertificate[2] = "Oracle"]

Next == Submit \/ RequestOracle \/ Reveal \/ OracleTimeout \/ ResolveAudit \/ HoldModel
        \/ InsurerPrepare \/ PrepareHeld \/ ClaimantEscalate \/ OpenReview \/ PanelVote \/ ExpireReview
        \/ RecoverReview \/ CorrectClaim \/ AppealClaim \/ CloseRejectionWindow \/ ReleaseCover
        \/ Authorize \/ PaymentFailed \/ ExecuteBankTransfer \/ Confirm

Spec == Init /\ [][Next]_s
        /\ WF_s(ClaimantEscalate) /\ WF_s(OracleTimeout)
        /\ WF_s(ResolveAudit) /\ WF_s(InsurerPrepare \/ PrepareHeld \/ Authorize)
        /\ WF_s(ExpireReview) /\ WF_s(Confirm)

TypeOK ==
  /\ s.stage \in Stages /\ s.version \in Versions
  /\ s.reserved \in 0..CoverLimit /\ s.paid \in 0..CoverLimit /\ s.available \in 0..CoverLimit
  /\ s.reveals \subseteq (Oracles \X ResultTags) /\ s.votes \subseteq (Auditors \X VoteTags)
  /\ {s.requested, s.sampledPeriod, s.panelRequired, s.modelHeld, s.heldPanel,
      s.recoveryUsed, s.appealUsed, s.windowEnded, s.bankExecuted, s.postPaymentAudit} \subseteq BOOLEAN
  /\ s.certificates \subseteq (Versions \X CertificateKinds)
  /\ s.superseded \subseteq s.certificates
  /\ s.settlement \in {"None", "AUTHORIZED", "PAYMENT_FAILED", "SUPERSEDED", "RETIRED", "CONFIRMED"}
  /\ s.rejection \in {"None", "Merits", "Procedural"}
  /\ s.settlementCertificate \in (Versions \X CertificateKinds) \cup {<<0, "None">>}

NoPayoutWithoutCertificate ==
  /\ (s.settlement = "CONFIRMED") =>
       (s.stage = "SETTLED" /\ s.settlementCertificate \in EffectiveCertificates(s.version))
  /\ (s.paid > 0) => (s.settlement = "CONFIRMED")

CoverConservation == s.reserved + s.paid + s.available = CoverLimit

HeldPaymentRequiresExecution ==
  s.postPaymentAudit => s.bankExecuted /\ s.settlement = "CONFIRMED"

OneResultPerAssignee ==
  /\ Cardinality(s.reveals) <= OracleCount
  /\ \A oracle \in Oracles : Cardinality({entry \in s.reveals : entry[1] = oracle}) <= 1

OneVotePerAuditor ==
  \A auditor \in Auditors : Cardinality({entry \in s.votes : entry[1] = auditor}) <= 1

OneEffectiveCertificatePerVersion ==
  \A version \in Versions :
    /\ Cardinality(EffectiveCertificates(version)) <= 1
    /\ Cardinality(s.certificates \cap {<<version, "Oracle">>, <<version, "Panel">>}) <= 1

SubmittedProgress ==
  (s.stage \in SubmittedStages) ~> (s.stage \in (TerminalStages \cup PanelStages))

PayableSubmissionProgress ==
  ( [] (s.stage # "NO_PAYABLE_AMOUNT") ) =>
    ((s.stage \in SubmittedStages) ~> (s.stage \in ({"SETTLED", "REJECTED"} \cup PanelStages)))

ReleaseApprovers == {"Insurer", "Auditor", "Oracle"}
ReleaseInit ==
  s = [stage |-> "REGISTERED", approved |-> {}, attesters |-> {}, delayed |-> FALSE]

ReleaseNext ==
  \/ /\ s.stage = "REGISTERED"
     /\ s' = [s EXCEPT !.stage = "SHADOW"]
  \/ /\ s.stage \in {"SHADOW", "RESUME_PENDING"}
     /\ \E oracle \in Oracles \ s.attesters :
          s' = [s EXCEPT !.attesters = @ \cup {oracle}]
  \/ /\ s.stage \in {"SHADOW", "RESUME_PENDING"}
     /\ \E org \in ReleaseApprovers \ s.approved :
          /\ org = "Oracle" => Cardinality(s.attesters) >= 2
          /\ LET approved == s.approved \cup {org} IN
               s' = [s EXCEPT !.approved = approved,
                              !.stage = IF approved = ReleaseApprovers THEN "APPROVED" ELSE @]
  \/ /\ s.stage = "APPROVED" /\ ~s.delayed
     /\ s' = [s EXCEPT !.delayed = TRUE]
  \/ /\ s.stage = "APPROVED" /\ s.delayed
     /\ s' = [s EXCEPT !.stage = "ACTIVE"]
  \/ /\ s.stage \in {"SHADOW", "APPROVED", "ACTIVE", "RESUME_PENDING"}
     /\ s' = [s EXCEPT !.stage = "HELD"]
  \/ /\ s.stage = "HELD"
     /\ s' = [s EXCEPT !.stage = "RESUME_PENDING", !.approved = {}, !.attesters = {}, !.delayed = FALSE]

ReleaseSpec == ReleaseInit /\ [][ReleaseNext]_s

ReleaseAuthority ==
  /\ (s.stage \in {"APPROVED", "ACTIVE"}) => s.approved = ReleaseApprovers
  /\ ("Oracle" \in s.approved) => Cardinality(s.attesters) >= 2
  /\ s.stage = "ACTIVE" => s.delayed
=============================================================================
