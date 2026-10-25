import { readdirSync } from "node:fs";
import path from "node:path";
import {
  BACKUP_FORMAT,
  BACKUP_FORMAT_VERSION,
  workspaceBackupV1Schema,
  type BackupCounts,
  type WorkspaceBackupV1,
} from "@/backup/format.v1";
import { newId, type IdPrefix } from "@/domain/ids";
import { errorIssue, hasErrors, type Issue } from "@/domain/issues";
import { parseJsonObject, sha256, stableStringify } from "@/domain/json";
import { snapshotHash, snapshotOf, type RecordSnapshot } from "@/domain/records";
import type { Db, DbOrTx, Tx } from "../db";
import { writeAudit } from "./auditService";
import { NotFoundError } from "./errors";

/*
 * Full workspace backup and restore. Restore replicates stored history
 * verbatim (revisions, provenance, audit), so unlike every other write path it
 * does not go through mutationService: it creates rows exactly as they were.
 */

export type IdStrategy = "preserve" | "remap";

const MIGRATIONS_DIR = path.join(/*turbopackIgnore: true*/ process.cwd(), "prisma", "migrations");

export function knownMigrations(): string[] {
  try {
    return readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();
  } catch {
    return [];
  }
}

function backupChecksum(backup: Omit<WorkspaceBackupV1, "checksum">): string {
  return sha256(stableStringify(backup));
}

const iso = (d: Date) => d.toISOString();
const isoOrNull = (d: Date | null) => (d ? d.toISOString() : null);

export async function createWorkspaceBackup(db: DbOrTx, workspaceId: string): Promise<WorkspaceBackupV1> {
  const workspace = await db.workspace.findUnique({ where: { id: workspaceId } });
  if (!workspace) throw new NotFoundError(`Workspace ${workspaceId} not found`);
  const projects = await db.project.findMany({ where: { workspaceId }, orderBy: { id: "asc" } });
  const projectIds = projects.map((p) => p.id);
  const inProjects = { projectId: { in: projectIds } };

  const [records, sources, changePackages, auditEntries, reviewItems, importedFiles] = await Promise.all([
    db.record.findMany({ where: inProjects, orderBy: { id: "asc" } }),
    db.source.findMany({ where: inProjects, orderBy: { id: "asc" } }),
    db.changePackage.findMany({ where: inProjects, orderBy: [{ projectId: "asc" }, { packageId: "asc" }] }),
    db.auditEntry.findMany({ where: inProjects, orderBy: { id: "asc" } }),
    db.reviewItem.findMany({ where: inProjects, orderBy: { id: "asc" } }),
    db.importedFile.findMany({ where: inProjects, orderBy: { id: "asc" } }),
  ]);
  const revisions = await db.revision.findMany({
    where: { recordId: { in: records.map((r) => r.id) } },
    orderBy: [{ recordId: "asc" }, { revisionNumber: "asc" }],
  });

  const body: Omit<WorkspaceBackupV1, "checksum"> = {
    format: BACKUP_FORMAT,
    formatVersion: BACKUP_FORMAT_VERSION,
    createdAt: new Date().toISOString(),
    app: { name: "wordly-editor", migrations: knownMigrations() },
    workspace: { id: workspace.id, name: workspace.name, createdAt: iso(workspace.createdAt) },
    projects: projects.map((p) => ({ id: p.id, workspaceId: p.workspaceId, title: p.title, createdAt: iso(p.createdAt) })),
    records: records.map((r) => ({
      id: r.id,
      projectId: r.projectId,
      type: r.type as WorkspaceBackupV1["records"][number]["type"],
      title: r.title,
      body: r.body,
      fields: parseJsonObject(r.fields),
      authorityStatus: r.authorityStatus as WorkspaceBackupV1["records"][number]["authorityStatus"],
      supersededByRecordId: r.supersededByRecordId,
      protected: r.protected,
      currentRevision: r.currentRevision,
      createdAt: iso(r.createdAt),
      updatedAt: iso(r.updatedAt),
    })),
    revisions: revisions.map((r) => ({
      id: r.id,
      recordId: r.recordId,
      revisionNumber: r.revisionNumber,
      title: r.title,
      body: r.body,
      fields: parseJsonObject(r.fields),
      authorityStatus: r.authorityStatus as WorkspaceBackupV1["revisions"][number]["authorityStatus"],
      supersededByRecordId: r.supersededByRecordId,
      contentHash: r.contentHash,
      sourceId: r.sourceId,
      createdAt: iso(r.createdAt),
    })),
    sources: sources.map((s) => ({
      id: s.id,
      projectId: s.projectId,
      kind: s.kind as WorkspaceBackupV1["sources"][number]["kind"],
      actor: s.actor,
      conversationLabel: s.conversationLabel,
      url: s.url,
      packageId: s.packageId,
      originalFilename: s.originalFilename,
      createdAt: iso(s.createdAt),
    })),
    changePackages: changePackages.map((p) => ({
      projectId: p.projectId,
      packageId: p.packageId,
      formatVersion: p.formatVersion,
      contentHash: p.contentHash,
      summary: p.summary,
      status: p.status,
      rawJson: p.rawJson,
      resultJson: p.resultJson,
      appliedAt: iso(p.appliedAt),
    })),
    auditEntries: auditEntries.map((a) => ({
      id: a.id,
      projectId: a.projectId,
      action: a.action,
      actor: a.actor,
      sourceId: a.sourceId,
      packageId: a.packageId,
      summary: a.summary,
      detailsJson: a.detailsJson,
      createdAt: iso(a.createdAt),
    })),
    reviewItems: reviewItems.map((r) => ({
      id: r.id,
      projectId: r.projectId,
      recordId: r.recordId,
      packageId: r.packageId,
      triggeredByRecordId: r.triggeredByRecordId,
      origin: r.origin as WorkspaceBackupV1["reviewItems"][number]["origin"],
      note: r.note,
      status: r.status as "open" | "resolved",
      createdAt: iso(r.createdAt),
      resolvedAt: isoOrNull(r.resolvedAt),
    })),
    importedFiles: importedFiles.map((f) => ({
      id: f.id,
      projectId: f.projectId,
      batchId: f.batchId,
      originalFilename: f.originalFilename,
      contentHash: f.contentHash,
      content: f.content,
      byteSize: f.byteSize,
      recordId: f.recordId,
      action: f.action as "created" | "replaced",
      revisionNumber: f.revisionNumber,
      sourceId: f.sourceId,
      createdAt: iso(f.createdAt),
    })),
    counts: {
      projects: projects.length,
      records: records.length,
      revisions: revisions.length,
      sources: sources.length,
      changePackages: changePackages.length,
      auditEntries: auditEntries.length,
      reviewItems: reviewItems.length,
      importedFiles: importedFiles.length,
    },
  };
  return { ...body, checksum: backupChecksum(body) };
}

