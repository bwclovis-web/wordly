import Link from "next/link";
import { ContentClassBadge, ProtectionBadge, RevisionBadge, StatusBadge } from "@/components/Badges";
import { RECORD_TYPE_LABELS, RECORD_TYPES } from "@/domain/recordTypes";
import { getDb } from "@/server/db";
import { listRecords } from "@/server/services/recordService";
import { NewRecordForm } from "./NewRecordForm";

export const dynamic = "force-dynamic";

export default async function ProjectPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const records = await listRecords(getDb(), projectId);

  return (
    <>
      {RECORD_TYPES.map((type) => {
        const ofType = records.filter((r) => r.type === type);
        if (ofType.length === 0) return null;
        return (
          <section key={type} className="panel">
            <h3>{RECORD_TYPE_LABELS[type]}</h3>
            <table>
              <tbody>
                {ofType.map((r) => (
                  <tr key={r.id}>
                    <td style={{ width: "40%" }}>
                      <Link href={`/projects/${projectId}/records/${r.id}`}>{r.title}</Link>
                    </td>
                    <td className="muted small">
                      <code>{r.id}</code>
                    </td>
                    <td className="row">
                      <StatusBadge status={r.authorityStatus} />
                      <RevisionBadge revision={r.currentRevision} />
                      <ContentClassBadge contentClass={r.contentClass} />
                      <ProtectionBadge isProtected={r.protected} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        );
      })}
      {records.length === 0 ? <p className="muted">No records yet.</p> : null}

      <section className="panel">
        <h3>New record</h3>
        <NewRecordForm projectId={projectId} />
      </section>
    </>
  );
}
