import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createWorkspaceBackup, restoreWorkspaceBackup } from "@/server/services/backupService";
import { applyChangePackage, previewChangePackage } from "@/server/services/changePackageService";
import { exportContextBundle } from "@/server/services/contextExportService";
import { applyMarkdownImport } from "@/server/services/markdownImportService";
import { createProject, createWorkspace } from "@/server/services/projectService";
import { createRecord, getRecord, listRevisions } from "@/server/services/recordService";
import { createTestDb, snapshotState, type TestDb } from "../helpers";

/*
 * The full author workflow with invented content: import reference files,
 * export context for a conversation, bring back a change package built only
 * from that export, then back up and restore the result.
 */

const FIXTURES = path.resolve(__dirname, "..", "fixtures", "markdown");
const read = (filename: string) => readFileSync(path.join(FIXTURES, filename), "utf8");
const PROSE = "Fog rolled over the Glass Coast. Ines Corrow counted the lamps twice and found one dark.";

interface BundleRecord {
  id: string;
  title: string;
  type: string;
  revision: number;
  protected: boolean;
}

describe("ChatGPT round trip with imported references", () => {
  let t: TestDb;
  let other: TestDb;
  let projectId: string;
  let chapterId: string;

  beforeEach(async () => {
    t = await createTestDb();
    other = await createTestDb();
    await createWorkspace(t.db, { id: "wsp_trial", name: "Trial workspace" });
    projectId = "prj_trial_glass_coast";
    await createProject(t.db, { id: projectId, workspaceId: "wsp_trial", title: "The Glass Coast" });
    const chapter = await createRecord(t.db, projectId, {
      type: "manuscript_chapter",
      title: "Chapter 1",
      body: PROSE,
      authorityStatus: "draft",
    });
    chapterId = chapter.outcomes[0].recordId;
  });
  afterEach(async () => {
    await t.cleanup();
    await other.cleanup();
  });

  it("imports, exports, applies once, rejects stale and manuscript edits, and survives backup/restore", async () => {
    // 1. Import invented reference files with explicit choices.
    const imported = await applyMarkdownImport(t.db, {
      projectId,
      conversationLabel: "Initial reference import",
      items: [
        { filename: "lantern-keepers.md", content: read("lantern-keepers.md"), title: "The Lantern Keepers", type: "worldbuilding", authorityStatus: "proposed", protected: false },
        { filename: "ines-corrow.md", content: read("ines-corrow.md"), title: "Ines Corrow", type: "character_dossier", authorityStatus: "approved", protected: false },
      ],
    });
    expect(imported.status).toBe("applied");

    // 2. Export context; everything after this uses only the exported JSON text.
    const exportText = JSON.stringify(await exportContextBundle(t.db, projectId));
    const bundle = JSON.parse(exportText) as {
      projectId: string;
      records: BundleRecord[];
      changePackageTemplate: Record<string, unknown>;
    };
    const ines = bundle.records.find((r) => r.title === "Ines Corrow")!;
    const keepers = bundle.records.find((r) => r.title === "The Lantern Keepers")!;
    const chapter = bundle.records.find((r) => r.type === "manuscript_chapter")!;
    expect(chapter).toMatchObject({ id: chapterId, protected: true });

    // 3. A package as ChatGPT would produce it from the export.
    const pkg = {
      ...bundle.changePackageTemplate,
      packageId: "pkg_trial_ines_age_0001",
      summary: "Ines is 43; Lantern Keepers approved; continuity note added",
      source: { conversationLabel: "Glass Coast planning chat" },
      approval: { status: "approved", statement: "Approved by the author in conversation." },
      operations: [
        {
          op: "update_record",
          recordId: ines.id,
          expectedRevision: ines.revision,
          changes: { body: { replace: read("ines-corrow.md").replace("**Age:** 41.", "**Age:** 43.") } },
        },
        { op: "set_authority_status", recordId: keepers.id, expectedRevision: keepers.revision, status: "approved" },
        {
          op: "create_record",
          type: "continuity_note",
          title: "Ines's age",
          body: "Ines is 43 in chapter 1; she is two years older than Mara's brother.",
          authorityStatus: "approved",
        },
      ],
    };

    // 4. Preview, then apply.
    const before = await snapshotState(t.db);
    const preview = await previewChangePackage(t.db, pkg, { projectId: bundle.projectId });
    expect(preview.canApply).toBe(true);
    expect(preview.operations.find((o) => o.recordId === ines.id)?.bodyChanged).toBe(true);
    expect(await snapshotState(t.db)).toEqual(before);
    const applied = await applyChangePackage(t.db, pkg, { projectId: bundle.projectId });
    expect(applied.status).toBe("applied");

    // 5. Revisions and provenance: rev 1 from the import file, rev 2 from the package.
    const revisions = await listRevisions(t.db, ines.id);
    expect(revisions.map((r) => [r.revisionNumber, r.source.kind])).toEqual([
      [2, "change_package"],
      [1, "markdown_import"],
    ]);
    expect(revisions[0].source.packageId).toBe(pkg.packageId);
    expect(revisions[0].source.conversationLabel).toBe("Glass Coast planning chat");
    expect(revisions[1].source.originalFilename).toBe("ines-corrow.md");
    expect(revisions[1].body).toBe(read("ines-corrow.md"));
    expect((await getRecord(t.db, projectId, keepers.id)).authorityStatus).toBe("approved");

    // 6. Re-applying writes nothing.
    const afterApply = await snapshotState(t.db);
    expect((await applyChangePackage(t.db, pkg, { projectId })).status).toBe("already_applied");
    expect(await snapshotState(t.db)).toEqual(afterApply);

    // 7. A second package built from the same (now stale) export is rejected whole.
    const stale = await applyChangePackage(
      t.db,
      {
        ...pkg,
        packageId: "pkg_trial_ines_age_0002",
        summary: "Ines is 45",
        operations: [
          { op: "update_record", recordId: ines.id, expectedRevision: ines.revision, changes: { body: { replace: "Ines is 45." } } },
        ],
      },
      { projectId },
    );
    expect(stale.status).toBe("rejected");
    if (stale.status === "rejected") expect(stale.issues.map((i) => i.code)).toContain("STALE_REVISION");

    // 8. Protected manuscript prose was never touched, and a reference package cannot touch it.
    const prose = await applyChangePackage(
      t.db,
      {
        ...pkg,
        packageId: "pkg_trial_prose_0001",
        summary: "Update chapter to age 43",
        operations: [
          { op: "update_record", recordId: chapter.id, expectedRevision: chapter.revision, changes: { body: { replace: PROSE + " She was 43." } } },
        ],
      },
      { projectId },
      { confirmProtected: true },
    );
    expect(prose.status).toBe("rejected");
    expect(await snapshotState(t.db)).toEqual(afterApply);
    const savedChapter = await getRecord(t.db, projectId, chapterId);
    expect([savedChapter.body, savedChapter.currentRevision, savedChapter.protected]).toEqual([PROSE, 1, true]);
    const flagged = await t.db.reviewItem.findMany({ where: { recordId: chapterId, status: "open" } });
    expect(flagged.length).toBeGreaterThan(0);

    // 9. Back up, restore into a separate database, and verify the result there.
    const backup = await createWorkspaceBackup(t.db, "wsp_trial");
    const restored = await restoreWorkspaceBackup(other.db, JSON.stringify(backup), { idStrategy: "preserve" });
    expect(restored.ok).toBe(true);
    const restoredInes = await getRecord(other.db, projectId, ines.id);
    expect(restoredInes.body).toContain("**Age:** 43.");
    expect((await listRevisions(other.db, ines.id)).map((r) => r.source.kind)).toEqual(["change_package", "markdown_import"]);
    expect((await getRecord(other.db, projectId, chapterId)).body).toBe(PROSE);
    expect(await other.db.importedFile.count()).toBe(2);
    expect(await other.db.reviewItem.count({ where: { status: "open" } })).toBe(
      await t.db.reviewItem.count({ where: { status: "open" } }),
    );
    expect((await applyChangePackage(other.db, pkg, { projectId })).status).toBe("already_applied");
  });
});
