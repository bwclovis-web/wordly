import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyChangePackage, previewChangePackage } from "@/server/services/changePackageService";
import { getRecord, setProtection, updateRecord } from "@/server/services/recordService";
import { CHAPTER_PROSE, createTestDb, IDS, makePackage, seedProject, snapshotState, type TestDb } from "../helpers";

describe("a reference-only package cannot modify protected manuscript prose", () => {
  let t: TestDb;
  beforeEach(async () => {
    t = await createTestDb();
    await seedProject(t.db);
  });
  afterEach(() => t.cleanup());

  it("manuscript chapters are protected by default", async () => {
    const chapter = await getRecord(t.db, IDS.project, IDS.chapter);
    expect(chapter.contentClass).toBe("manuscript");
    expect(chapter.protected).toBe(true);
  });

  it("rejects a reference-scope package that touches chapter prose, even mixed with valid reference edits", async () => {
    const state = await snapshotState(t.db);
    const pkg = makePackage({
      operations: [
        {
          op: "update_record",
          recordId: IDS.dossier,
          expectedRevision: 1,
          changes: { fields: { set: { age: 34 } } },
        },
        {
          op: "update_record",
          recordId: IDS.chapter,
          expectedRevision: 1,
          changes: { body: { replace: CHAPTER_PROSE.replace("three hundred", "four hundred") } },
        },
      ],
    });

    const outcome = await applyChangePackage(t.db, pkg, { projectId: IDS.project }, { confirmProtected: true });
    expect(outcome.status).toBe("rejected");
    if (outcome.status === "rejected") {
      const codes = outcome.issues.filter((i) => i.recordId === IDS.chapter).map((i) => i.code);
      expect(codes).toContain("SCOPE_VIOLATION");
      expect(codes).toContain("PROTECTED_RECORD");
    }

    expect((await getRecord(t.db, IDS.project, IDS.chapter)).body).toBe(CHAPTER_PROSE);
    expect(await snapshotState(t.db)).toEqual(state);
  });

  it("still blocks the chapter when the package claims a protected override but keeps reference scope", async () => {
    const pkg = makePackage({
      protectedOverrides: [IDS.chapter],
      operations: [
        { op: "set_authority_status", recordId: IDS.chapter, expectedRevision: 1, status: "approved" },
      ],
    });
    const outcome = await applyChangePackage(t.db, pkg, { projectId: IDS.project }, { confirmProtected: true });
    expect(outcome.status).toBe("rejected");
    if (outcome.status === "rejected") expect(outcome.issues.map((i) => i.code)).toContain("SCOPE_VIOLATION");
    expect((await getRecord(t.db, IDS.project, IDS.chapter)).currentRevision).toBe(1);
  });

  it("rejects a reference-scope package that would create manuscript content", async () => {
    const pkg = makePackage({
      operations: [
        { op: "create_record", type: "manuscript_chapter", title: "Chapter 2", body: "Prose", authorityStatus: "draft" },
      ],
    });
    const outcome = await applyChangePackage(t.db, pkg, { projectId: IDS.project });
    expect(outcome.status).toBe("rejected");
    expect(await t.db.record.count({ where: { type: "manuscript_chapter" } })).toBe(1);
  });

  it("protects any record flagged protected, independent of its type", async () => {
    await setProtection(t.db, IDS.project, IDS.world, true);
    const pkg = makePackage({
      operations: [
        { op: "update_record", recordId: IDS.world, expectedRevision: 1, changes: { body: { replace: "Changed" } } },
      ],
    });
    const outcome = await applyChangePackage(t.db, pkg, { projectId: IDS.project });
    expect(outcome.status).toBe("rejected");
    if (outcome.status === "rejected") expect(outcome.issues.map((i) => i.code)).toEqual(["PROTECTED_RECORD"]);

    // Explicit override plus author confirmation allows it.
    const authorized = makePackage({ protectedOverrides: [IDS.world], operations: pkg.operations });
    const unconfirmed = await applyChangePackage(t.db, authorized, { projectId: IDS.project });
    expect(unconfirmed.status).toBe("rejected");
    if (unconfirmed.status === "rejected") {
      expect(unconfirmed.issues.map((i) => i.code)).toContain("PROTECTED_CONFIRMATION_REQUIRED");
    }
    const confirmed = await applyChangePackage(t.db, authorized, { projectId: IDS.project }, { confirmProtected: true });
    expect(confirmed.status).toBe("applied");
    expect((await getRecord(t.db, IDS.project, IDS.world)).body).toBe("Changed");
  });

  it("an explicit manuscript-scope package with an override and confirmation can edit prose", async () => {
    const pkg = makePackage({
      scope: "manuscript",
      protectedOverrides: [IDS.chapter],
      operations: [
        { op: "update_record", recordId: IDS.chapter, expectedRevision: 1, changes: { body: { replace: "Revised prose." } } },
      ],
    });
    const preview = await previewChangePackage(t.db, pkg, { projectId: IDS.project });
    expect(preview.canApply).toBe(true);
    expect(preview.requiresProtectedConfirmation).toBe(true);
    const outcome = await applyChangePackage(t.db, pkg, { projectId: IDS.project }, { confirmProtected: true });
    expect(outcome.status).toBe("applied");
  });

  it("the UI requires an explicit unlock to edit protected prose", async () => {
    await expect(
      updateRecord(t.db, IDS.project, { recordId: IDS.chapter, expectedRevision: 1, body: "UI edit" }),
    ).rejects.toMatchObject({ name: "MutationRejectedError" });
    await updateRecord(t.db, IDS.project, {
      recordId: IDS.chapter,
      expectedRevision: 1,
      body: "UI edit",
      unlockProtected: true,
    });
    expect((await getRecord(t.db, IDS.project, IDS.chapter)).body).toBe("UI edit");
  });

  it("flags records that mention a changed character without modifying them", async () => {
    const state = await snapshotState(t.db);
    const pkg = makePackage();
    const preview = await previewChangePackage(t.db, pkg, { projectId: IDS.project });
    const mentioned = preview.potentialEffects.map((e) => e.recordId).sort();
    expect(mentioned).toEqual([IDS.chapter, IDS.decision, IDS.outline, IDS.world].sort());
    expect(preview.operations.map((o) => o.recordId)).toEqual([IDS.dossier]);

    const outcome = await applyChangePackage(t.db, pkg, { projectId: IDS.project });
    expect(outcome.status).toBe("applied");
    if (outcome.status === "applied") {
      expect(outcome.result.changes.map((c) => c.recordId)).toEqual([IDS.dossier]);
      expect(outcome.result.reviewItems.filter((r) => r.origin === "detected_mention")).toHaveLength(4);
    }
    const after = await snapshotState(t.db);
    const untouched = (s: typeof state) => s.records.filter((r) => r.id !== IDS.dossier);
    expect(untouched(after)).toEqual(untouched(state));
  });
});
