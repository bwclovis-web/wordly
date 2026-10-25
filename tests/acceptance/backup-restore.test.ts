import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { WorkspaceBackupV1 } from "@/backup/format.v1";
import { sha256, stableStringify } from "@/domain/json";
import { applyChangePackage } from "@/server/services/changePackageService";
import {
  createWorkspaceBackup,
  restoreWorkspaceBackup,
  validateWorkspaceBackup,
} from "@/server/services/backupService";
import { getRecord, setProtection, updateRecord } from "@/server/services/recordService";
import { CHAPTER_PROSE, createTestDb, IDS, makePackage, seedProject, type TestDb } from "../helpers";

/** Builds a workspace with history: revisions, provenance, a protected record, an applied package and open review items. */
async function buildHistory(t: TestDb) {
  await seedProject(t.db);
  await setProtection(t.db, IDS.project, IDS.world, true);
  await updateRecord(t.db, IDS.project, {
    recordId: IDS.outline,
    expectedRevision: 1,
    body: "1. Mara finds the wet ledger.\n2. The guild denies it.",
  });
  const pkg = makePackage({
    operations: [
      { op: "update_record", recordId: IDS.dossier, expectedRevision: 1, changes: { fields: { set: { age: 34 } } } },
      { op: "set_authority_status", recordId: IDS.decision, expectedRevision: 1, status: "approved" },
    ],
  });
  const applied = await applyChangePackage(t.db, pkg, { projectId: IDS.project });
  expect(applied.status).toBe("applied");
  return pkg;
}

/** Comparable view of a backup: drops the backup timestamp/checksum and the restore audit entries. */
function comparable(b: WorkspaceBackupV1) {
  const { createdAt: _c, checksum: _s, counts: _n, ...rest } = b;
  return { ...rest, auditEntries: rest.auditEntries.filter((a) => a.action !== "workspace.restore") };
}

function resign(b: Omit<WorkspaceBackupV1, "checksum">): WorkspaceBackupV1 {
  return { ...b, checksum: sha256(stableStringify(b)) };
}

