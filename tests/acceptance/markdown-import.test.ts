import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  applyMarkdownImport,
  previewMarkdownImport,
  type MarkdownImportItem,
} from "@/server/services/markdownImportService";
import { getRecord, listRevisions, setProtection } from "@/server/services/recordService";
import { CHAPTER_PROSE, createTestDb, IDS, seedProject, snapshotState, type TestDb } from "../helpers";

const FIXTURES = path.resolve(__dirname, "..", "fixtures", "markdown");
const fixture = (filename: string) => ({ filename, content: readFileSync(path.join(FIXTURES, filename), "utf8") });

function item(filename: string, overrides: Partial<MarkdownImportItem> = {}): MarkdownImportItem {
  const f = fixture(filename);
  return {
    ...f,
    title: f.content.match(/^# (.+)$/m)![1],
    type: "worldbuilding",
    authorityStatus: "draft",
    protected: false,
    ...overrides,
  };
}

describe("Markdown reference import", () => {
  let t: TestDb;
  beforeEach(async () => {
    t = await createTestDb();
    await seedProject(t.db);
  });
  afterEach(() => t.cleanup());

  it("previews without writing and suggests titles without choosing type or status", async () => {
    const before = await snapshotState(t.db);
    const preview = await previewMarkdownImport(t.db, IDS.project, [fixture("lantern-keepers.md"), fixture("ines-corrow.md")]);
    expect(preview.files.map((f) => f.suggestedTitle)).toEqual(["The Lantern Keepers", "Ines Corrow"]);
    expect(preview.files.every((f) => f.issues.length === 0 && !f.needsDecision)).toBe(true);
    expect(preview.importableTypes).not.toContain("manuscript_chapter");
    expect(preview.files[0]).not.toHaveProperty("type");
    expect(preview.files[0]).not.toHaveProperty("authorityStatus");
    expect(await snapshotState(t.db)).toEqual(before);
  });

  it("imports a batch with explicit choices, preserving the original file and provenance", async () => {
    const crlf = { filename: "harbor-notes.md", content: "\uFEFF# Harbor notes\r\n\r\nThe pier has 14 bollards.\r\n" };
    const outcome = await applyMarkdownImport(t.db, {
      projectId: IDS.project,
      conversationLabel: "Reference trial",
      items: [
        item("lantern-keepers.md", { type: "worldbuilding", authorityStatus: "approved", protected: true }),
        item("ines-corrow.md", { type: "character_dossier", authorityStatus: "proposed" }),
        { ...crlf, title: "Harbor notes", type: "continuity_note", authorityStatus: "draft", protected: false },
      ],
    });
    expect(outcome.status).toBe("applied");
    if (outcome.status !== "applied") return;
    expect(outcome.results.map((r) => r.action)).toEqual(["created", "created", "created"]);

    const [keepers, ines, harbor] = await Promise.all(outcome.results.map((r) => getRecord(t.db, IDS.project, r.recordId!)));
    expect([keepers.type, keepers.authorityStatus, keepers.protected]).toEqual(["worldbuilding", "approved", true]);
    expect([ines.type, ines.authorityStatus, ines.protected]).toEqual(["character_dossier", "proposed", false]);
    expect(keepers.body).toBe(fixture("lantern-keepers.md").content);
    expect(harbor.body).toBe(crlf.content.slice(1));

    const files = await t.db.importedFile.findMany({ orderBy: { originalFilename: "asc" } });
    expect(files.map((f) => f.originalFilename)).toEqual(["harbor-notes.md", "ines-corrow.md", "lantern-keepers.md"]);
    const harborFile = files[0];
    expect(harborFile.content).toBe(crlf.content);
    expect(harborFile.batchId).toBe(outcome.batchId);
    const source = await t.db.source.findUniqueOrThrow({ where: { id: harborFile.sourceId } });
    expect(source.kind).toBe("markdown_import");
    expect(source.originalFilename).toBe("harbor-notes.md");
    expect(source.conversationLabel).toBe("Reference trial");

    const [rev] = await listRevisions(t.db, keepers.id);
    expect(rev.revisionNumber).toBe(1);
    expect(rev.source.kind).toBe("markdown_import");
    expect(await t.db.auditEntry.count({ where: { action: "markdown.import.batch" } })).toBe(1);
  });

  it("never infers canon status, type or protection; a filename claiming approval changes nothing", async () => {
    const before = await snapshotState(t.db);
    const missing = await applyMarkdownImport(t.db, {
      projectId: IDS.project,
      items: [
        item("lantern-keepers.md"),
        { ...item("FINAL-APPROVED-canon-rules.md"), authorityStatus: "", type: "", protected: undefined as unknown as boolean },
      ],
    });
    expect(missing.status).toBe("rejected");
    if (missing.status === "rejected") {
      const paths = missing.issues.map((i) => i.path);
      expect(paths).toEqual(expect.arrayContaining(["items.1.type", "items.1.authorityStatus", "items.1.protected"]));
    }
    expect(await snapshotState(t.db)).toEqual(before);

    const explicit = await applyMarkdownImport(t.db, {
      projectId: IDS.project,
      items: [item("FINAL-APPROVED-canon-rules.md", { type: "reference_note", authorityStatus: "proposed" })],
    });
    expect(explicit.status).toBe("applied");
    if (explicit.status === "applied") {
      expect((await getRecord(t.db, IDS.project, explicit.results[0].recordId!)).authorityStatus).toBe("proposed");
    }
  });

  it("refuses to turn reference documents into manuscript chapters", async () => {
    const before = await snapshotState(t.db);
    const asChapter = await applyMarkdownImport(t.db, {
      projectId: IDS.project,
      items: [item("lantern-keepers.md", { type: "manuscript_chapter" })],
    });
    expect(asChapter.status).toBe("rejected");
    if (asChapter.status === "rejected") expect(asChapter.issues.map((i) => i.code)).toContain("SCOPE_VIOLATION");

    const overChapter = await applyMarkdownImport(t.db, {
      projectId: IDS.project,
      confirmProtectedReplacements: true,
      items: [item("lantern-keepers.md", { decision: { action: "replace", recordId: IDS.chapter, expectedRevision: 1 } })],
    });
    expect(overChapter.status).toBe("rejected");
    expect((await getRecord(t.db, IDS.project, IDS.chapter)).body).toBe(CHAPTER_PROSE);
    expect(await snapshotState(t.db)).toEqual(before);
  });

  it("detects duplicates and requires an explicit create, replace or skip decision", async () => {
    const first = await applyMarkdownImport(t.db, { projectId: IDS.project, items: [item("lantern-keepers.md")] });
    expect(first.status).toBe("applied");
    const recordId = first.status === "applied" ? first.results[0].recordId! : "";

    const edited = { filename: "lantern-keepers.md", content: fixture("lantern-keepers.md").content + "- New: keepers wear grey.\n" };
    const preview = await previewMarkdownImport(t.db, IDS.project, [fixture("lantern-keepers.md"), edited, fixture("ines-corrow.md")]);
    expect(preview.files[0].duplicates[0]).toMatchObject({ recordId, reasons: ["same_content", "same_title", "same_filename"] });
    expect(preview.files[1].duplicates[0].reasons).toEqual(["same_title", "same_filename"]);
    expect(preview.files[0].batchDuplicates.map((d) => d.index)).toEqual([1]);
    expect(preview.files[2].needsDecision).toBe(false);

    // No decision: rejected, nothing written.
    const before = await snapshotState(t.db);
    const undecided = await applyMarkdownImport(t.db, { projectId: IDS.project, items: [{ ...item("lantern-keepers.md"), ...edited }] });
    expect(undecided.status).toBe("rejected");
    if (undecided.status === "rejected") expect(undecided.issues.map((i) => i.code)).toContain("IMPORT_DECISION_REQUIRED");

    // Replacing with identical content is pointless; the author is told to skip.
    const identical = await applyMarkdownImport(t.db, {
      projectId: IDS.project,
      items: [item("lantern-keepers.md", { decision: { action: "replace", recordId, expectedRevision: 1 } })],
    });
    expect(identical.status).toBe("rejected");
    if (identical.status === "rejected") expect(identical.issues.map((i) => i.code)).toContain("NO_EFFECTIVE_CHANGE");

    // Stale replacement.
    const stale = await applyMarkdownImport(t.db, {
      projectId: IDS.project,
      items: [{ ...item("lantern-keepers.md"), ...edited, decision: { action: "replace", recordId, expectedRevision: 7 } }],
    });
    expect(stale.status).toBe("rejected");
    if (stale.status === "rejected") expect(stale.issues.map((i) => i.code)).toContain("STALE_REVISION");
    expect(await snapshotState(t.db)).toEqual(before);

    // Explicit replace + skip + create in one batch.
    const decided = await applyMarkdownImport(t.db, {
      projectId: IDS.project,
      items: [
        { ...item("lantern-keepers.md"), decision: { action: "skip" } },
        { ...item("lantern-keepers.md"), ...edited, decision: { action: "replace", recordId, expectedRevision: 1 } },
        item("ines-corrow.md", { type: "character_dossier" }),
      ],
    });
    expect(decided.status).toBe("applied");
    if (decided.status !== "applied") return;
    expect(decided.results.map((r) => r.action)).toEqual(["skipped", "replaced", "created"]);
    const record = await getRecord(t.db, IDS.project, recordId);
    expect(record.currentRevision).toBe(2);
    expect(record.body).toBe(edited.content);
    const revisions = await listRevisions(t.db, recordId);
    expect(revisions.map((r) => r.revisionNumber)).toEqual([2, 1]);
    expect(revisions[1].body).toBe(fixture("lantern-keepers.md").content);
    expect(await t.db.importedFile.count({ where: { recordId } })).toBe(2);
  });

  it("rejects the whole batch when any file is invalid", async () => {
    const before = await snapshotState(t.db);
    const outcome = await applyMarkdownImport(t.db, {
      projectId: IDS.project,
      items: [
        item("lantern-keepers.md"),
        { filename: "notes.txt", content: "plain text", title: "Notes", type: "reference_note", authorityStatus: "draft", protected: false },
        { filename: "empty.md", content: "  \n", title: "Empty", type: "reference_note", authorityStatus: "draft", protected: false },
      ],
    });
    expect(outcome.status).toBe("rejected");
    if (outcome.status === "rejected") expect(outcome.issues.filter((i) => i.code === "IMPORT_INVALID")).toHaveLength(2);
    expect(await snapshotState(t.db)).toEqual(before);
    expect(await t.db.importedFile.count()).toBe(0);
  });

  it("replacing a protected reference requires confirmation and never lowers protection", async () => {
    await setProtection(t.db, IDS.project, IDS.world, true);
    const replacement = {
      filename: "salt-guild.md",
      content: "# The Salt Guild\n\nRewritten from an invented reference file.\n",
      title: "The Salt Guild",
      type: "worldbuilding",
      authorityStatus: "approved",
      protected: false,
      decision: { action: "replace" as const, recordId: IDS.world, expectedRevision: 1 },
    };
    const unconfirmed = await applyMarkdownImport(t.db, { projectId: IDS.project, items: [replacement] });
    expect(unconfirmed.status).toBe("rejected");
    if (unconfirmed.status === "rejected") {
      expect(unconfirmed.issues.map((i) => i.code)).toContain("PROTECTED_CONFIRMATION_REQUIRED");
    }

    const confirmed = await applyMarkdownImport(t.db, {
      projectId: IDS.project,
      items: [replacement],
      confirmProtectedReplacements: true,
    });
    expect(confirmed.status).toBe("applied");
    const world = await getRecord(t.db, IDS.project, IDS.world);
    expect(world.body).toContain("Rewritten");
    expect(world.protected).toBe(true);

    // Raising protection on replace is allowed and audited.
    const dossierReplace = await applyMarkdownImport(t.db, {
      projectId: IDS.project,
      items: [
        {
          filename: "mara.md",
          content: "# Mara Venn\n\nInvented replacement dossier.\n",
          title: "Mara Venn",
          type: "character_dossier",
          authorityStatus: "approved",
          protected: true,
          decision: { action: "replace", recordId: IDS.dossier, expectedRevision: 1 },
        },
      ],
    });
    expect(dossierReplace.status).toBe("applied");
    expect((await getRecord(t.db, IDS.project, IDS.dossier)).protected).toBe(true);
  });
});