export interface BackupSummary {
  workspaceId: string;
  workspaceName: string;
  createdAt: string;
  projects: Array<{ id: string; title: string; records: number; openReviewItems: number; changePackages: number }>;
  counts: BackupCounts;
}

export interface BackupValidation {
  ok: boolean;
  issues: Issue[];
  backup: WorkspaceBackupV1 | null;
  summary: BackupSummary | null;
}

function integrity(message: string, pathStr?: string): Issue {
  return errorIssue("BACKUP_INTEGRITY", message, pathStr ? { path: pathStr } : {});
}

function checkUnique(values: string[], label: string, issues: Issue[]) {
  const seen = new Set<string>();
  for (const v of values) {
    if (seen.has(v)) issues.push(integrity(`Duplicate ${label} ${v} in backup.`));
    seen.add(v);
  }
}

/** Structural and referential checks that need no database. */
function checkInternalConsistency(b: WorkspaceBackupV1): Issue[] {
  const issues: Issue[] = [];
  const { checksum, ...rest } = b;
  if (backupChecksum(rest) !== checksum) {
    issues.push(errorIssue("BACKUP_CHECKSUM_MISMATCH", "Checksum does not match the backup contents; the file is corrupted or was edited."));
  }
  const actualCounts: BackupCounts = {
    projects: b.projects.length,
    records: b.records.length,
    revisions: b.revisions.length,
    sources: b.sources.length,
    changePackages: b.changePackages.length,
    auditEntries: b.auditEntries.length,
    reviewItems: b.reviewItems.length,
    importedFiles: b.importedFiles.length,
  };
  for (const key of Object.keys(actualCounts) as (keyof BackupCounts)[]) {
    if (actualCounts[key] !== b.counts[key]) {
      issues.push(errorIssue("BACKUP_COUNT_MISMATCH", `counts.${key} is ${b.counts[key]} but the backup contains ${actualCounts[key]}.`));
    }
  }

  const unknownMigrations = b.app.migrations.filter((m) => !knownMigrations().includes(m));
  if (unknownMigrations.length > 0 && knownMigrations().length > 0) {
    issues.push(integrity(`Backup was created by a newer schema (${unknownMigrations.join(", ")}). Update the app before restoring.`));
  }

  checkUnique(b.projects.map((p) => p.id), "project", issues);
  checkUnique(b.records.map((r) => r.id), "record", issues);
  checkUnique(b.revisions.map((r) => r.id), "revision", issues);
  checkUnique(b.sources.map((s) => s.id), "source", issues);
  checkUnique(b.auditEntries.map((a) => a.id), "audit entry", issues);
  checkUnique(b.reviewItems.map((r) => r.id), "review item", issues);
  checkUnique(b.importedFiles.map((f) => f.id), "imported file", issues);
  checkUnique(b.changePackages.map((p) => `${p.projectId}/${p.packageId}`), "change package", issues);

  const projectIds = new Set(b.projects.map((p) => p.id));
  const recordIds = new Set(b.records.map((r) => r.id));
  const sourceIds = new Set(b.sources.map((s) => s.id));
  const recordProject = new Map(b.records.map((r) => [r.id, r.projectId]));

  for (const p of b.projects) {
    if (p.workspaceId !== b.workspace.id) issues.push(integrity(`Project ${p.id} belongs to another workspace.`));
  }
  const needProject = (pid: string, what: string) => {
    if (!projectIds.has(pid)) issues.push(integrity(`${what} references missing project ${pid}.`));
  };
  b.records.forEach((r) => {
    needProject(r.projectId, `Record ${r.id}`);
    if (r.supersededByRecordId && !recordIds.has(r.supersededByRecordId)) {
      issues.push(integrity(`Record ${r.id} is superseded by missing record ${r.supersededByRecordId}.`));
    }
  });
  b.sources.forEach((s) => needProject(s.projectId, `Source ${s.id}`));
  b.changePackages.forEach((p) => needProject(p.projectId, `Change package ${p.packageId}`));
  b.auditEntries.forEach((a) => {
    needProject(a.projectId, `Audit entry ${a.id}`);
    if (a.sourceId && !sourceIds.has(a.sourceId)) issues.push(integrity(`Audit entry ${a.id} references missing source ${a.sourceId}.`));
  });
  b.reviewItems.forEach((r) => {
    needProject(r.projectId, `Review item ${r.id}`);
    if (!recordIds.has(r.recordId)) issues.push(integrity(`Review item ${r.id} references missing record ${r.recordId}.`));
  });
  b.importedFiles.forEach((f) => {
    needProject(f.projectId, `Imported file ${f.id}`);
    if (!recordIds.has(f.recordId)) issues.push(integrity(`Imported file ${f.id} references missing record ${f.recordId}.`));
    if (!sourceIds.has(f.sourceId)) issues.push(integrity(`Imported file ${f.id} references missing source ${f.sourceId}.`));
    if (sha256(f.content) !== f.contentHash) issues.push(integrity(`Imported file ${f.id} content does not match its hash.`));
  });

  const revisionsByRecord = new Map<string, WorkspaceBackupV1["revisions"]>();
  for (const rev of b.revisions) {
    if (!recordIds.has(rev.recordId)) issues.push(integrity(`Revision ${rev.id} references missing record ${rev.recordId}.`));
    if (!sourceIds.has(rev.sourceId)) issues.push(integrity(`Revision ${rev.id} references missing source ${rev.sourceId}.`));
    const snap: RecordSnapshot = {
      title: rev.title,
      body: rev.body,
      fields: rev.fields,
      authorityStatus: rev.authorityStatus,
      supersededByRecordId: rev.supersededByRecordId,
    };
    if (snapshotHash(snap) !== rev.contentHash) {
      issues.push(integrity(`Revision ${rev.recordId}#${rev.revisionNumber} content does not match its stored hash.`));
    }
    const sourceProject = b.sources.find((s) => s.id === rev.sourceId)?.projectId;
    if (sourceProject && sourceProject !== recordProject.get(rev.recordId)) {
      issues.push(integrity(`Revision ${rev.id} provenance belongs to another project.`));
    }
    const list = revisionsByRecord.get(rev.recordId) ?? [];
    list.push(rev);
    revisionsByRecord.set(rev.recordId, list);
  }
  for (const r of b.records) {
    const revs = (revisionsByRecord.get(r.id) ?? []).sort((x, y) => x.revisionNumber - y.revisionNumber);
    const contiguous = revs.length === r.currentRevision && revs.every((rev, i) => rev.revisionNumber === i + 1);
    if (!contiguous) {
      issues.push(integrity(`Record ${r.id} must have revisions 1..${r.currentRevision}; found ${revs.map((x) => x.revisionNumber).join(",") || "none"}.`));
      continue;
    }
    const latest = revs[revs.length - 1];
    if (latest.contentHash !== snapshotHash(snapshotOf(r))) {
      issues.push(integrity(`Record ${r.id} current content does not match its latest revision.`));
    }
  }

  for (const p of b.changePackages) {
    try {
      if (sha256(stableStringify(JSON.parse(p.rawJson))) !== p.contentHash) {
        issues.push(integrity(`Change package ${p.packageId} content does not match its stored hash.`));
      }
      JSON.parse(p.resultJson);
    } catch {
      issues.push(integrity(`Change package ${p.packageId} has unreadable JSON.`));
    }
  }
  for (const a of b.auditEntries) {
    try {
      JSON.parse(a.detailsJson);
    } catch {
      issues.push(integrity(`Audit entry ${a.id} has unreadable details JSON.`));
    }
  }
  return issues;
}

