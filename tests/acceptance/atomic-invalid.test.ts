import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyChangePackage, previewChangePackage } from "@/server/services/changePackageService";
import { createTestDb, IDS, makePackage, seedProject, snapshotState, type TestDb } from "../helpers";

const validOp = {
  op: "update_record" as const,
  recordId: IDS.dossier,
  expectedRevision: 1,
  changes: { fields: { set: { age: 34 } } },
};

describe("invalid packages cause no partial updates", () => {
  let t: TestDb;
  beforeEach(async () => {
    t = await createTestDb();
    await seedProject(t.db);
  });
  afterEach(() => t.cleanup());

  async function expectRejectedWithoutChanges(pkg: unknown, expectedCode: string) {
    const state = await snapshotState(t.db);
    const outcome = await applyChangePackage(t.db, pkg, { projectId: IDS.project });
    expect(outcome.status).toBe("rejected");
    if (outcome.status === "rejected") expect(outcome.issues.map((i) => i.code)).toContain(expectedCode);
    expect(await snapshotState(t.db)).toEqual(state);
  }

  it("unknown record ID alongside a valid op", async () => {
    await expectRejectedWithoutChanges(
      makePackage({
        operations: [
          validOp,
          { op: "update_record", recordId: "rec_does_not_exist", expectedRevision: 1, changes: { body: { replace: "x" } } },
        ],
      }),
      "RECORD_NOT_FOUND",
    );
  });

  it("stale revision alongside a valid op", async () => {
    await expectRejectedWithoutChanges(
      makePackage({
        operations: [
          validOp,
          { op: "update_record", recordId: IDS.world, expectedRevision: 7, changes: { body: { replace: "x" } } },
        ],
      }),
      "STALE_REVISION",
    );
  });

  it("unsupported operation alongside a valid op", async () => {
    const pkg = makePackage({ operations: [validOp] });
    await expectRejectedWithoutChanges(
      { ...pkg, operations: [validOp, { op: "delete_record", recordId: IDS.world }] },
      "UNSUPPORTED_OPERATION",
    );
  });

  it("proposed (unapproved) package can be previewed but not applied", async () => {
    const pkg = makePackage({ approval: { status: "proposed" } });
    const preview = await previewChangePackage(t.db, pkg, { projectId: IDS.project });
    expect(preview.canApply).toBe(false);
    expect(preview.operations).toHaveLength(1);
    expect(preview.issues.map((i) => i.code)).toContain("NOT_APPROVED");
    await expectRejectedWithoutChanges(pkg, "NOT_APPROVED");
  });

  it("missing approval is rejected; approval is never inferred", async () => {
    const pkg = makePackage();
    const { approval: _omit, ...withoutApproval } = pkg;
    await expectRejectedWithoutChanges(withoutApproval, "APPROVAL_MISSING");
  });

  it("package for another project is rejected", async () => {
    await expectRejectedWithoutChanges(makePackage({ projectId: "prj_other" }), "TARGET_MISMATCH");
  });

  it("malformed JSON is rejected", async () => {
    await expectRejectedWithoutChanges("{ not json", "INVALID_JSON");
  });

  it("collects every issue instead of stopping at the first", async () => {
    const pkg = makePackage();
    const preview = await previewChangePackage(
      t.db,
      {
        ...pkg,
        operations: [
          { op: "delete_record", recordId: IDS.world },
          { op: "update_record", recordId: IDS.dossier, expectedRevision: "one", changes: {} },
          { op: "rename_everything" },
        ],
      },
      { projectId: IDS.project },
    );
    const codes = preview.issues.map((i) => `${i.code}@${i.operationIndex}`);
    expect(codes).toContain("UNSUPPORTED_OPERATION@0");
    expect(codes).toContain("SCHEMA_INVALID@1");
    expect(codes).toContain("UNSUPPORTED_OPERATION@2");
  });

  it("rolls back everything when a failure occurs mid-transaction", async () => {
    const state = await snapshotState(t.db);
    const pkg = makePackage({
      operations: [
        validOp,
        { op: "create_record", type: "continuity_note", title: "Note", body: "Mara", authorityStatus: "approved" },
      ],
      relatedRecords: [{ recordId: IDS.outline, note: "Check age" }],
    });
    await expect(
      applyChangePackage(t.db, pkg, { projectId: IDS.project }, {
        beforeCommit: async () => {
          throw new Error("simulated crash before commit");
        },
      }),
    ).rejects.toThrow("simulated crash before commit");
    expect(await snapshotState(t.db)).toEqual(state);
    expect(await t.db.auditEntry.count({ where: { packageId: pkg.packageId } })).toBe(0);

    // The same package applies cleanly afterwards.
    expect((await applyChangePackage(t.db, pkg, { projectId: IDS.project })).status).toBe("applied");
  });
});
