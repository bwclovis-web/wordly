import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyChangePackage, previewChangePackage } from "@/server/services/changePackageService";
import { getRecord } from "@/server/services/recordService";
import { createTestDb, IDS, makePackage, seedProject, type TestDb } from "../helpers";

describe("applying the same package twice does not duplicate changes", () => {
  let t: TestDb;
  beforeEach(async () => {
    t = await createTestDb();
    await seedProject(t.db);
  });
  afterEach(() => t.cleanup());

  it("returns already_applied with the original result and writes nothing the second time", async () => {
    const pkg = makePackage({
      operations: [
        {
          op: "update_record",
          recordId: IDS.dossier,
          expectedRevision: 1,
          changes: { fields: { set: { age: 34 } } },
        },
        {
          op: "create_record",
          type: "continuity_note",
          title: "Age continuity",
          body: "Mara's age changed to 34.",
          authorityStatus: "approved",
        },
      ],
    });
    const raw = JSON.stringify(pkg);

    const first = await applyChangePackage(t.db, raw, { projectId: IDS.project });
    expect(first.status).toBe("applied");
    const counts = {
      revisions: await t.db.revision.count(),
      records: await t.db.record.count(),
      packages: await t.db.changePackage.count(),
      audit: await t.db.auditEntry.count(),
      reviewItems: await t.db.reviewItem.count(),
    };

    // Same content with different formatting is the same package.
    const second = await applyChangePackage(t.db, JSON.stringify(pkg, null, 2), { projectId: IDS.project });
    expect(second.status).toBe("already_applied");
    if (first.status === "applied" && second.status === "already_applied") {
      expect(second.result).toEqual(first.result);
    }

    expect({
      revisions: await t.db.revision.count(),
      records: await t.db.record.count(),
      packages: await t.db.changePackage.count(),
      audit: await t.db.auditEntry.count(),
      reviewItems: await t.db.reviewItem.count(),
    }).toEqual(counts);
    expect((await getRecord(t.db, IDS.project, IDS.dossier)).currentRevision).toBe(2);

    const preview = await previewChangePackage(t.db, raw, { projectId: IDS.project });
    expect(preview.status).toBe("already_applied");
    expect(preview.canApply).toBe(false);
  });

  it("rejects reuse of a packageId with different content", async () => {
    const pkg = makePackage();
    expect((await applyChangePackage(t.db, pkg, { projectId: IDS.project })).status).toBe("applied");

    const altered = { ...pkg, summary: "Something else entirely" };
    const outcome = await applyChangePackage(t.db, altered, { projectId: IDS.project });
    expect(outcome.status).toBe("rejected");
    if (outcome.status === "rejected") {
      expect(outcome.issues.map((i) => i.code)).toContain("PACKAGE_ID_CONFLICT");
    }
    expect(await t.db.changePackage.count()).toBe(1);
  });

  it("handles concurrent duplicate applies with a single application", async () => {
    const raw = JSON.stringify(makePackage());
    const results = await Promise.all([
      applyChangePackage(t.db, raw, { projectId: IDS.project }),
      applyChangePackage(t.db, raw, { projectId: IDS.project }),
    ]);
    expect(results.filter((r) => r.status === "applied")).toHaveLength(1);
    expect(await t.db.changePackage.count()).toBe(1);
    expect((await getRecord(t.db, IDS.project, IDS.dossier)).currentRevision).toBe(2);
  });
});
