------------------------------- MODULE OracleV2 -------------------------------
EXTENDS Naturals, FiniteSets

CONSTANTS OracleCount, Quorum
ASSUME OracleCount = 3 /\ Quorum = 2

Oracles == 1..OracleCount
DeadlineActors == {"Claimant", "Insurer", "AssignedAuditor"}
AllVectors == {"ClearA", "ClearB", "Contradicted", "Insufficient", "Unverifiable",
             "InvalidSignature", "InactiveLicence", "UnaccreditedService",
             "AboveTariff", "ReceiptMismatch", "ModelReview"}
Vectors == {"ClearA", "ClearB", "Contradicted", "InvalidSignature"}

\* ClearA and ClearB have distinct evidence references. Their decisions alone
\* agree, so the exact vector must be counted as part of the quorum object.
NonPass == {"Contradicted", "Insufficient", "Unverifiable", "InvalidSignature",
            "InactiveLicence", "UnaccreditedService"}
IntegrityFailure == {"InvalidSignature", "InactiveLicence", "UnaccreditedService"}
PolicyReview == {"AboveTariff", "ReceiptMismatch", "ModelReview"}
Decision(vector) ==
  CASE vector \in IntegrityFailure -> "INTEGRITY_FAIL"
    [] vector \in NonPass \cup PolicyReview -> "PANEL_REVIEW"
    [] OTHER -> "AUTO_APPROVE"

\* Equality of symbolic commitments assumes collision resistance and a pinned
\* request. Opening a commitment also checks its bound subject.
Digests == Oracles \X Vectors
CommitmentEntries == Oracles \X Digests
RevealEntries == Oracles \X Vectors
DecisionOutcomes == {"AUTO_APPROVE", "PANEL_REVIEW", "INTEGRITY_FAIL"}

VARIABLE s

Init ==
  s = [stage |-> "COMMIT", commits |-> {}, reveals |-> {}, revoked |-> {},
       outcome |-> "PENDING", selected |-> "None"]

Subjects(rows) == {row[1] : row \in rows}
CommittedHashes == {row[2] : row \in s.commits}
Count(rows, vector) == Cardinality({row \in rows : row[2] = vector})

Commit(oracle, digest) ==
  /\ s.stage = "COMMIT"
  /\ oracle \notin s.revoked
  /\ oracle \notin Subjects(s.commits)
  /\ digest \notin CommittedHashes
  /\ s' = [s EXCEPT !.commits = @ \cup {<<oracle, digest>>}]

OpenReveal ==
  /\ s.stage = "COMMIT"
  /\ Cardinality(s.commits) = OracleCount
  /\ s' = [s EXCEPT !.stage = "REVEAL"]

\* An elapsed commit deadline enables the same transition with a partial roster.
CommitDeadline ==
  /\ s.stage = "COMMIT"
  /\ s' = [s EXCEPT !.stage = "REVEAL"]

Reveal(oracle, vector) ==
  /\ s.stage = "REVEAL"
  /\ oracle \notin s.revoked
  /\ oracle \notin Subjects(s.reveals)
  /\ <<oracle, <<oracle, vector>>>> \in s.commits
  /\ LET rows == s.reveals \cup {<<oracle, vector>>}
         quorum == Count({row \in rows : row[1] \notin s.revoked}, vector) >= Quorum
     IN IF quorum
        THEN s' = [s EXCEPT !.stage = "FINAL", !.reveals = rows,
                          !.outcome = Decision(vector), !.selected = vector]
        ELSE IF Cardinality(rows) = OracleCount
        THEN s' = [s EXCEPT !.stage = "FINAL", !.reveals = rows,
                          !.outcome = "CONFLICT"]
        ELSE s' = [s EXCEPT !.reveals = rows]

Revoke ==
  /\ s.stage # "FINAL"
  /\ \E oracle \in Oracles \ s.revoked :
       s' = [s EXCEPT !.revoked = @ \cup {oracle}]

TimeoutAs(actor) ==
  /\ s.stage = "REVEAL"
  /\ actor \in DeadlineActors
  /\ s' = [s EXCEPT !.stage = "FINAL", !.outcome = "TIMEOUT"]

RevealDeadline == \E actor \in DeadlineActors : TimeoutAs(actor)

Next ==
  \/ (\E oracle \in Oracles, digest \in Digests : Commit(oracle, digest))
  \/ OpenReveal
  \/ CommitDeadline
  \/ (\E oracle \in Oracles, vector \in Vectors : Reveal(oracle, vector))
  \/ Revoke
  \/ RevealDeadline

Spec == Init /\ [][Next]_s /\ WF_s(CommitDeadline) /\ WF_s(RevealDeadline)

TypeOK ==
  /\ s.stage \in {"COMMIT", "REVEAL", "FINAL"}
  /\ s.commits \subseteq CommitmentEntries
  /\ s.reveals \subseteq RevealEntries
  /\ s.revoked \subseteq Oracles
  /\ s.outcome \in DecisionOutcomes \cup {"PENDING", "CONFLICT", "TIMEOUT"}
  /\ s.selected \in Vectors \cup {"None"}

AtMostOneResultPerAssignee ==
  /\ Subjects(s.reveals) \subseteq Oracles
  /\ Cardinality(s.reveals) = Cardinality(Subjects(s.reveals))

CommitmentsUnique ==
  /\ Cardinality(s.commits) = Cardinality(Subjects(s.commits))
  /\ Cardinality(s.commits) = Cardinality(CommittedHashes)

CopiedCommitmentCannotContribute ==
  /\ \A row \in s.reveals : <<row[1], <<row[1], row[2]>>>> \in s.commits
  /\ \A row \in s.commits :
       row[1] # row[2][1] => row[1] \notin Subjects(s.reveals)

DecisionBackedByExactQuorum ==
  s.outcome \in DecisionOutcomes =>
    /\ s.stage = "FINAL"
    /\ s.selected \in Vectors
    /\ s.outcome = Decision(s.selected)
    /\ Count({row \in s.reveals : row[1] \notin s.revoked}, s.selected) >= Quorum

NoAutoApprovalWithNonPassFact ==
  /\ s.outcome = "AUTO_APPROVE" => s.selected \notin NonPass \cup PolicyReview
  /\ \A vector \in AllVectors : (Decision(vector) = "INTEGRITY_FAIL") <=> (vector \in IntegrityFailure)

DecisionOrPanel ==
  <> (s.stage = "FINAL" /\ s.outcome \in DecisionOutcomes \cup {"CONFLICT", "TIMEOUT"})
=============================================================================