async function findCollisions(db: DbOrTx, b: WorkspaceBackupV1): Promise<Issue[]> {
  const issues: Issue[] = [];
  const check = async (label: string, count: Promise<number>) => {
    const n = await count;
    if (n > 0) {
      issues.push(
        errorIssue(
          "BACKUP_ID_COLLISION",
          `${n} ${label} ID(s) from the backup already exist in the target database. Restore into a separate database, or restore as a new workspace (new IDs).`,
        ),
      );
    }
  };
  await check("workspace", db.workspace.count({ where: { id: b.workspace.id } }));
  await check("project", db.project.count({ where: { id: { in: b.projects.map((p) => p.id) } } }));
  await check("record", db.record.count({ where: { id: { in: b.records.map((r) => r.id) } } }));
  await check("revision", db.revision.count({ where: { id: { in: b.revisions.map((r) => r.id) } } }));
  await check("source", db.source.count({ where: { id: { in: b.sources.map((s) => s.id) } } }));
  await check("audit entry", db.auditEntry.count({ where: { id: { in: b.auditEntries.map((a) => a.id) } } }));
  await check("review item", db.reviewItem.count({ where: { id: { in: b.reviewItems.map((r) => r.id) } } }));
  await check("imported file", db.importedFile.count({ where: { id: { in: b.importedFiles.map((f) => f.id) } } }));
  return issues;
}

