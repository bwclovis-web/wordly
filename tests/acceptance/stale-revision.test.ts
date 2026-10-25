import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyChangePackage, previewChangePackage } from "@/server/services/changePackageService";
import { getRecord, updateRecord } from "@/server/services/recordService";
import { createTestDb, IDS, makePackage, seedProject, snapshotState, type TestDb } from "../helpers";

describe("stale packages cannot overwrite newer work", () => {
  let t: TestDb;
  beforeEach(async () => {
    t = await createTestDb();
    await seedProject(t.db);
  });
  afterEach(() => t.cleanup());

  it("rejects a package whose expectedRevision is behind the current revision", async () => {
    // The author edits the dossier in the app after exporting context at revision 1.
    await updateRecord(t.db, IDS.project, {
      recordId: IDS.dossier,
      expectedRevision: 1,
      body: "Archivist. Thirty years old. Newer author edit.",
    });
    const state = await snapshotState(t.db);

    const pkg = makePackage();
    const preview = await previewChangePackage(t.db, pkg, { projectId: IDS.project });
    expect(preview.canApply).toBe(false);
    expect(preview.issues).toContainEqual(
      expect.objectContaining({ code: "STALE_REVISION", recordId: IDS.dossier, operationIndex: 0 }),
    );

    const outcome = await applyChangePackage(t.db, pkg, { projectId: IDS.project });
    expect(outcome.status).toBe("rejected");
    if (outcome.status === "rejected") {
      expect(outcome.issues.map((i) => i.code)).toContain("STALE_REVISION");
    }

    const record = await getRecord(t.db, IDS.project, IDS.dossier);
    expect(record.currentRevision).toBe(2);
    expect(record.body).toBe("Archivist. Thirty years old. Newer author edit.");
    expect(await snapshotState(t.db)).toEqual(state);
  });

  it("two packages prepared from the same revision: only the first wins", async () => {
    const a = makePackage({ summary: "A" });
    const b = makePackage({
      summary: "B",
      operations: [
        { op: "update_record", recordId: IDS.dossier, expectedRevision: 1, changes: { body: { replace: "B wins?" } } },
      ],
    });
    const results = await Promise.all([
      applyChangePackage(t.db, a, { projectId: IDS.project }),
      applyChangePackage(t.db, b, { projectId: IDS.project }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual(["applied", "rejected"]);
    const rejected = results.find((r) => r.status === "rejected");
    if (rejected?.status === "rejected") expect(rejected.issues.map((i) => i.code)).toContain("STALE_REVISION");
    const record = await getRecord(t.db, IDS.project, IDS.dossier);
    expect(record.currentRevision).toBe(2);
    expect(await t.db.revision.count({ where: { recordId: IDS.dossier } })).toBe(2);
  });

  it("the UI is held to the same revision check", async () => {
    await applyChangePackage(t.db, makePackage(), { projectId: IDS.project });
    await expect(
      updateRecord(t.db, IDS.project, { recordId: IDS.dossier, expectedRevision: 1, body: "Old tab edit" }),
    ).rejects.toMatchObject({ name: "MutationRejectedError" });
    expect((await getRecord(t.db, IDS.project, IDS.dossier)).body).toBe("Archivist. Thirty-four years old.");
  });
});
