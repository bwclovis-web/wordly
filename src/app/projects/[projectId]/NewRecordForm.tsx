"use client";

import { useActionState } from "react";
import { IssueList } from "@/components/IssueList";
import { RECORD_TYPE_LABELS, RECORD_TYPES } from "@/domain/recordTypes";
import { AUTHORITY_STATUSES } from "@/domain/statuses";
import { createRecordAction, type FormResult } from "./actions";

export function NewRecordForm({ projectId }: { projectId: string }) {
  const [state, action, pending] = useActionState<FormResult, FormData>(
    createRecordAction.bind(null, projectId),
    { ok: true },
  );

  return (
    <form action={action} className="stack">
      <div className="row">
        <label>
          Type
          <select name="type" defaultValue="character_dossier">
            {RECORD_TYPES.map((t) => (
              <option key={t} value={t}>
                {RECORD_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        </label>
        <label>
          Status
          <select name="authorityStatus" defaultValue="draft">
            {AUTHORITY_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label style={{ flex: 1 }}>
          Title
          <input type="text" name="title" required />
        </label>
      </div>
      <label>
        Body (markdown)
        <textarea name="body" />
      </label>
      <label>
        Structured fields (JSON object, optional)
        <textarea name="fields" className="mono" style={{ minHeight: "4rem" }} placeholder='{"aliases": ["..."]}' />
      </label>
      {state.message ? <div className="banner error">{state.message}</div> : null}
      <IssueList issues={state.issues ?? []} />
      <div>
        <button type="submit" disabled={pending}>
          Create record
        </button>
      </div>
    </form>
  );
}
