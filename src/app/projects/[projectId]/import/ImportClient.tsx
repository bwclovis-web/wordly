"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { ContentClassBadge, ProtectionBadge, StatusBadge } from "@/components/Badges";
import { FieldDiffTable, TextDiff } from "@/components/DiffView";
import { IssueList } from "@/components/IssueList";
import { RECORD_TYPE_LABELS } from "@/domain/recordTypes";
import type {
  ApplyOutcome,
  OperationPreview,
  PackageApplyResult,
  PackagePreview,
} from "@/server/services/changePackageService";
import { applyPackageAction, previewPackageAction } from "../actions";

const OP_LABELS: Record<OperationPreview["op"], string> = {
  create_record: "Create",
  update_record: "Update",
  set_authority_status: "Set status",
};

function OperationCard({ op, projectId }: { op: OperationPreview; projectId: string }) {
  const blocked = op.issues.some((i) => i.severity === "error");
  return (
    <div className="panel" style={blocked ? { borderColor: "var(--danger)" } : undefined}>
      <div className="row">
        <strong>
          #{op.index} {OP_LABELS[op.op]}
        </strong>
        <span className="muted small">{RECORD_TYPE_LABELS[op.type]}</span>
        {op.idAssignedOnApply ? (
          <span className="small muted">(ID assigned on apply)</span>
        ) : op.op === "create_record" ? (
          <code className="small">{op.recordId}</code>
        ) : (
          <Link href={`/projects/${projectId}/records/${op.recordId}`} target="_blank">
            <code className="small">{op.recordId}</code>
          </Link>
        )}
        <ContentClassBadge contentClass={op.contentClass} />
        <ProtectionBadge isProtected={op.protected} />
        {op.usesProtectedOverride ? <span className="badge protected">protected override</span> : null}
        {op.expectedRevision !== null ? (
          <span className="small">
            expects rev {op.expectedRevision}, current rev {op.currentRevision}
          </span>
        ) : null}
      </div>
      {op.note ? <p className="small muted">Note: {op.note}</p> : null}
      <div className="stack" style={{ marginTop: "0.5rem" }}>
        {op.titleBefore !== op.titleAfter ? (
          <div>
            Title: {op.titleBefore ? <del>{op.titleBefore}</del> : null} {op.titleBefore ? <>&rarr; </> : null}
            <ins>{op.titleAfter}</ins>
          </div>
        ) : (
          <div>
            Title: <strong>{op.titleAfter}</strong>
          </div>
        )}
        {op.statusBefore !== op.statusAfter || op.supersededByBefore !== op.supersededByAfter ? (
          <div className="row">
            Status: {op.statusBefore ? <StatusBadge status={op.statusBefore} /> : null}
            {op.statusBefore ? <>&rarr;</> : null} <StatusBadge status={op.statusAfter} />
            {op.supersededByAfter ? <span className="small">superseded by {op.supersededByAfter}</span> : null}
          </div>
        ) : null}
        {op.bodyChanged ? <TextDiff parts={op.bodyDiff} /> : <span className="small muted">Body unchanged.</span>}
        <FieldDiffTable diffs={op.fieldDiffs} />
        <IssueList issues={op.issues} />
      </div>
    </div>
  );
}