function summarize(b: WorkspaceBackupV1): BackupSummary {
  return {
    workspaceId: b.workspace.id,
    workspaceName: b.workspace.name,
    createdAt: b.createdAt,
    projects: b.projects.map((p) => ({
      id: p.id,
      title: p.title,
      records: b.records.filter((r) => r.projectId === p.id).length,
      openReviewItems: b.reviewItems.filter((r) => r.projectId === p.id && r.status === "open").length,
      changePackages: b.changePackages.filter((c) => c.projectId === p.id).length,
    })),
    counts: b.counts,
  };
}

/** Validates a backup completely without writing anything. */
export async function validateWorkspaceBackup(
  db: DbOrTx,
  input: string | unknown,
  options: { idStrategy: IdStrategy },
): Promise<BackupValidation> {
  let raw: unknown = input;
  if (typeof input === "string") {
    try {
      raw = JSON.parse(input);
    } catch (e) {
      return { ok: false, issues: [errorIssue("INVALID_JSON", `Not valid JSON: ${(e as Error).message}`)], backup: null, summary: null };
    }
  }
  const obj = raw as { format?: unknown; formatVersion?: unknown } | null;
  if (!obj || typeof obj !== "object" || obj.format !== BACKUP_FORMAT) {
    return { ok: false, issues: [errorIssue("UNSUPPORTED_FORMAT", `"format" must be "${BACKUP_FORMAT}".`)], backup: null, summary: null };
  }
  if (obj.formatVersion !== BACKUP_FORMAT_VERSION) {
    return {
      ok: false,
      issues: [errorIssue("UNSUPPORTED_FORMAT_VERSION", `Backup formatVersion ${JSON.stringify(obj.formatVersion)} is not supported.`)],
      backup: null,
      summary: null,
    };
  }
  const parsed = workspaceBackupV1Schema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.slice(0, 50).map((i) => errorIssue("SCHEMA_INVALID", i.message, { path: i.path.join(".") })),
      backup: null,
      summary: null,
    };
  }
  const backup = parsed.data;
  const issues = checkInternalConsistency(backup);
  if (options.idStrategy === "preserve") issues.push(...(await findCollisions(db, backup)));
  return { ok: !hasErrors(issues), issues, backup, summary: summarize(backup) };
}

