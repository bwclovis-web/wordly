import { getDb } from "@/server/db";
import { listRecords } from "@/server/services/recordService";
import { ExportClient } from "./ExportClient";

export const dynamic = "force-dynamic";

export default async function ExportPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const records = await listRecords(getDb(), projectId);

  return (
    <>
      <h1>Export context bundle</h1>
      <p className="muted small">
        Select the current records to bring into a ChatGPT conversation. The bundle includes record IDs, current revision
        numbers, types, authority statuses and protection flags, plus instructions and a JSON Schema so the assistant can
        return a compatible change package.
      </p>
      <ExportClient
        projectId={projectId}
        records={records.map((r) => ({
          id: r.id,
          title: r.title,
          type: r.type,
          revision: r.currentRevision,
          authorityStatus: r.authorityStatus,
          protected: r.protected,
        }))}
      />
    </>
  );
}
