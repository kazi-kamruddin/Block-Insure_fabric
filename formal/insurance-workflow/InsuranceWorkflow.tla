------------------------- MODULE InsuranceWorkflow -------------------------
EXTENDS Naturals, Sequences, FiniteSets

CONSTANTS OracleCount, OracleThreshold, MaxVersion

Statuses == {"SUBMITTED", "HOSPITAL_VERIFIED", "ORACLE_PENDING",
  "UNDER_REVIEW", "APPROVED", "REJECTED", "APPEAL_SUBMITTED",
  "SETTLEMENT_AUTHORIZED", "SETTLED"}

VARIABLES status, claimVersion, requestVersion, matchingOracleVotes,
  conflictingOracleVotes, oracleApproved, approvalVersion, approvalSource,
  finalDecision, settlementAuthorized, settled, staleResultsRejected

vars == <<status, claimVersion, requestVersion, matchingOracleVotes,
  conflictingOracleVotes, oracleApproved, approvalVersion, approvalSource,
  finalDecision, settlementAuthorized, settled, staleResultsRejected>>

Init == /\ status = "SUBMITTED"
        /\ claimVersion = 1
        /\ requestVersion = 0
        /\ matchingOracleVotes = 0
        /\ conflictingOracleVotes = 0
        /\ oracleApproved = FALSE
        /\ approvalVersion = 0
        /\ approvalSource = "NONE"
        /\ finalDecision = "NONE"
        /\ settlementAuthorized = FALSE
        /\ settled = FALSE
        /\ staleResultsRejected = 0

HospitalVerify == /\ status \in {"SUBMITTED", "APPEAL_SUBMITTED"}
                  /\ status' = "HOSPITAL_VERIFIED"
                  /\ UNCHANGED <<claimVersion, requestVersion,
                       matchingOracleVotes, conflictingOracleVotes,
                       oracleApproved, approvalVersion, approvalSource,
                       finalDecision, settlementAuthorized, settled,
                       staleResultsRejected>>

RequestOracle == /\ status = "HOSPITAL_VERIFIED"
                 /\ status' = "ORACLE_PENDING"
                 /\ requestVersion' = claimVersion
                 /\ matchingOracleVotes' = 0
                 /\ conflictingOracleVotes' = 0
                 /\ oracleApproved' = FALSE
                 /\ UNCHANGED <<claimVersion, approvalVersion,
                      approvalSource, finalDecision, settlementAuthorized,
                      settled, staleResultsRejected>>

MatchingOracleVote ==
  /\ status = "ORACLE_PENDING"
  /\ requestVersion = claimVersion
  /\ matchingOracleVotes < OracleCount
  /\ matchingOracleVotes' = matchingOracleVotes + 1
  /\ IF matchingOracleVotes' >= OracleThreshold
        THEN /\ status' = "APPROVED"
             /\ oracleApproved' = TRUE
             /\ approvalVersion' = claimVersion
             /\ approvalSource' = "ORACLE"
             /\ finalDecision' = "APPROVE"
        ELSE /\ status' = status
             /\ UNCHANGED <<oracleApproved, approvalVersion,
                  approvalSource, finalDecision>>
  /\ UNCHANGED <<claimVersion, requestVersion, conflictingOracleVotes,
       settlementAuthorized, settled, staleResultsRejected>>

ConflictingOracleVote ==
  /\ status = "ORACLE_PENDING"
  /\ requestVersion = claimVersion
  /\ matchingOracleVotes + conflictingOracleVotes < OracleCount
  /\ conflictingOracleVotes' = conflictingOracleVotes + 1
  /\ status' = IF matchingOracleVotes + conflictingOracleVotes' = OracleCount
                THEN "UNDER_REVIEW" ELSE status
  /\ UNCHANGED <<claimVersion, requestVersion, matchingOracleVotes,
       oracleApproved, approvalVersion, approvalSource, finalDecision,
       settlementAuthorized, settled, staleResultsRejected>>

OracleTimeout == /\ status = "ORACLE_PENDING"
                 /\ matchingOracleVotes < OracleThreshold
                 /\ status' = "UNDER_REVIEW"
                 /\ UNCHANGED <<claimVersion, requestVersion,
                      matchingOracleVotes, conflictingOracleVotes,
                      oracleApproved, approvalVersion, approvalSource,
                      finalDecision, settlementAuthorized, settled,
                      staleResultsRejected>>

