import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyChangePackage } from "@/server/services/changePackageService";
import { getRecord, getRevision, listRevisions } from "@/server/services/recordService";
import { createTestDb, IDS, makePackage, seedProject, type TestDb } from "../helpers";

describe("approved reference updates preserve earlier revisions", () => {
  let t: TestDb;
  beforeEach(async () => {
    t = await createTestDb();
    await seedProject(t.db);
  });
  afterEach(() => t.cleanup());

  it("creates revision N+1 and leaves revision N intact, with provenance", async () => {
    const before = await getRevision(t.db, IDS.dossier, 1);
    expect(before).not.toBeNull();

    const pkg = makePackage({
      source: { conversationLabel: "Worldbuilding session 12", url: "https://chatgpt.com/c/abc" },
    });
    const outcome = await applyChangePackage(t.db, JSON.stringify(pkg), { projectId: IDS.project });
    expect(outcome.status).toBe("applied");
    if (outcome.status !== "applied") return;

    expect(outcome.result.changes).toEqual([
      expect.objectContaining({ recordId: IDS.dossier, previousRevision: 1, newRevision: 2, op: "update_record" }),
    ]);

    const record = await getRecord(t.db, IDS.project, IDS.dossier);
    expect(record.currentRevision).toBe(2);
    expect(record.body).toBe("Archivist. Thirty-four years old.");
    expect(record.fields).toEqual({ name: "Mara Venn", aliases: ["Mara"], age: 34 });

    const rev1 = await getRevision(t.db, IDS.dossier, 1);
    expect(rev1).toEqual(before);
    expect(rev1!.body).toBe("Archivist. Thirty years old.");
    expect(rev1!.fields.age).toBe(30);

    const revisions = await listRevisions(t.db, IDS.dossier);
    expect(revisions.map((r) => r.revisionNumber)).toEqual([2, 1]);
    expect(revisions[0].source).toMatchObject({
      kind: "change_package",
      packageId: pkg.packageId,
      conversationLabel: "Worldbuilding session 12",
      url: "https://chatgpt.com/c/abc",
    });
    expect(revisions[1].source.kind).toBe("ui");

    const audit = await t.db.auditEntry.findMany({ where: { packageId: pkg.packageId } });
    expect(audit).toHaveLength(1);
    expect(audit[0].action).toBe("package.apply");
  });

  it("does not infer approval: decisions keep the status the package states", async () => {
    const pkg = makePackage({
      operations: [
        {
          op: "create_record",
          newRecordId: "rec_test_decision_new",
          type: "canon_decision",
          title: "Guild founding date",
          body: "Founded 300 years ago?",
          authorityStatus: "proposed",
        },
      ],
    });
    const outcome = await applyChangePackage(t.db, pkg, { projectId: IDS.project });
    expect(outcome.status).toBe("applied");
    const created = await getRecord(t.db, IDS.project, "rec_test_decision_new");
    expect(created.authorityStatus).toBe("proposed");
    expect(created.protected).toBe(false);
  });

  it("supersedes a decision while keeping the superseded record and its history", async () => {
    const pkg = makePackage({
      operations: [
        {
          op: "create_record",
          newRecordId: "rec_test_decision_age_v2",
          type: "canon_decision",
          title: "Mara is 34",
          body: "Mara is 34.",
          authorityStatus: "approved",
        },
        {
          op: "set_authority_status",
          recordId: IDS.decision,
          expectedRevision: 1,
          status: "superseded",
          supersededBy: "rec_test_decision_age_v2",
        },
      ],
    });
    const outcome = await applyChangePackage(t.db, pkg, { projectId: IDS.project });
    expect(outcome.status).toBe("applied");
    const old = await getRecord(t.db, IDS.project, IDS.decision);
    expect(old.authorityStatus).toBe("superseded");
    expect(old.supersededByRecordId).toBe("rec_test_decision_age_v2");
    expect((await getRevision(t.db, IDS.decision, 1))!.authorityStatus).toBe("unresolved");
  });
});
