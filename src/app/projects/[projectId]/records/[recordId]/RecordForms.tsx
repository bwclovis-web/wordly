"use client";

import { useActionState } from "react";
import { IssueList } from "@/components/IssueList";
import { AUTHORITY_STATUSES, type AuthorityStatus } from "@/domain/statuses";
import { saveRecordAction, setStatusAction, type FormResult } from "../../actions";

function Result({ state }: { state: FormResult }) {
  return (
    <>
      {state.message ? <div className={`banner ${state.ok ? "ok" : "error"}`}>{state.message}</div> : null}
      <IssueList issues={state.issues ?? []} />
    </>
  );
}

function UnlockCheckbox({ isProtected }: { isProtected: boolean }) {
  if (!isProtected) return null;
  return (
    <label className="inline">
      <input type="checkbox" name="unlockProtected" />
      This record is protected. I am intentionally changing it.
    </label>
  );
}

export function RecordEditor(props: {
  projectId: string;
  recordId: string;
  revision: number;
  title: string;
  body: string;
  fieldsJson: string;
  authorityStatus: AuthorityStatus;
  isProtected: boolean;
}) {
  const [state, action, pending] = useActionState<FormResult, FormData>(
    saveRecordAction.bind(null, props.projectId, props.recordId),
    { ok: true },
  );

  return (
    <form action={action} className="stack">
      <input type="hidden" name="expectedRevision" value={props.revision} />
      <input type="hidden" name="authorityStatus" value={props.authorityStatus} />
      <label>
        Title
        <input type="text" name="title" defaultValue={props.title} required />
      </label>
      <label>
        Body (markdown)
        <textarea name="body" defaultValue={props.body} style={{ minHeight: "16rem" }} />
      </label>
      <label>
        Structured fields (JSON object)
        <textarea name="fields" className="mono" defaultValue={props.fieldsJson} style={{ minHeight: "6rem" }} />
      </label>
      <UnlockCheckbox isProtected={props.isProtected} />
      <Result state={state} />
      <div className="row">
        <button type="submit" disabled={pending}>
          Save as revision {props.revision + 1}
        </button>
        <span className="small muted">Editing revision {props.revision}. Newer saves elsewhere will be detected.</span>
      </div>
    </form>
  );
}

export function StatusForm(props: {
  projectId: string;
  recordId: string;
  revision: number;
  status: AuthorityStatus;
  isProtected: boolean;
}) {
  const [state, action, pending] = useActionState<FormResult, FormData>(
    setStatusAction.bind(null, props.projectId, props.recordId),
    { ok: true },
  );

  return (
    <form action={action} className="stack">
      <input type="hidden" name="expectedRevision" value={props.revision} />
      <div className="row">
        <label>
          Status
          <select name="status" defaultValue={props.status}>
            {AUTHORITY_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label style={{ flex: 1 }}>
          Superseded by (record ID, only for &quot;superseded&quot;)
          <input type="text" name="supersededBy" placeholder="rec_..." />
        </label>
      </div>
      <UnlockCheckbox isProtected={props.isProtected} />
      <Result state={state} />
      <div>
        <button type="submit" className="secondary" disabled={pending}>
          Update status
        </button>
      </div>
    </form>
  );
}
