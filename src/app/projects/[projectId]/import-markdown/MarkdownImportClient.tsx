"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { ProtectionBadge, StatusBadge } from "@/components/Badges";
import { IssueList } from "@/components/IssueList";
import { RECORD_TYPE_LABELS, type RecordType } from "@/domain/recordTypes";
import { AUTHORITY_STATUSES } from "@/domain/statuses";
import type {
  FilePreview,
  ImportDecision,
  MarkdownFile,
  MarkdownImportItem,
  MarkdownImportOutcome,
  MarkdownImportPreview,
} from "@/server/services/markdownImportService";
import { applyMarkdownAction, previewMarkdownAction } from "../actions";

interface Choice {
  title: string;
  type: string;
  authorityStatus: string;
  protection: "" | "yes" | "no";
  /** "" = undecided, "create", "skip", or "replace:<recordId>". */
  decision: string;
}

const REASON_LABELS = { same_content: "same content", same_title: "same title", same_filename: "same filename" } as const;

function initialChoice(f: FilePreview): Choice {
  return { title: f.suggestedTitle, type: "", authorityStatus: "", protection: "", decision: f.needsDecision ? "" : "create" };
}

function toDecision(f: FilePreview, value: string): ImportDecision | undefined {
  if (value === "create" || value === "skip") return { action: value };
  if (value.startsWith("replace:")) {
    const target = f.duplicates.find((d) => d.recordId === value.slice(8));
    if (target) return { action: "replace", recordId: target.recordId, expectedRevision: target.currentRevision };
  }
  return undefined;
}

