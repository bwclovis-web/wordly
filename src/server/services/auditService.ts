import { newId } from "@/domain/ids";
import { stableStringify, type JsonValue } from "@/domain/json";
import type { DbOrTx } from "../db";

export interface AuditInput {
  projectId: string;
  action: string;
  actor: string;
  summary: string;
  sourceId?: string | null;
  packageId?: string | null;
  details: JsonValue;
}

export async function writeAudit(db: DbOrTx, input: AuditInput): Promise<string> {
  const id = newId("aud");
  await db.auditEntry.create({
    data: {
      id,
      projectId: input.projectId,
      action: input.action,
      actor: input.actor,
      summary: input.summary,
      sourceId: input.sourceId ?? null,
      packageId: input.packageId ?? null,
      detailsJson: stableStringify(input.details),
    },
  });
  return id;
}

export interface AuditView {
  id: string;
  action: string;
  actor: string;
  summary: string;
  sourceId: string | null;
  packageId: string | null;
  details: unknown;
  createdAt: Date;
}

export async function listAudit(db: DbOrTx, projectId: string, limit = 200): Promise<AuditView[]> {
  const rows = await db.auditEntry.findMany({
    where: { projectId },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  return rows.map((r) => ({
    id: r.id,
    action: r.action,
    actor: r.actor,
    summary: r.summary,
    sourceId: r.sourceId,
    packageId: r.packageId,
    details: JSON.parse(r.detailsJson),
    createdAt: r.createdAt,
  }));
}
