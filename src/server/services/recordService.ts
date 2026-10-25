import type { JsonObject } from "@/domain/json";
import { toRecordView, toRevisionView, type RecordView, type RevisionView } from "@/domain/records";
import { RECORD_TYPE_LABELS, type RecordType } from "@/domain/recordTypes";
import type { AuthorityStatus } from "@/domain/statuses";
import type { Db, DbOrTx } from "../db";
import { NotFoundError } from "./errors";
import { applyMutations, setRecordProtection, type AppliedBatch, type MutationContext } from "./mutationService";

/*
 * Direct author edits from the UI. The author editing in the app may touch
 * manuscript content, but protected records still require an explicit unlock.
 */

const UI_ACTOR = "author";

function uiContext(projectId: string, protectedOverrides: string[] = []): MutationContext {
  return {
    projectId,
    actor: UI_ACTOR,
    source: { kind: "ui" },
    scope: "manuscript",
    protectedOverrides: new Set(protectedOverrides),
  };
}

export async function createRecord(
  db: Db,
  projectId: string,
  input: {
    type: RecordType;
    title: string;
    body?: string;
    fields?: JsonObject;
    authorityStatus: AuthorityStatus;
    recordId?: string;
  },
): Promise<AppliedBatch> {
  return applyMutations(
    db,
    uiContext(projectId),
    [
      {
        kind: "create_record",
        recordId: input.recordId,
        type: input.type,
        title: input.title,
        body: input.body ?? "",
        fields: input.fields ?? {},
        authorityStatus: input.authorityStatus,
      },
    ],
    { action: "record.create", summary: `Created ${RECORD_TYPE_LABELS[input.type]} "${input.title}"` },
  );
}

export async function updateRecord(
  db: Db,
  projectId: string,
  input: {
    recordId: string;
    expectedRevision: number;
    title?: string;
    body?: string;
    fields?: JsonObject;
    authorityStatus?: AuthorityStatus;
    /** Author explicitly unlocked a protected record for this edit. */
    unlockProtected?: boolean;
  },
): Promise<AppliedBatch> {
  const current = await getRecord(db, projectId, input.recordId);
  let fieldChanges: { set: JsonObject; unset: string[] } | undefined;
  if (input.fields) {
    const unset = Object.keys(current.fields).filter((k) => !(k in input.fields!));
    fieldChanges = { set: input.fields, unset };
  }
  return applyMutations(
    db,
    uiContext(projectId, input.unlockProtected ? [input.recordId] : []),
    [
      {
        kind: "update_record",
        recordId: input.recordId,
        expectedRevision: input.expectedRevision,
        changes: { title: input.title, body: input.body, fields: fieldChanges },
        authorityStatus: input.authorityStatus,
      },
    ],
    { action: "record.update", summary: `Edited "${input.title ?? current.title}"` },
  );
}

export async function setAuthorityStatus(
  db: Db,
  projectId: string,
  input: {
    recordId: string;
    expectedRevision: number;
    status: AuthorityStatus;
    supersededBy?: string | null;
    unlockProtected?: boolean;
  },
): Promise<AppliedBatch> {
  return applyMutations(
    db,
    uiContext(projectId, input.unlockProtected ? [input.recordId] : []),
    [
      {
        kind: "set_authority_status",
        recordId: input.recordId,
        expectedRevision: input.expectedRevision,
        status: input.status,
        supersededBy: input.supersededBy ?? null,
      },
    ],
    { action: "record.status", summary: `Set ${input.recordId} to ${input.status}` },
  );
}

export async function setProtection(db: Db, projectId: string, recordId: string, isProtected: boolean) {
  await setRecordProtection(db, { projectId, recordId, protected: isProtected, actor: UI_ACTOR });
}

export async function listRecords(db: DbOrTx, projectId: string): Promise<RecordView[]> {
  const rows = await db.record.findMany({ where: { projectId }, orderBy: [{ type: "asc" }, { title: "asc" }] });
  return rows.map(toRecordView);
}

export async function getRecord(db: DbOrTx, projectId: string, recordId: string): Promise<RecordView> {
  const row = await db.record.findFirst({ where: { id: recordId, projectId } });
  if (!row) throw new NotFoundError(`Record ${recordId} not found`);
  return toRecordView(row);
}

export interface RevisionWithSource extends RevisionView {
  source: {
    kind: string;
    actor: string;
    conversationLabel: string | null;
    url: string | null;
    packageId: string | null;
    originalFilename: string | null;
  };
}

export async function listRevisions(db: DbOrTx, recordId: string): Promise<RevisionWithSource[]> {
  const rows = await db.revision.findMany({
    where: { recordId },
    orderBy: { revisionNumber: "desc" },
    include: { source: true },
  });
  return rows.map((r) => ({
    ...toRevisionView(r),
    source: {
      kind: r.source.kind,
      actor: r.source.actor,
      conversationLabel: r.source.conversationLabel,
      url: r.source.url,
      packageId: r.source.packageId,
      originalFilename: r.source.originalFilename,
    },
  }));
}

export async function getRevision(db: DbOrTx, recordId: string, revisionNumber: number): Promise<RevisionView | null> {
  const row = await db.revision.findUnique({ where: { recordId_revisionNumber: { recordId, revisionNumber } } });
  return row ? toRevisionView(row) : null;
}
