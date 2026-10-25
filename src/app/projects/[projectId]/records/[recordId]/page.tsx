import Link from "next/link";
import { notFound } from "next/navigation";
import { fieldDiffs, textDiff } from "@/changePackage/diff";
import { ContentClassBadge, ProtectionBadge, RevisionBadge, StatusBadge } from "@/components/Badges";
import { FieldDiffTable, TextDiff } from "@/components/DiffView";
import { RECORD_TYPE_LABELS } from "@/domain/recordTypes";
import { getDb } from "@/server/db";
import { NotFoundError } from "@/server/services/errors";
import { getRecord, listRevisions } from "@/server/services/recordService";
import { setProtectionAction } from "../../actions";
import { RecordEditor, StatusForm } from "./RecordForms";

export const dynamic = "force-dynamic";

export default async function RecordPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string; recordId: string }>;
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const { projectId, recordId } = await params;
  const query = await searchParams;
  const db = getDb();

  const record = await getRecord(db, projectId, recordId).catch((e) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  const revisions = await listRevisions(db, record.id);

  const toNum = Number(query.to ?? record.currentRevision);
  const fromNum = Number(query.from ?? Math.max(1, toNum - 1));
  const fromRev = revisions.find((r) => r.revisionNumber === fromNum);
  const toRev = revisions.find((r) => r.revisionNumber === toNum);
  const base = `/projects/${projectId}/records/${record.id}`;

  return (
    <>
      <h1>{record.title}</h1>
      <div className="row" style={{ marginBottom: "1rem" }}>
        <span className="muted small">{RECORD_TYPE_LABELS[record.type]}</span>
        <code className="small">{record.id}</code>
        <StatusBadge status={record.authorityStatus} />
        <RevisionBadge revision={record.currentRevision} />
        <ContentClassBadge contentClass={record.contentClass} />
        <ProtectionBadge isProtected={record.protected} />
        {record.supersededByRecordId ? (
          <span className="small">
            superseded by <Link href={`/projects/${projectId}/records/${record.supersededByRecordId}`}>{record.supersededByRecordId}</Link>
          </span>
        ) : null}
      </div>

      <div className="grid2">
        <section className="panel">
          <h3>Edit</h3>
          <RecordEditor
            key={record.currentRevision}
            projectId={projectId}
            recordId={record.id}
            revision={record.currentRevision}
            title={record.title}
            body={record.body}
            fieldsJson={JSON.stringify(record.fields, null, 2)}
            authorityStatus={record.authorityStatus}
            isProtected={record.protected}
          />
        </section>

        <div>
          <section className="panel">
            <h3>Canon / decision status</h3>
            <StatusForm
              key={record.currentRevision}
              projectId={projectId}
              recordId={record.id}
              revision={record.currentRevision}
              status={record.authorityStatus}
              isProtected={record.protected}
            />
          </section>

          <section className="panel">
            <h3>Protection</h3>
            <p className="small muted">
              Protected records cannot be changed by change packages unless explicitly listed as overrides, and require an
              explicit unlock to edit here. Manuscript chapters are protected by default.
            </p>
            <form action={setProtectionAction.bind(null, projectId, record.id)}>
              <input type="hidden" name="protected" value={record.protected ? "false" : "true"} />
              <button type="submit" className={record.protected ? "secondary" : "danger"}>
                {record.protected ? "Remove protection" : "Protect this record"}
              </button>
            </form>
          </section>

          <section className="panel">
            <h3>Revision history</h3>
            <table>
              <thead>
                <tr>
                  <th>Rev</th>
                  <th>Status</th>
                  <th>Source</th>
                  <th>When</th>
                </tr>
              </thead>
              <tbody>
                {revisions.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <Link href={`${base}?from=${Math.max(1, r.revisionNumber - 1)}&to=${r.revisionNumber}`}>
                        {r.revisionNumber}
                      </Link>
                    </td>
                    <td>
                      <StatusBadge status={r.authorityStatus} />
                    </td>
                    <td className="small">
                      {r.source.kind === "change_package" ? (
                        <>
                          package <code>{r.source.packageId}</code>
                          {r.source.conversationLabel ? <div className="muted">{r.source.conversationLabel}</div> : null}
                          {r.source.url ? (
                            <div>
                              <a href={r.source.url} target="_blank" rel="noreferrer">
                                conversation
                              </a>
                            </div>
                          ) : null}
                        </>
                      ) : (
                        <>{r.source.kind} ({r.source.actor})</>
                      )}
                    </td>
                    <td className="small muted">{r.createdAt.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </div>
      </div>

      <section className="panel">
        <h3>Compare revisions</h3>
        <form className="row" method="get">
          <label className="inline">
            from
            <select name="from" defaultValue={String(fromNum)}>
              {revisions.map((r) => (
                <option key={r.id} value={r.revisionNumber}>
                  {r.revisionNumber}
                </option>
              ))}
            </select>
          </label>
          <label className="inline">
            to
            <select name="to" defaultValue={String(toNum)}>
              {revisions.map((r) => (
                <option key={r.id} value={r.revisionNumber}>
                  {r.revisionNumber}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className="secondary">
            Compare
          </button>
        </form>
        {fromRev && toRev ? (
          <div className="stack" style={{ marginTop: "0.8rem" }}>
            {fromRev.title !== toRev.title ? (
              <div>
                Title: <del>{fromRev.title}</del> &rarr; <ins>{toRev.title}</ins>
              </div>
            ) : null}
            {fromRev.authorityStatus !== toRev.authorityStatus ? (
              <div className="row">
                Status: <StatusBadge status={fromRev.authorityStatus} /> &rarr; <StatusBadge status={toRev.authorityStatus} />
              </div>
            ) : null}
            <TextDiff parts={textDiff(fromRev.body, toRev.body)} />
            <FieldDiffTable diffs={fieldDiffs(fromRev.fields, toRev.fields)} />
          </div>
        ) : (
          <p className="muted">Select two existing revisions.</p>
        )}
      </section>
    </>
  );
}
