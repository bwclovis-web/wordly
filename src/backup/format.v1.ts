import { z } from "zod";
import { RECORD_TYPES } from "@/domain/recordTypes";
import { AUTHORITY_STATUSES, REVIEW_ORIGINS, SOURCE_KINDS } from "@/domain/statuses";

export const BACKUP_FORMAT = "wordly.workspace-backup";
export const BACKUP_FORMAT_VERSION = 1;

const id = z.string().min(1).max(200);
const timestamp = z.iso.datetime();
const fields = z.record(z.string(), z.json());

/*
 * A complete, self-describing copy of one workspace: every project, record,
 * revision, provenance source, applied change package, audit entry, review
 * item and imported file. JSON payload columns are kept as the exact strings
 * stored in the database.
 */
export const workspaceBackupV1Schema = z
  .object({
    format: z.literal(BACKUP_FORMAT),
    formatVersion: z.literal(BACKUP_FORMAT_VERSION),
    createdAt: timestamp,
    app: z.object({ name: z.literal("wordly-editor"), migrations: z.array(z.string()) }).strict(),
    workspace: z.object({ id, name: z.string().min(1), createdAt: timestamp }).strict(),
    projects: z.array(z.object({ id, workspaceId: id, title: z.string().min(1), createdAt: timestamp }).strict()),
    records: z.array(
      z
        .object({
          id,
          projectId: id,
          type: z.enum(RECORD_TYPES),
          title: z.string(),
          body: z.string(),
          fields,
          authorityStatus: z.enum(AUTHORITY_STATUSES),
          supersededByRecordId: id.nullable(),
          protected: z.boolean(),
          currentRevision: z.number().int().min(1),
          createdAt: timestamp,
          updatedAt: timestamp,
        })
        .strict(),
    ),
    revisions: z.array(
      z
        .object({
          id,
          recordId: id,
          revisionNumber: z.number().int().min(1),
          title: z.string(),
          body: z.string(),
          fields,
          authorityStatus: z.enum(AUTHORITY_STATUSES),
          supersededByRecordId: id.nullable(),
          contentHash: z.string().regex(/^[0-9a-f]{64}$/),
          sourceId: id,
          createdAt: timestamp,
        })
        .strict(),
    ),
    sources: z.array(
      z
        .object({
          id,
          projectId: id,
          kind: z.enum(SOURCE_KINDS),
          actor: z.string(),
          conversationLabel: z.string().nullable(),
          url: z.string().nullable(),
          packageId: z.string().nullable(),
          originalFilename: z.string().nullable(),
          createdAt: timestamp,
        })
        .strict(),
    ),
    changePackages: z.array(
      z
        .object({
          projectId: id,
          packageId: z.string().min(1),
          formatVersion: z.number().int(),
          contentHash: z.string().regex(/^[0-9a-f]{64}$/),
          summary: z.string(),
          status: z.string(),
          rawJson: z.string(),
          resultJson: z.string(),
          appliedAt: timestamp,
        })
        .strict(),
    ),
    auditEntries: z.array(
      z
        .object({
          id,
          projectId: id,
          action: z.string(),
          actor: z.string(),
          sourceId: id.nullable(),
          packageId: z.string().nullable(),
          summary: z.string(),
          detailsJson: z.string(),
          createdAt: timestamp,
        })
        .strict(),
    ),
    reviewItems: z.array(
      z
        .object({
          id,
          projectId: id,
          recordId: id,
          packageId: z.string().nullable(),
          triggeredByRecordId: id.nullable(),
          origin: z.enum(REVIEW_ORIGINS),
          note: z.string(),
          status: z.enum(["open", "resolved"]),
          createdAt: timestamp,
          resolvedAt: timestamp.nullable(),
        })
        .strict(),
    ),
    importedFiles: z.array(
      z
        .object({
          id,
          projectId: id,
          batchId: id,
          originalFilename: z.string(),
          contentHash: z.string().regex(/^[0-9a-f]{64}$/),
          content: z.string(),
          byteSize: z.number().int().min(0),
          recordId: id,
          action: z.enum(["created", "replaced"]),
          revisionNumber: z.number().int().min(1),
          sourceId: id,
          createdAt: timestamp,
        })
        .strict(),
    ),
    counts: z
      .object({
        projects: z.number().int(),
        records: z.number().int(),
        revisions: z.number().int(),
        sources: z.number().int(),
        changePackages: z.number().int(),
        auditEntries: z.number().int(),
        reviewItems: z.number().int(),
        importedFiles: z.number().int(),
      })
      .strict(),
    /** sha256 of the stable JSON serialization of every other top-level field. */
    checksum: z.string().regex(/^[0-9a-f]{64}$/),
  })
  .strict();

export type WorkspaceBackupV1 = z.output<typeof workspaceBackupV1Schema>;
export type BackupCounts = WorkspaceBackupV1["counts"];