export function MarkdownImportClient({ projectId }: { projectId: string }) {
  const [files, setFiles] = useState<MarkdownFile[]>([]);
  const [preview, setPreview] = useState<MarkdownImportPreview | null>(null);
  const [choices, setChoices] = useState<Choice[]>([]);
  const [bulk, setBulk] = useState<Omit<Choice, "title" | "decision">>({ type: "", authorityStatus: "", protection: "" });
  const [label, setLabel] = useState("");
  const [confirmProtected, setConfirmProtected] = useState(false);
  const [outcome, setOutcome] = useState<MarkdownImportOutcome | null>(null);
  const [pending, startTransition] = useTransition();

  const onFiles = (list: FileList | null) => {
    setPreview(null);
    setOutcome(null);
    setConfirmProtected(false);
    if (!list || list.length === 0) return;
    startTransition(async () => {
      const read = await Promise.all([...list].map(async (f) => ({ filename: f.name, content: await f.text() })));
      setFiles(read);
      const p = await previewMarkdownAction(projectId, read);
      setPreview(p);
      setChoices(p.files.map(initialChoice));
    });
  };

  const update = (i: number, patch: Partial<Choice>) => {
    setOutcome(null);
    setChoices((cs) => cs.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  };

  const applyBulk = () => {
    setOutcome(null);
    setChoices((cs) =>
      cs.map((c) => ({
        ...c,
        type: bulk.type || c.type,
        authorityStatus: bulk.authorityStatus || c.authorityStatus,
        protection: bulk.protection || c.protection,
      })),
    );
  };

  const protectedReplacements =
    preview?.files.filter((f, i) => {
      const d = choices[i]?.decision ?? "";
      return d.startsWith("replace:") && f.duplicates.find((x) => x.recordId === d.slice(8))?.protected;
    }) ?? [];

  const incomplete = choices.some(
    (c) => c.decision !== "skip" && (!c.type || !c.authorityStatus || !c.protection || !c.decision || !c.title.trim()),
  );

  const runImport = () =>
    startTransition(async () => {
      if (!preview) return;
      const items: MarkdownImportItem[] = files.map((f, i) => ({
        ...f,
        title: choices[i].title,
        type: choices[i].type,
        authorityStatus: choices[i].authorityStatus,
        protected: choices[i].protection === "yes",
        decision: toDecision(preview.files[i], choices[i].decision),
      }));
      const result = await applyMarkdownAction(projectId, items, label, confirmProtected);
      setOutcome(result);
    });

  const fileIssues = (i: number) => (outcome?.status === "rejected" ? outcome.issues.filter((x) => x.operationIndex === i) : []);
  const batchIssues = outcome?.status === "rejected" ? outcome.issues.filter((x) => x.operationIndex === undefined) : [];

  if (outcome?.status === "applied") {
    return (
      <div className="stack">
        <div className="banner ok">Import complete. Each file is stored with its original name and content.</div>
        <table>
          <thead>
            <tr>
              <th>File</th>
              <th>Result</th>
              <th>Record</th>
            </tr>
          </thead>
          <tbody>
            {outcome.results.map((r) => (
              <tr key={r.index}>
                <td>{r.filename}</td>
                <td>
                  {r.action}
                  {r.revision ? ` (rev ${r.revision})` : ""}
                </td>
                <td>{r.recordId ? <Link href={`/projects/${projectId}/records/${r.recordId}`}>{r.title}</Link> : "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div>
          <button className="secondary" onClick={() => { setOutcome(null); setPreview(null); setFiles([]); }}>
            Import more files
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="stack">
      <div className="panel row">
        <input type="file" multiple accept=".md,.markdown,text/markdown" onChange={(e) => onFiles(e.target.files)} />
        {pending ? <span className="small muted">Working...</span> : null}
      </div>

      {preview ? (
        <>
          <div className="panel stack">
            <strong>Set for all files</strong>
            <div className="row">
              <TypeSelect value={bulk.type} types={preview.importableTypes} onChange={(type) => setBulk({ ...bulk, type })} />
              <StatusSelect value={bulk.authorityStatus} onChange={(authorityStatus) => setBulk({ ...bulk, authorityStatus })} />
              <ProtectionSelect value={bulk.protection} onChange={(protection) => setBulk({ ...bulk, protection })} />
              <button className="secondary" onClick={applyBulk}>
                Apply to all
              </button>
            </div>
            <label className="small">
              Provenance label (optional){" "}
              <input type="text" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Reference notes, Oct 2026" />
            </label>
          </div>

          {preview.files.map((f, i) => (
            <div key={i} className="panel stack" style={fileIssues(i).some((x) => x.severity === "error") ? { borderColor: "var(--danger)" } : undefined}>
              <div className="row">
                <strong>{f.filename}</strong>
                <span className="small muted">{(f.byteSize / 1024).toFixed(1)} KiB</span>
              </div>
              <IssueList issues={f.issues} />
              <div className="row">
                <input
                  type="text"
                  value={choices[i]?.title ?? ""}
                  onChange={(e) => update(i, { title: e.target.value })}
                  style={{ minWidth: "18rem" }}
                  aria-label="Title"
                />
                <TypeSelect value={choices[i]?.type ?? ""} types={preview.importableTypes} onChange={(type) => update(i, { type })} />
                <StatusSelect value={choices[i]?.authorityStatus ?? ""} onChange={(authorityStatus) => update(i, { authorityStatus })} />
                <ProtectionSelect value={choices[i]?.protection ?? ""} onChange={(protection) => update(i, { protection })} />
                <select value={choices[i]?.decision ?? ""} onChange={(e) => update(i, { decision: e.target.value })} aria-label="Action">
                  {f.needsDecision ? <option value="">Action: choose...</option> : null}
                  <option value="create">Create new record</option>
                  {f.duplicates.map((d) => (
                    <option key={d.recordId} value={`replace:${d.recordId}`}>
                      Replace &ldquo;{d.title}&rdquo; (rev {d.currentRevision})
                    </option>
                  ))}
                  <option value="skip">Skip this file</option>
                </select>
              </div>
              {f.duplicates.length > 0 || f.batchDuplicates.length > 0 ? (
                <div className="small">
                  <strong>Possible duplicates:</strong>
                  <ul>
                    {f.duplicates.map((d) => (
                      <li key={d.recordId}>
                        <Link href={`/projects/${projectId}/records/${d.recordId}`} target="_blank">
                          {d.title}
                        </Link>{" "}
                        <span className="muted">{RECORD_TYPE_LABELS[d.type]}</span> <StatusBadge status={d.authorityStatus} />{" "}
                        <ProtectionBadge isProtected={d.protected} /> ({d.reasons.map((r) => REASON_LABELS[r]).join(", ")})
                      </li>
                    ))}
                    {f.batchDuplicates.map((d) => (
                      <li key={`b${d.index}`}>
                        {d.filename} in this batch ({d.reasons.map((r) => REASON_LABELS[r]).join(", ")})
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              <details>
                <summary className="small">Preview content</summary>
                <pre className="mono small" style={{ whiteSpace: "pre-wrap" }}>
                  {f.excerpt}
                  {f.byteSize > f.excerpt.length ? "\n..." : ""}
                </pre>
              </details>
              <IssueList issues={fileIssues(i)} />
            </div>
          ))}

          <div className="panel stack">
            {outcome?.status === "rejected" ? (
              <>
                <div className="banner error">Import rejected. Nothing was written.</div>
                <IssueList issues={batchIssues} />
              </>
            ) : null}
            {protectedReplacements.length > 0 ? (
              <label className="inline">
                <input type="checkbox" checked={confirmProtected} onChange={(e) => setConfirmProtected(e.target.checked)} />
                I confirm replacing {protectedReplacements.length} protected record
                {protectedReplacements.length === 1 ? "" : "s"}. Previous revisions are kept.
              </label>
            ) : null}
            <div className="row">
              <button onClick={runImport} disabled={pending || incomplete}>
                Import {choices.filter((c) => c.decision !== "skip").length} file(s)
              </button>
              {incomplete ? (
                <span className="small muted">Choose type, canon status, protection and action for every file.</span>
              ) : null}
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}

function TypeSelect({ value, types, onChange }: { value: string; types: RecordType[]; onChange: (v: string) => void }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} aria-label="Document type">
      <option value="">Type: choose...</option>
      {types.map((t) => (
        <option key={t} value={t}>
          {RECORD_TYPE_LABELS[t]}
        </option>
      ))}
    </select>
  );
}

function StatusSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} aria-label="Canon status">
      <option value="">Canon status: choose...</option>
      {AUTHORITY_STATUSES.map((s) => (
        <option key={s} value={s}>
          {s}
        </option>
      ))}
    </select>
  );
}

function ProtectionSelect({ value, onChange }: { value: string; onChange: (v: "" | "yes" | "no") => void }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value as "" | "yes" | "no")} aria-label="Protection">
      <option value="">Protection: choose...</option>
      <option value="no">Not protected</option>
      <option value="yes">Protected</option>
    </select>
  );
}
