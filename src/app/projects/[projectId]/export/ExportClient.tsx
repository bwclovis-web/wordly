"use client";

import { useState, useTransition } from "react";
import { ProtectionBadge, StatusBadge } from "@/components/Badges";
import { RECORD_TYPE_LABELS, RECORD_TYPES, type RecordType } from "@/domain/recordTypes";
import type { AuthorityStatus } from "@/domain/statuses";
import { exportBundleAction } from "../actions";

interface ExportableRecord {
  id: string;
  title: string;
  type: RecordType;
  revision: number;
  authorityStatus: AuthorityStatus;
  protected: boolean;
}

export function ExportClient({ projectId, records }: { projectId: string; records: ExportableRecord[] }) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set(records.filter((r) => r.type !== "manuscript_chapter").map((r) => r.id)));
  const [includeSchema, setIncludeSchema] = useState(true);
  const [bundle, setBundle] = useState("");
  const [copied, setCopied] = useState(false);
  const [pending, startTransition] = useTransition();

  const toggle = (ids: string[], on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => (on ? next.add(id) : next.delete(id)));
      return next;
    });

  const generate = () =>
    startTransition(async () => {
      setCopied(false);
      setBundle(await exportBundleAction(projectId, [...selected], [], includeSchema));
    });

  const download = () => {
    const blob = new Blob([bundle], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `context-bundle-${projectId}-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const copy = async () => {
    await navigator.clipboard.writeText(bundle);
    setCopied(true);
  };

  return (
    <div className="stack">
      {RECORD_TYPES.map((type) => {
        const ofType = records.filter((r) => r.type === type);
        if (ofType.length === 0) return null;
        const ids = ofType.map((r) => r.id);
        const allOn = ids.every((id) => selected.has(id));
        return (
          <div key={type} className="panel">
            <label className="inline" style={{ fontWeight: 600 }}>
              <input type="checkbox" checked={allOn} onChange={(e) => toggle(ids, e.target.checked)} />
              {RECORD_TYPE_LABELS[type]}
            </label>
            <div className="stack" style={{ marginTop: "0.4rem", marginLeft: "1.4rem" }}>
              {ofType.map((r) => (
                <label key={r.id} className="inline">
                  <input type="checkbox" checked={selected.has(r.id)} onChange={(e) => toggle([r.id], e.target.checked)} />
                  {r.title} <code className="small muted">{r.id}</code> <span className="badge">rev {r.revision}</span>
                  <StatusBadge status={r.authorityStatus} />
                  <ProtectionBadge isProtected={r.protected} />
                </label>
              ))}
            </div>
          </div>
        );
      })}

      <div className="panel stack">
        <label className="inline">
          <input type="checkbox" checked={includeSchema} onChange={(e) => setIncludeSchema(e.target.checked)} />
          Include the change-package JSON Schema
        </label>
        <div className="row">
          <button onClick={generate} disabled={pending || selected.size === 0}>
            Generate bundle ({selected.size} record{selected.size === 1 ? "" : "s"})
          </button>
          {bundle ? (
            <>
              <button className="secondary" onClick={download}>
                Download JSON
              </button>
              <button className="secondary" onClick={copy}>
                {copied ? "Copied" : "Copy to clipboard"}
              </button>
            </>
          ) : null}
        </div>
        {bundle ? <textarea className="mono" readOnly value={bundle} style={{ minHeight: "20rem" }} /> : null}
      </div>
    </div>
  );
}
