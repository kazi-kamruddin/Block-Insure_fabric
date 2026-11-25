------------------------- MODULE InsuranceWorkflow -------------------------
EXTENDS Naturals, FiniteSets

CONSTANTS OracleCount, OracleThreshold, MaxVersion
VARIABLE state

Oracles == 1..OracleCount
Results == {"match", "conflict"}
Statuses == {"SUBMITTED", "HOSPITAL_VERIFIED", "ORACLE_PENDING", "UNDER_REVIEW",
  "APPROVED", "REJECTED", "APPEAL_SUBMITTED", "SETTLEMENT_AUTHORIZED", "SETTLED"}

Init == state = [status |-> "SUBMITTED", claimVersion |-> 1, requestVersion |-> 0,
  revealed |-> {}, oracleOutcome |-> "NONE", approvalVersion |-> 0, approvalSource |-> "NONE",
  finalDecision |-> "NONE", settlementAuthorized |-> FALSE, settled |-> FALSE,
  staleResultsRejected |-> 0]

Subjects(revealed) == {r[1] : r \in revealed}
Matching(revealed) == Cardinality({r \in revealed : r[2] = "match"})

HospitalVerify ==
  /\ state.status \in {"SUBMITTED", "APPEAL_SUBMITTED"}
  /\ state' = [state EXCEPT !.status = "HOSPITAL_VERIFIED"]

RequestOracle ==
  /\ state.status = "HOSPITAL_VERIFIED"
  /\ state' = [state EXCEPT !.status = "ORACLE_PENDING", !.requestVersion = state.claimVersion,
       !.revealed = {}, !.oracleOutcome = "NONE"]

Reveal(subject, outcome) ==
  /\ state.status = "ORACLE_PENDING"
  /\ state.requestVersion = state.claimVersion
  /\ subject \notin Subjects(state.revealed)
  /\ LET revealed == state.revealed \cup {<<subject, outcome>>}
     IN state' =
       IF Matching(revealed) >= OracleThreshold
         THEN [state EXCEPT !.status = "APPROVED", !.revealed = revealed,
           !.approvalVersion = state.claimVersion, !.approvalSource = "ORACLE", !.finalDecision = "APPROVE",
           !.oracleOutcome = "CONSENSUS"]
       ELSE IF Cardinality(revealed) = OracleCount
         THEN [state EXCEPT !.status = "UNDER_REVIEW", !.revealed = revealed, !.oracleOutcome = "CONFLICT"]
       ELSE [state EXCEPT !.revealed = revealed]

OracleTimeout ==
  /\ state.status = "ORACLE_PENDING"
  /\ state' = [state EXCEPT !.status = "UNDER_REVIEW", !.oracleOutcome = "TIMEOUT"]

AuditorApprove ==
  /\ state.status = "UNDER_REVIEW"
  /\ state' = [state EXCEPT !.status = "APPROVED", !.approvalVersion = state.claimVersion,
       !.approvalSource = "AUDITOR", !.finalDecision = "APPROVE"]

AuditorReject ==
  /\ state.status = "UNDER_REVIEW"
  /\ state' = [state EXCEPT !.status = "REJECTED", !.finalDecision = "REJECT"]

Appeal ==
  /\ state.status = "REJECTED"
  /\ state.claimVersion < MaxVersion
  /\ state' = [state EXCEPT !.status = "APPEAL_SUBMITTED", !.claimVersion = @ + 1, !.revealed = {},
       !.approvalVersion = 0, !.approvalSource = "NONE", !.finalDecision = "NONE", !.oracleOutcome = "NONE"]

RejectStaleOracleResult ==
  /\ state.requestVersion > 0
  /\ state.requestVersion # state.claimVersion
  /\ state.staleResultsRejected < 2
  /\ state' = [state EXCEPT !.staleResultsRejected = @ + 1]

AuthorizeSettlement ==
  /\ state.status = "APPROVED"
  /\ state.approvalVersion = state.claimVersion
  /\ state' = [state EXCEPT !.status = "SETTLEMENT_AUTHORIZED", !.settlementAuthorized = TRUE]

ConfirmSettlement ==
  /\ state.status = "SETTLEMENT_AUTHORIZED"
  /\ state.settlementAuthorized
  /\ state' = [state EXCEPT !.status = "SETTLED", !.settled = TRUE]

Next == HospitalVerify \/ RequestOracle \/ OracleTimeout \/ AuditorApprove \/ AuditorReject \/
  Appeal \/ RejectStaleOracleResult \/ AuthorizeSettlement \/ ConfirmSettlement \/
  (\E subject \in Oracles, outcome \in Results : Reveal(subject, outcome))

Spec == Init /\ [][Next]_state

TypeInvariant ==
  /\ state.status \in Statuses
  /\ state.claimVersion \in 1..MaxVersion
  /\ state.requestVersion \in 0..MaxVersion
  /\ state.revealed \subseteq Oracles \X Results
  /\ state.oracleOutcome \in {"NONE", "CONSENSUS", "CONFLICT", "TIMEOUT"}
  /\ state.approvalSource \in {"NONE", "ORACLE", "AUDITOR"}
  /\ state.finalDecision \in {"NONE", "APPROVE", "REJECT"}

AtMostOneRevealPerAssignee ==
  /\ Cardinality(state.revealed) <= OracleCount
  /\ Cardinality(Subjects(state.revealed)) = Cardinality(state.revealed)

ExhaustedRequestIsClosed ==
  state.status = "ORACLE_PENDING" => Cardinality(state.revealed) < OracleCount

SettlementRequiresAuthorization == state.settled => state.settlementAuthorized
AuthorizationRequiresCurrentApproval == state.settlementAuthorized =>
  /\ state.approvalVersion = state.claimVersion
  /\ state.finalDecision = "APPROVE"
OracleApprovalRequiresQuorum == state.approvalSource = "ORACLE" =>
  /\ Matching(state.revealed) >= OracleThreshold
  /\ state.requestVersion = state.claimVersion
CurrentApprovalOnly == state.status \in {"APPROVED", "SETTLEMENT_AUTHORIZED", "SETTLED"}
  => state.approvalVersion = state.claimVersion
NoConflictingFinalDecision ==
  /\ ~(state.status = "REJECTED" /\ state.finalDecision = "APPROVE")
  /\ ~(state.status \in {"APPROVED", "SETTLEMENT_AUTHORIZED", "SETTLED"}
       /\ state.finalDecision = "REJECT")
=============================================================================
