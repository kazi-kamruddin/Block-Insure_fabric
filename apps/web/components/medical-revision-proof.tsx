"use client";

import { useEffect, useState } from "react";
import { revisionMatches, type RevisionProof } from "@/lib/fabric/revision-proof";

export function MedicalRevisionProof({ proof }: { proof: RevisionProof | null | undefined }) {
  const [checked, setChecked] = useState<{ proof: RevisionProof; matches: boolean }>();
  useEffect(() => {
    if (!proof) return;
    let current = true;
    void revisionMatches(proof).then(matches => {
      if (current) setChecked({ proof, matches });
    }).catch(() => {
      if (current) setChecked({ proof, matches: false });
    });
    return () => { current = false; };
  }, [proof]);

  return <div className="medicalSubpanel">
    <p role="status">{!proof ? "Revision hash check unavailable for this evidence." :
      checked?.proof !== proof ? "Checking public revision hash." :
        checked.matches ? "Episode facts match the public revision hash." : "Episode facts do not match the public revision hash."}</p>
    {proof && <p>{proof.service} · Service {proof.serviceDate} · Admission {proof.admissionDate} · Discharge {proof.dischargeDate} · Invoice {proof.invoiceDate}</p>}
    <p>The Insurer Gateway could still omit facts.</p>
  </div>;
}