function rewriteIds(value: unknown, map: ReadonlyMap<string, string>): unknown {
  if (typeof value === "string") return map.get(value) ?? value;
  if (Array.isArray(value)) return value.map((v) => rewriteIds(v, map));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, rewriteIds(v, map)]));
  }
  return value;
}

export interface RestoreResult {
  ok: true;
  workspaceId: string;
  workspaceName: string;
  idStrategy: IdStrategy;
  projects: Array<{ originalId: string; id: string; title: string }>;
  counts: BackupCounts;
}

export type RestoreOutcome = RestoreResult | { ok: false; issues: Issue[] };

export interface RestoreOptions {
  /**
   * `preserve` keeps every ID (use for an empty/separate database).
   * `remap` assigns new IDs so the copy can sit beside the original as an
   * isolated workspace; package idempotency stays scoped to the new projects.
   */
  idStrategy: IdStrategy;
  workspaceName?: string;
  actor?: string;
  /** Runs inside the transaction just before commit; a throw rolls everything back. */
  beforeCommit?: (tx: Tx) => Promise<void>;
}

export async function restoreWorkspaceBackup(db: Db, input: string | unknown, options: RestoreOptions): Promise<RestoreOutcome> {
  const validation = await validateWorkspaceBackup(db, input, { idStrategy: options.idStrategy });
  if (!validation.ok || !validation.backup) return { ok: false, issues: validation.issues };
  const b = validation.backup;

  const map = new Map<string, string>();
  const remap = options.idStrategy === "remap";
  const assign = (oldId: string, prefix: IdPrefix) => {
    if (!map.has(oldId)) map.set(oldId, remap ? newId(prefix) : oldId);
    return map.get(oldId)!;
  };
  const m = (oldId: string) => map.get(oldId) ?? oldId;
  const mn = (oldId: string | null) => (oldId === null ? null : m(oldId));

  const workspaceId = assign(b.workspace.id, "wsp");
  b.projects.forEach((p) => assign(p.id, "prj"));
  b.records.forEach((r) => assign(r.id, "rec"));
  b.revisions.forEach((r) => assign(r.id, "rev"));
  b.sources.forEach((s) => assign(s.id, "src"));
  b.auditEntries.forEach((a) => assign(a.id, "aud"));
  b.reviewItems.forEach((r) => assign(r.id, "rvw"));
  b.importedFiles.forEach((f) => assign(f.id, "imp"));

  const workspaceName =
    options.workspaceName?.trim() || (remap ? `${b.workspace.name} (restored ${b.createdAt.slice(0, 10)})` : b.workspace.name);
  const rewriteJson = (text: string) => (remap ? JSON.stringify(rewriteIds(JSON.parse(text), map)) : text);

  try {
    await db.$transaction(
      async (tx) => {
        if (options.idStrategy === "preserve") {
          const collisions = await findCollisions(tx, b);
          if (collisions.length) throw new RestoreRejected(collisions);
        }
        await tx.workspace.create({ data: { id: workspaceId, name: workspaceName, createdAt: new Date(b.workspace.createdAt) } });
        await tx.project.createMany({
          data: b.projects.map((p) => ({ id: m(p.id), workspaceId, title: p.title, createdAt: new Date(p.createdAt) })),
        });
        await tx.source.createMany({
          data: b.sources.map((s) => ({
            id: m(s.id),
            projectId: m(s.projectId),
            kind: s.kind,
            actor: s.actor,
            conversationLabel: s.conversationLabel,
            url: s.url,
            packageId: s.packageId,
            originalFilename: s.originalFilename,
            createdAt: new Date(s.createdAt),
          })),
        });
        await tx.record.createMany({
          data: b.records.map((r) => ({
            id: m(r.id),
            projectId: m(r.projectId),
            type: r.type,
            title: r.title,
            body: r.body,
            fields: stableStringify(r.fields),
            authorityStatus: r.authorityStatus,
            supersededByRecordId: mn(r.supersededByRecordId),
            protected: r.protected,
            currentRevision: r.currentRevision,
            createdAt: new Date(r.createdAt),
            updatedAt: new Date(r.updatedAt),
          })),
        });
        await tx.revision.createMany({
          data: b.revisions.map((r) => {
            const supersededByRecordId = mn(r.supersededByRecordId);
            const snapshot: RecordSnapshot = {
              title: r.title,
              body: r.body,
              fields: r.fields,
              authorityStatus: r.authorityStatus,
              supersededByRecordId,
            };
            return {
              id: m(r.id),
              recordId: m(r.recordId),
              revisionNumber: r.revisionNumber,
              title: r.title,
              body: r.body,
              fields: stableStringify(r.fields),
              authorityStatus: r.authorityStatus,
              supersededByRecordId,
              contentHash: snapshotHash(snapshot),
              sourceId: m(r.sourceId),
              createdAt: new Date(r.createdAt),
            };
          }),
        });
        await tx.changePackage.createMany({
          data: b.changePackages.map((p) => ({
            projectId: m(p.projectId),
            packageId: p.packageId,
            formatVersion: p.formatVersion,
            contentHash: p.contentHash,
            summary: p.summary,
            status: p.status,
            rawJson: p.rawJson,
            resultJson: rewriteJson(p.resultJson),
            appliedAt: new Date(p.appliedAt),
          })),
        });
        await tx.auditEntry.createMany({
          data: b.auditEntries.map((a) => ({
            id: m(a.id),
            projectId: m(a.projectId),
            action: a.action,
            actor: a.actor,
            sourceId: mn(a.sourceId),
            packageId: a.packageId,
            summary: a.summary,
            detailsJson: rewriteJson(a.detailsJson),
            createdAt: new Date(a.createdAt),
          })),
        });
        await tx.reviewItem.createMany({
          data: b.reviewItems.map((r) => ({
            id: m(r.id),
            projectId: m(r.projectId),
            recordId: m(r.recordId),
            packageId: r.packageId,
            triggeredByRecordId: mn(r.triggeredByRecordId),
            origin: r.origin,
            note: r.note,
            status: r.status,
            createdAt: new Date(r.createdAt),
            resolvedAt: r.resolvedAt ? new Date(r.resolvedAt) : null,
          })),
        });
        await tx.importedFile.createMany({
          data: b.importedFiles.map((f) => ({
            id: m(f.id),
            projectId: m(f.projectId),
            batchId: f.batchId,
            originalFilename: f.originalFilename,
            contentHash: f.contentHash,
            content: f.content,
            byteSize: f.byteSize,
            recordId: m(f.recordId),
            action: f.action,
            revisionNumber: f.revisionNumber,
            sourceId: m(f.sourceId),
            createdAt: new Date(f.createdAt),
          })),
        });
        for (const p of b.projects) {
          await writeAudit(tx, {
            projectId: m(p.id),
            action: "workspace.restore",
            actor: options.actor ?? "author",
            summary: `Restored from backup of "${b.workspace.name}" taken ${b.createdAt}`,
            details: {
              idStrategy: options.idStrategy,
              backupChecksum: b.checksum,
              backupCreatedAt: b.createdAt,
              originalWorkspaceId: b.workspace.id,
              originalProjectId: p.id,
              recordIdMap: Object.fromEntries(
                b.records.filter((r) => r.projectId === p.id).map((r) => [r.id, m(r.id)]),
              ),
            },
          });
        }
        if (options.beforeCommit) await options.beforeCommit(tx);
      },
      { timeout: 120_000 },
    );
  } catch (error) {
    if (error instanceof RestoreRejected) return { ok: false, issues: error.issues };
    throw error;
  }

  return {
    ok: true,
    workspaceId,
    workspaceName,
    idStrategy: options.idStrategy,
    projects: b.projects.map((p) => ({ originalId: p.id, id: m(p.id), title: p.title })),
    counts: b.counts,
  };
}

class RestoreRejected extends Error {
  constructor(readonly issues: Issue[]) {
    super("restore rejected");
  }
}