describe("full workspace backup and restore", () => {
  let source: TestDb;
  let target: TestDb;
  beforeEach(async () => {
    source = await createTestDb();
    target = await createTestDb();
  });
  afterEach(async () => {
    await source.cleanup();
    await target.cleanup();
  });

  it("round-trips everything into a separate database with identical IDs", async () => {
    const pkg = await buildHistory(source);
    const backup = await createWorkspaceBackup(source.db, IDS.workspace);

    expect(backup.counts.reviewItems).toBeGreaterThan(0);
    expect(backup.reviewItems.some((r) => r.status === "open")).toBe(true);
    expect(backup.changePackages.map((p) => p.packageId)).toEqual([pkg.packageId]);

    // Through JSON text, exactly as it would travel on disk.
    const outcome = await restoreWorkspaceBackup(target.db, JSON.stringify(backup), { idStrategy: "preserve" });
    expect(outcome.ok).toBe(true);

    const again = await createWorkspaceBackup(target.db, IDS.workspace);
    expect(comparable(again)).toEqual(comparable(backup));

    // Record state, protection, canon status and provenance survive.
    const dossier = await getRecord(target.db, IDS.project, IDS.dossier);
    expect(dossier.currentRevision).toBe(2);
    expect(dossier.fields.age).toBe(34);
    expect((await getRecord(target.db, IDS.project, IDS.world)).protected).toBe(true);
    expect((await getRecord(target.db, IDS.project, IDS.chapter)).body).toBe(CHAPTER_PROSE);
    expect((await getRecord(target.db, IDS.project, IDS.decision)).authorityStatus).toBe("approved");
    const rev2 = await target.db.revision.findFirstOrThrow({
      where: { recordId: IDS.dossier, revisionNumber: 2 },
      include: { source: true },
    });
    expect(rev2.source.kind).toBe("change_package");
    expect(rev2.source.packageId).toBe(pkg.packageId);

    // The applied package keeps its identity: reapplying writes nothing.
    const revisionsBefore = await target.db.revision.count();
    const reapply = await applyChangePackage(target.db, pkg, { projectId: IDS.project });
    expect(reapply.status).toBe("already_applied");
    expect(await target.db.revision.count()).toBe(revisionsBefore);

    // A stale update against the restored copy is still rejected.
    const stale = await applyChangePackage(
      target.db,
      makePackage({
        operations: [
          { op: "update_record", recordId: IDS.dossier, expectedRevision: 1, changes: { body: { replace: "Stale" } } },
        ],
      }),
      { projectId: IDS.project },
    );
    expect(stale.status).toBe("rejected");
  });

  it("restores beside the original as an isolated workspace with new IDs", async () => {
    const pkg = await buildHistory(source);
    const backup = await createWorkspaceBackup(source.db, IDS.workspace);

    const preserveIntoSame = await restoreWorkspaceBackup(source.db, backup, { idStrategy: "preserve" });
    expect(preserveIntoSame.ok).toBe(false);
    if (!preserveIntoSame.ok) expect(preserveIntoSame.issues.map((i) => i.code)).toContain("BACKUP_ID_COLLISION");

    const outcome = await restoreWorkspaceBackup(source.db, backup, { idStrategy: "remap" });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.workspaceId).not.toBe(IDS.workspace);
    const newProjectId = outcome.projects[0].id;
    expect(newProjectId).not.toBe(IDS.project);

    // Same content, new identities, relationships rewired.
    const copy = await createWorkspaceBackup(source.db, outcome.workspaceId);
    expect(copy.counts).toEqual({ ...backup.counts, auditEntries: backup.counts.auditEntries + 1 });
    const allRecordIds = new Set(copy.records.map((r) => r.id));
    for (const id of Object.values(IDS)) expect(allRecordIds.has(id)).toBe(false);
    for (const rev of copy.revisions) expect(allRecordIds.has(rev.recordId)).toBe(true);
    for (const item of copy.reviewItems) expect(allRecordIds.has(item.recordId)).toBe(true);
    expect((await validateWorkspaceBackup(source.db, copy, { idStrategy: "remap" })).ok).toBe(true);

    // Package idempotency is scoped per project: the copy knows its package was applied...
    const reapplyToCopy = await applyChangePackage(source.db, pkg, { projectId: newProjectId });
    expect(reapplyToCopy.status).toBe("already_applied");

    // ...and edits in the copy never touch the original.
    const copyDossier = copy.records.find((r) => r.title === "Mara Venn")!;
    await updateRecord(source.db, newProjectId, { recordId: copyDossier.id, expectedRevision: 2, body: "Copy-only edit" });
    expect((await getRecord(source.db, IDS.project, IDS.dossier)).body).not.toBe("Copy-only edit");
  });

  it("rejects corrupted or inconsistent backups before writing anything", async () => {
    await buildHistory(source);
    const backup = await createWorkspaceBackup(source.db, IDS.workspace);
    const { checksum: _ignored, ...body } = backup;

    const tampered = { ...backup, records: backup.records.map((r) => (r.id === IDS.chapter ? { ...r, body: "Edited" } : r)) };
    const checksumFail = await restoreWorkspaceBackup(target.db, tampered, { idStrategy: "preserve" });
    expect(checksumFail.ok).toBe(false);
    if (!checksumFail.ok) expect(checksumFail.issues.map((i) => i.code)).toContain("BACKUP_CHECKSUM_MISMATCH");

    // Re-signed but internally inconsistent: current content no longer matches the latest revision.
    const resigned = resign({ ...body, records: tampered.records });
    const integrityFail = await restoreWorkspaceBackup(target.db, resigned, { idStrategy: "preserve" });
    expect(integrityFail.ok).toBe(false);
    if (!integrityFail.ok) expect(integrityFail.issues.map((i) => i.code)).toContain("BACKUP_INTEGRITY");

    const missingRevision = resign({
      ...body,
      revisions: body.revisions.filter((r) => !(r.recordId === IDS.dossier && r.revisionNumber === 1)),
      counts: { ...body.counts, revisions: body.counts.revisions - 1 },
    });
    expect((await validateWorkspaceBackup(target.db, missingRevision, { idStrategy: "preserve" })).ok).toBe(false);

    const unsupported = await validateWorkspaceBackup(target.db, { ...backup, formatVersion: 2 }, { idStrategy: "preserve" });
    expect(unsupported.issues.map((i) => i.code)).toEqual(["UNSUPPORTED_FORMAT_VERSION"]);

    expect(await target.db.workspace.count()).toBe(0);
    expect(await target.db.record.count()).toBe(0);
  });

  it("a restore that fails mid-write leaves existing work unchanged", async () => {
    await buildHistory(source);
    const backup = await createWorkspaceBackup(source.db, IDS.workspace);
    const before = await createWorkspaceBackup(source.db, IDS.workspace);
    const workspacesBefore = await source.db.workspace.count();

    await expect(
      restoreWorkspaceBackup(source.db, backup, {
        idStrategy: "remap",
        beforeCommit: async () => {
          throw new Error("simulated failure after all rows were written");
        },
      }),
    ).rejects.toThrow("simulated failure");

    expect(await source.db.workspace.count()).toBe(workspacesBefore);
    expect(await source.db.record.count()).toBe(backup.counts.records);
    expect(comparable(await createWorkspaceBackup(source.db, IDS.workspace))).toEqual(comparable(before));
  });
});