function ResultSummary({ result, projectId }: { result: PackageApplyResult; projectId: string }) {
  return (
    <div className="panel">
      <h3>
        Change summary for <code>{result.packageId}</code>
      </h3>
      <p className="small muted">
        {result.summary} &middot; applied {new Date(result.appliedAt).toLocaleString()}
      </p>
      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>Operation</th>
            <th>Record</th>
            <th>Revision</th>
          </tr>
        </thead>
        <tbody>
          {result.changes.map((c) => (
            <tr key={c.index}>
              <td>{c.index}</td>
              <td>{OP_LABELS[c.op]}</td>
              <td>
                <Link href={`/projects/${projectId}/records/${c.recordId}`}>{c.title}</Link>{" "}
                <code className="small">{c.recordId}</code>
              </td>
              <td>
                {c.previousRevision === null ? "new" : c.previousRevision} &rarr; {c.newRevision}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {result.reviewItems.length > 0 ? (
        <>
          <h3 style={{ marginTop: "1rem" }}>Flagged for review (not changed)</h3>
          <ul className="small">
            {result.reviewItems.map((r) => (
              <li key={r.id}>
                <Link href={`/projects/${projectId}/records/${r.recordId}`}>{r.title}</Link>{" "}
                <span className="muted">[{r.origin === "package_note" ? "package note" : "detected mention"}]</span> {r.note}
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}

export function ImportClient({ projectId }: { projectId: string }) {
  const [raw, setRaw] = useState("");
  const [preview, setPreview] = useState<PackagePreview | null>(null);
  const [outcome, setOutcome] = useState<ApplyOutcome | null>(null);
  const [confirmProtected, setConfirmProtected] = useState(false);
  const [pending, startTransition] = useTransition();

  const reset = (text: string) => {
    setRaw(text);
    setPreview(null);
    setOutcome(null);
    setConfirmProtected(false);
  };

  const onFile = async (file: File | undefined) => {
    if (file) reset(await file.text());
  };

  const runPreview = () =>
    startTransition(async () => {
      setOutcome(null);
      setPreview(await previewPackageAction(projectId, raw));
    });

  const runApply = () =>
    startTransition(async () => {
      const result = await applyPackageAction(projectId, raw, confirmProtected);
      setOutcome(result);
      if (result.status !== "rejected") setPreview(await previewPackageAction(projectId, raw));
    });

  const errors = preview?.issues.filter((i) => i.severity === "error") ?? [];
  const warnings = preview?.issues.filter((i) => i.severity === "warning") ?? [];
  const needsConfirm = !!preview?.requiresProtectedConfirmation;

  return (
    <div className="stack">
      <div className="panel stack">
        <div className="row">
          <input type="file" accept=".json,application/json" onChange={(e) => onFile(e.target.files?.[0])} />
        </div>
        <textarea
          className="mono"
          style={{ minHeight: "14rem" }}
          value={raw}
          onChange={(e) => reset(e.target.value)}
          placeholder='{"format": "wordly.change-package", "formatVersion": 1, ...}'
        />
        <div>
          <button onClick={runPreview} disabled={pending || !raw.trim()}>
            Validate &amp; preview
          </button>
        </div>
      </div>

      {outcome?.status === "applied" ? (
        <div className="banner ok">Package applied. Previous revisions are preserved.</div>
      ) : null}
      {outcome?.status === "already_applied" ? (
        <div className="banner info">This package was already applied. Nothing was changed again.</div>
      ) : null}
      {outcome?.status === "rejected" ? (
        <div className="panel">
          <div className="banner error">Package rejected. No data was changed.</div>
          <IssueList issues={outcome.issues} />
        </div>
      ) : null}
      {outcome && outcome.status !== "rejected" ? <ResultSummary result={outcome.result} projectId={projectId} /> : null}

      {preview && !outcome ? (
        <>
          {preview.header ? (
            <div className="panel">
              <h3>{preview.header.summary}</h3>
              <div className="small stack">
                <div>
                  Package <code>{preview.header.packageId}</code> &middot; format v{preview.header.formatVersion} &middot; scope{" "}
                  <strong>{preview.header.scope}</strong>
                </div>
                <div>
                  Approval: <StatusBadge status={preview.header.approval.status} />{" "}
                  {preview.header.approval.statement ? <span className="muted">&ldquo;{preview.header.approval.statement}&rdquo;</span> : null}
                </div>
                {preview.header.source ? (
                  <div>
                    Source: {preview.header.source.conversationLabel ?? ""}{" "}
                    {preview.header.source.url ? (
                      <a href={preview.header.source.url} target="_blank" rel="noreferrer">
                        {preview.header.source.url}
                      </a>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}

          {preview.status === "already_applied" && preview.previousResult ? (
            <>
              <div className="banner info">This package ID was already applied with identical content. Applying again does nothing.</div>
              <ResultSummary result={preview.previousResult} projectId={projectId} />
            </>
          ) : null}

          {errors.length > 0 ? (
            <div className="panel">
              <div className="banner error">
                {errors.length} problem{errors.length === 1 ? "" : "s"} found. The package cannot be applied, and nothing
                will change.
              </div>
              <IssueList issues={errors} />
            </div>
          ) : null}
          <IssueList issues={warnings} />

          {preview.operations.length > 0 ? <h2>Explicit changes ({preview.operations.length})</h2> : null}
          {preview.operations.map((op) => (
            <OperationCard key={op.index} op={op} projectId={projectId} />
          ))}

          {preview.relatedNotes.length > 0 || preview.potentialEffects.length > 0 ? (
            <div className="panel">
              <h2 style={{ marginTop: 0 }}>Potentially affected (not changed)</h2>
              <p className="small muted">
                These records are not modified by this package. They will be added to the review list.
              </p>
              <ul className="small">
                {preview.relatedNotes.map((n, i) => (
                  <li key={`n${i}`}>
                    <strong>{n.title ?? n.recordId}</strong> <span className="muted">[package note]</span> {n.note}
                  </li>
                ))}
                {preview.potentialEffects.map((e, i) => (
                  <li key={`e${i}`}>
                    <Link href={`/projects/${projectId}/records/${e.recordId}`} target="_blank">
                      {e.title}
                    </Link>{" "}
                    <span className="muted">[{RECORD_TYPE_LABELS[e.type]}]</span> mentions{" "}
                    {e.matchedTerms.map((t) => `"${t}"`).join(", ")} (changed: {e.triggeredByTitle})
                    {e.protected ? <> <ProtectionBadge isProtected /></> : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {preview.canApply ? (
            <div className="panel stack">
              {needsConfirm ? (
                <label className="inline">
                  <input type="checkbox" checked={confirmProtected} onChange={(e) => setConfirmProtected(e.target.checked)} />
                  This package changes protected records listed in protectedOverrides. I confirm these protected changes.
                </label>
              ) : null}
              <div>
                <button onClick={runApply} disabled={pending || (needsConfirm && !confirmProtected)}>
                  Apply package
                </button>
              </div>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
