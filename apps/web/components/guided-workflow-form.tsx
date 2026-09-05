"use client";

import { useState } from "react";
import type { FabricRole } from "@/lib/fabric/config";
import type { WorkflowCommand, WorkflowOperation } from "@/lib/workflows/commands";
import {
  applyCommandPreset,
  buildWorkflowCommand,
  createWorkflowFormValues,
  operationsByRole,
  workflowFormDefinitions,
  type WorkflowFormValues,
} from "@/lib/workflows/forms";

export type PreparedWorkflow = {
  command: Record<string, unknown>;
  revision: number;
};

async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function GuidedWorkflowForm({
  role,
  busy,
  prepared,
  onSubmit,
}: {
  role: FabricRole;
  busy: boolean;
  prepared: PreparedWorkflow | null;
  onSubmit: (command: WorkflowCommand) => Promise<void>;
}) {
  const operations = operationsByRole[role];
  const preparedOperation = typeof prepared?.command.operation === "string"
    && operations.includes(prepared.command.operation as never)
    ? prepared.command.operation as WorkflowOperation
    : null;
  const initialOperation = preparedOperation ?? operations[0];
  const [operation, setOperation] = useState<WorkflowOperation>(initialOperation);
  const [values, setValues] = useState<WorkflowFormValues>(() => {
    const initial = createWorkflowFormValues(initialOperation);
    return preparedOperation && prepared
      ? applyCommandPreset(preparedOperation, initial, prepared.command)
      : initial;
  });
  const [formError, setFormError] = useState("");
  const definition = workflowFormDefinitions[operation];

  function selectOperation(nextOperation: WorkflowOperation) {
    setOperation(nextOperation);
    setValues(createWorkflowFormValues(nextOperation));
    setFormError("");
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError("");
    try {
      await onSubmit(await buildWorkflowCommand(operation, values, sha256));
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "The workflow form is invalid.");
    }
  }

  return (
    <article className="workCard guidedCard" id="guided-workflow">
      <span className="kicker">Guided transaction</span>
      <h2>Complete your next ledger action</h2>
      <label>Action
        <select
          aria-label="Workflow action"
          value={operation}
          onChange={(event) => selectOperation(event.target.value as WorkflowOperation)}
        >
          {operations.map((candidate) => (
            <option key={candidate} value={candidate}>{workflowFormDefinitions[candidate].label}</option>
          ))}
        </select>
      </label>
      <p className="cardNote workflowDescription">{definition.description}</p>
      <form className="guidedForm" onSubmit={submit}>
        {definition.fields.map((field) => (
          <label className={field.kind === "textarea" ? "wideField" : undefined} key={field.name}>
            {field.label}
            {field.kind === "select" ? (
              <select
                name={field.name}
                value={values[field.name] ?? ""}
                onChange={(event) => setValues((current) => ({ ...current, [field.name]: event.target.value }))}
              >
                {field.options?.map((option) => <option key={option}>{option}</option>)}
              </select>
            ) : field.kind === "textarea" ? (
              <textarea
                name={field.name}
                value={values[field.name] ?? ""}
                placeholder={field.placeholder}
                onChange={(event) => setValues((current) => ({ ...current, [field.name]: event.target.value }))}
              />
            ) : (
              <input
                name={field.name}
                value={values[field.name] ?? ""}
                type={field.kind === "date" ? "date" : field.kind === "money" ? "text" : "text"}
                inputMode={field.kind === "money" ? "decimal" : undefined}
                placeholder={field.placeholder}
                onChange={(event) => setValues((current) => ({ ...current, [field.name]: event.target.value }))}
              />
            )}
            {field.help && <small>{field.help}</small>}
          </label>
        ))}
        {formError && <p className="formError" role="alert">{formError}</p>}
        <button className="primary button guidedSubmit" disabled={busy} type="submit">
          {busy ? "Submitting…" : "Submit verified transaction"}
        </button>
      </form>
    </article>
  );
}
