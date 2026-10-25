import type { Record as RecordRow, Revision as RevisionRow } from "@/generated/prisma/client";
import { parseJsonObject, sha256, stableStringify, type JsonObject } from "./json";
import { contentClassOf, isRecordType, type ContentClass, type RecordType } from "./recordTypes";
import { isAuthorityStatus, type AuthorityStatus } from "./statuses";

/** The versioned content of a record: everything a revision captures. */
export interface RecordSnapshot {
  title: string;
  body: string;
  fields: JsonObject;
  authorityStatus: AuthorityStatus;
  supersededByRecordId: string | null;
}

export interface RecordView extends RecordSnapshot {
  id: string;
  projectId: string;
  type: RecordType;
  contentClass: ContentClass;
  protected: boolean;
  currentRevision: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface RevisionView extends RecordSnapshot {
  id: string;
  recordId: string;
  revisionNumber: number;
  contentHash: string;
  sourceId: string;
  createdAt: Date;
}

export function snapshotHash(snapshot: RecordSnapshot): string {
  return sha256(stableStringify(snapshot));
}

function asType(value: string): RecordType {
  if (!isRecordType(value)) throw new Error(`Unknown record type in database: ${value}`);
  return value;
}

function asStatus(value: string): AuthorityStatus {
  if (!isAuthorityStatus(value)) throw new Error(`Unknown authority status in database: ${value}`);
  return value;
}

export function toRecordView(row: RecordRow): RecordView {
  const type = asType(row.type);
  return {
    id: row.id,
    projectId: row.projectId,
    type,
    contentClass: contentClassOf(type),
    title: row.title,
    body: row.body,
    fields: parseJsonObject(row.fields),
    authorityStatus: asStatus(row.authorityStatus),
    supersededByRecordId: row.supersededByRecordId,
    protected: row.protected,
    currentRevision: row.currentRevision,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function toRevisionView(row: RevisionRow): RevisionView {
  return {
    id: row.id,
    recordId: row.recordId,
    revisionNumber: row.revisionNumber,
    title: row.title,
    body: row.body,
    fields: parseJsonObject(row.fields),
    authorityStatus: asStatus(row.authorityStatus),
    supersededByRecordId: row.supersededByRecordId,
    contentHash: row.contentHash,
    sourceId: row.sourceId,
    createdAt: row.createdAt,
  };
}

export function snapshotOf(view: RecordSnapshot): RecordSnapshot {
  return {
    title: view.title,
    body: view.body,
    fields: view.fields,
    authorityStatus: view.authorityStatus,
    supersededByRecordId: view.supersededByRecordId,
  };
}
