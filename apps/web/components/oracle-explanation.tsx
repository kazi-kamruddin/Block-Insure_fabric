"use client";

import { useState } from "react";
import type { verifyExplanation } from "@/lib/oracle/explanation-receipt";

type Explanation = ReturnType<typeof verifyExplanation>;

export function OracleExplanation({ requestId }: { requestId: string }) {
  const [data, setData] = useState<Explanation>();
  const [state, setState] = useState<"idle" | "loading" | "unavailable">("idle");

  async function load() {
    setState("loading");
    try {
      const response = await fetch(`/api/medical/explanation/${encodeURIComponent(requestId)}`, { cache: "no-store" });
      if (!response.ok) throw new Error();
      setData(await response.json() as Explanation);
      setState("idle");
    } catch {
      setState("unavailable");
    }
  }

  if (!data) return <div className="medicalButtonGroup">
    <button type="button" className="secondary button" disabled={state === "loading"} onClick={() => void load()}>Read Oracle explanation</button>
    {state !== "idle" && <span role="status">{state === "loading" ? "Loading explanation." : "Explanation unavailable."}</span>}
  </div>;

  return <div className="medicalSubpanel">
    <h4>Oracle explanation</h4>
    <p role="status">{data.verified ? "Verified against ledger" : "Explanation unverified"} · {data.matchingWorkers} matching workers</p>
    <p>Proves which explanation the Oracle quorum agreed on; does not prove the source data was correct.</p>
    {data.scoreUnits !== null && <p>Score {data.scoreUnits.toLocaleString()} · Review threshold {data.thresholdUnits?.toLocaleString()} score units</p>}
    {data.ood.outOfRange && <p className="evidenceWarning">Outside training range · OOD distance {data.ood.distance?.toFixed(2)} (threshold {data.ood.threshold.toFixed(2)})</p>}
    {data.topContributions.length > 0 && <ul aria-label="Top model contributions">{data.topContributions.map(({ feature, contribution }) =>
      <li key={feature}>{feature.replaceAll("_", " ")} · {contribution.toFixed(4)} raw-margin contribution</li>)}</ul>}
    {data.mandatoryHits.length > 0 && <p>Mandatory review signals · {data.mandatoryHits.map(hit => hit.toLowerCase().replaceAll("_", " ")).join(", ")}</p>}
  </div>;
}
