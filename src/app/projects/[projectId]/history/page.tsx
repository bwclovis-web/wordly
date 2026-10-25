import Link from "next/link";
import { getDb } from "@/server/db";
import { listAudit } from "@/server/services/auditService";
import { listChangePackages } from "@/server/services/changePackageService";
import { listReviewItems } from "@/server/services/reviewService";
import { resolveReviewItemAction } from "../actions";

export const dynamic = "force-dynamic";

export default async function HistoryPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const db = getDb();
  const [reviewItems, packages, audit] = await Promise.all([
    listReviewItems(db, projectId, "open"),
    listChangePackages(db, projectId),
    listAudit(db, projectId),
  ]);
  const recordLink = (id: string, label?: string) => <Link href={`/projects/${projectId}/records/${id}`}>{label ?? id}</Link>;

  return (
    <>
      <h1>History &amp; review</h1>

      <section className="panel">
        <h2 style={{ marginTop: 0 }}>Open review items ({reviewItems.length})</h2>
        <p className="small muted">
          Records that may need follow-up because a related record changed. They were not modified automatically.
        </p>
        {reviewItems.length === 0 ? <p className="muted">Nothing to review.</p> : null}
        <table>
          <tbody>
            {reviewItems.map((item) => (
              <tr key={item.id}>
                <td style={{ width: "25%" }}>{recordLink(item.recordId, item.record.title)}</td>
                <td className="small">
                  <span className="muted">[{item.origin === "package_note" ? "package note" : "detected mention"}]</span> {item.note}
                  {item.packageId ? (
                    <div className="muted">
                      from <code>{item.packageId}</code>
                    </div>
                  ) : null}
                </td>
                <td>
                  <form action={resolveReviewItemAction.bind(null, projectId, item.id)}>
                    <button type="submit" className="secondary">
                      Resolve
                    </button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="panel">
        <h2 style={{ marginTop: 0 }}>Applied change packages ({packages.length})</h2>
        <table>
          <thead>
            <tr>
              <th>Package</th>
              <th>Summary</th>
              <th>Changes</th>
              <th>Applied</th>
            </tr>
          </thead>
          <tbody>
            {packages.map((p) => (
              <tr key={p.packageId}>
                <td>
                  <code className="small">{p.packageId}</code>
                </td>
                <td>{p.summary}</td>
                <td className="small">
                  {p.result.changes.map((c) => (
                    <div key={c.index}>
                      {recordLink(c.recordId, c.title)} {c.previousRevision === null ? "new" : `rev ${c.previousRevision}`} &rarr; rev{" "}
                      {c.newRevision}
                    </div>
                  ))}
                </td>
                <td className="small muted">{p.appliedAt.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="panel">
        <h2 style={{ marginTop: 0 }}>Audit log</h2>
        <table>
          <thead>
            <tr>
              <th>When</th>
              <th>Action</th>
              <th>Actor</th>
              <th>Summary</th>
            </tr>
          </thead>
          <tbody>
            {audit.map((a) => (
              <tr key={a.id}>
                <td className="small muted">{a.createdAt.toLocaleString()}</td>
                <td>
                  <code className="small">{a.action}</code>
                </td>
                <td className="small">{a.actor}</td>
                <td className="small">
                  {a.summary}
                  <details>
                    <summary className="muted">details</summary>
                    <pre>{JSON.stringify(a.details, null, 2)}</pre>
                  </details>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}
