import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseChangePackage } from "@/changePackage/parse";
import { applyChangePackage } from "@/server/services/changePackageService";
import { exportContextBundle } from "@/server/services/contextExportService";
import { createTestDb, IDS, seedProject, type TestDb } from "../helpers";

describe("exported context includes the IDs and revisions needed for subsequent changes", () => {
  let t: TestDb;
  beforeEach(async () => {
    t = await createTestDb();
    await seedProject(t.db);
  });
  afterEach(() => t.cleanup());

  it("bundle carries ids, revisions, types, statuses and protection for selected records", async () => {
    const bundle = await exportContextBundle(t.db, IDS.project, { recordIds: [IDS.dossier, IDS.chapter] });
    expect(bundle.format).toBe("wordly.context-bundle");
    expect(bundle.workspaceId).toBe(IDS.workspace);
    expect(bundle.projectId).toBe(IDS.project);
    expect(bundle.records).toHaveLength(2);

    const dossier = bundle.records.find((r) => r.id === IDS.dossier)!;
    expect(dossier).toMatchObject({
      type: "character_dossier",
      contentClass: "reference",
      revision: 1,
      authorityStatus: "approved",
      protected: false,
    });
    const chapter = bundle.records.find((r) => r.id === IDS.chapter)!;
    expect(chapter).toMatchObject({ type: "manuscript_chapter", contentClass: "manuscript", protected: true });

    expect(bundle.changePackageSchema).toHaveProperty("properties.operations");
    expect(bundle.changePackageTemplate).toMatchObject({ workspaceId: IDS.workspace, projectId: IDS.project });
    expect(bundle.changePackageInstructions.join(" ")).toContain("expectedRevision");
  });

  it("filters by type", async () => {
    const bundle = await exportContextBundle(t.db, IDS.project, { types: ["character_dossier", "worldbuilding"] });
    expect(bundle.records.map((r) => r.id).sort()).toEqual([IDS.dossier, IDS.world].sort());
  });

  it("a package built only from the bundle applies cleanly, and a re-export reflects the new revision", async () => {
    const bundle = JSON.parse(JSON.stringify(await exportContextBundle(t.db, IDS.project)));
    const dossier = bundle.records.find((r: { type: string }) => r.type === "character_dossier");

    const pkg = {
      ...bundle.changePackageTemplate,
      packageId: "pkg_roundtrip_0001",
      summary: "Mara is 34",
      source: { conversationLabel: "Roundtrip test" },
      approval: { status: "approved", statement: "Yes, apply it." },
      operations: [
        {
          op: "update_record",
          recordId: dossier.id,
          expectedRevision: dossier.revision,
          changes: { fields: { set: { age: 34 } } },
          authorityStatus: "approved",
        },
      ],
    };
    expect(parseChangePackage(pkg).ok).toBe(true);
    const outcome = await applyChangePackage(t.db, pkg, { projectId: bundle.projectId });
    expect(outcome.status).toBe("applied");

    const next = await exportContextBundle(t.db, IDS.project, { recordIds: [dossier.id] });
    expect(next.records[0].revision).toBe(dossier.revision + 1);
    expect(next.records[0].fields.age).toBe(34);
  });
});