AuditorApprove == /\ status = "UNDER_REVIEW"
                  /\ status' = "APPROVED"
                  /\ approvalVersion' = claimVersion
                  /\ approvalSource' = "AUDITOR"
                  /\ finalDecision' = "APPROVE"
                  /\ UNCHANGED <<claimVersion, requestVersion,
                       matchingOracleVotes, conflictingOracleVotes,
                       oracleApproved, settlementAuthorized, settled,
                       staleResultsRejected>>

AuditorReject == /\ status = "UNDER_REVIEW"
                 /\ status' = "REJECTED"
                 /\ finalDecision' = "REJECT"
                 /\ UNCHANGED <<claimVersion, requestVersion,
                      matchingOracleVotes, conflictingOracleVotes,
                      oracleApproved, approvalVersion, approvalSource,
                      settlementAuthorized, settled, staleResultsRejected>>

Appeal == /\ status = "REJECTED"
          /\ claimVersion < MaxVersion
          /\ status' = "APPEAL_SUBMITTED"
          /\ claimVersion' = claimVersion + 1
          \* Preserve the old request binding so late results are explicitly
          \* rejected until a fresh request replaces it.
          /\ requestVersion' = requestVersion
          /\ matchingOracleVotes' = 0
          /\ conflictingOracleVotes' = 0
          /\ oracleApproved' = FALSE
          /\ approvalVersion' = 0
          /\ approvalSource' = "NONE"
          /\ finalDecision' = "NONE"
          /\ UNCHANGED <<settlementAuthorized, settled,
               staleResultsRejected>>

RejectStaleOracleResult ==
  /\ requestVersion > 0
  /\ requestVersion # claimVersion
  /\ staleResultsRejected < 2
  /\ staleResultsRejected' = staleResultsRejected + 1
  /\ UNCHANGED <<status, claimVersion, requestVersion,
       matchingOracleVotes, conflictingOracleVotes, oracleApproved,
       approvalVersion, approvalSource, finalDecision,
       settlementAuthorized, settled>>

AuthorizeSettlement == /\ status = "APPROVED"
                       /\ approvalVersion = claimVersion
                       /\ status' = "SETTLEMENT_AUTHORIZED"
                       /\ settlementAuthorized' = TRUE
                       /\ UNCHANGED <<claimVersion, requestVersion,
                            matchingOracleVotes, conflictingOracleVotes,
                            oracleApproved, approvalVersion, approvalSource,
                            finalDecision, settled, staleResultsRejected>>

ConfirmSettlement == /\ status = "SETTLEMENT_AUTHORIZED"
                     /\ settlementAuthorized
                     /\ status' = "SETTLED"
                     /\ settled' = TRUE
                     /\ UNCHANGED <<claimVersion, requestVersion,
                          matchingOracleVotes, conflictingOracleVotes,
                          oracleApproved, approvalVersion, approvalSource,
                          finalDecision, settlementAuthorized,
                          staleResultsRejected>>

Next == HospitalVerify \/ RequestOracle \/ MatchingOracleVote \/
  ConflictingOracleVote \/ OracleTimeout \/ AuditorApprove \/ AuditorReject \/
  Appeal \/ RejectStaleOracleResult \/ AuthorizeSettlement \/ ConfirmSettlement

Spec == Init /\ [][Next]_vars

TypeInvariant == /\ status \in Statuses
                 /\ claimVersion \in 1..MaxVersion
                 /\ requestVersion \in 0..MaxVersion
                 /\ matchingOracleVotes \in 0..OracleCount
                 /\ conflictingOracleVotes \in 0..OracleCount
                 /\ approvalSource \in {"NONE", "ORACLE", "AUDITOR"}
                 /\ finalDecision \in {"NONE", "APPROVE", "REJECT"}

SettlementRequiresAuthorization == settled => settlementAuthorized
AuthorizationRequiresCurrentApproval == settlementAuthorized =>
  /\ approvalVersion = claimVersion
  /\ finalDecision = "APPROVE"
OracleApprovalRequiresQuorum == oracleApproved =>
  /\ matchingOracleVotes >= OracleThreshold
  /\ requestVersion = claimVersion
CurrentApprovalOnly == status \in {"APPROVED", "SETTLEMENT_AUTHORIZED", "SETTLED"}
  => approvalVersion = claimVersion
NoConflictingFinalDecision ==
  /\ ~(status = "REJECTED" /\ finalDecision = "APPROVE")
  /\ ~(status \in {"APPROVED", "SETTLEMENT_AUTHORIZED", "SETTLED"}
       /\ finalDecision = "REJECT")
=============================================================================
