import Database from "better-sqlite3";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { ChangePackageV1Input } from "@/changePackage/schema.v1";
import { createDb, type Db } from "@/server/db";
import { createProject, createWorkspace } from "@/server/services/projectService";
import { createRecord } from "@/server/services/recordService";

const MIGRATIONS_DIR = path.resolve(__dirname, "..", "prisma", "migrations");

function migrationSql(): string[] {
  return readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort()
    .map((name) => readFileSync(path.join(MIGRATIONS_DIR, name, "migration.sql"), "utf8"));
}

export interface TestDb {
  db: Db;
  cleanup: () => Promise<void>;
}

/** Fresh SQLite file with all migrations applied. */
export async function createTestDb(): Promise<TestDb> {
  const dir = mkdtempSync(path.join(tmpdir(), "wordly-test-"));
  const file = path.join(dir, "test.db").replace(/\\/g, "/");
  const sqlite = new Database(file);
  for (const sql of migrationSql()) sqlite.exec(sql);
  sqlite.close();
  const db = createDb(`file:${file}`);
  return {
    db,
    cleanup: async () => {
      await db.$disconnect();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

export const IDS = {
  workspace: "wsp_test",
  project: "prj_test_novel",
  chapter: "rec_test_ch01_prose",
  outline: "rec_test_ch01_outline",
  dossier: "rec_test_mara_dossier",
  world: "rec_test_salt_guild",
  decision: "rec_test_decision_age",
} as const;

export const CHAPTER_PROSE =
  "The ledger had been dry for three hundred years. Mara Venn knew this because she had checked it every morning.";

export async function seedProject(db: Db) {
  await createWorkspace(db, { id: IDS.workspace, name: "Test workspace" });
  await createProject(db, { id: IDS.project, workspaceId: IDS.workspace, title: "Test novel" });
  await createRecord(db, IDS.project, {
    recordId: IDS.dossier,
    type: "character_dossier",
    title: "Mara Venn",
    body: "Archivist. Thirty years old.",
    fields: { name: "Mara Venn", aliases: ["Mara"], age: 30 },
    authorityStatus: "approved",
  });
  await createRecord(db, IDS.project, {
    recordId: IDS.world,
    type: "worldbuilding",
    title: "The Salt Guild",
    body: "Archivists who preserve records in salt. Mara is a senior member.",
    authorityStatus: "approved",
  });
  await createRecord(db, IDS.project, {
    recordId: IDS.outline,
    type: "chapter_outline",
    title: "Chapter 1 outline",
    body: "1. Mara finds the wet ledger.",
    authorityStatus: "approved",
  });
  await createRecord(db, IDS.project, {
    recordId: IDS.chapter,
    type: "manuscript_chapter",
    title: "Chapter 1",
    body: CHAPTER_PROSE,
    authorityStatus: "draft",
  });
  await createRecord(db, IDS.project, {
    recordId: IDS.decision,
    type: "canon_decision",
    title: "Mara's age",
    body: "Is Mara 30 or 34?",
    authorityStatus: "unresolved",
  });
}

let counter = 0;

export function makePackage(overrides: Partial<ChangePackageV1Input> = {}): ChangePackageV1Input {
  counter += 1;
  return {
    format: "wordly.change-package",
    formatVersion: 1,
    packageId: `pkg_test_${Date.now()}_${counter}`,
    workspaceId: IDS.workspace,
    projectId: IDS.project,
    summary: "Approved dossier update",
    source: { conversationLabel: "Test conversation" },
    approval: { status: "approved", statement: "Author approved" },
    scope: "reference",
    operations: [
      {
        op: "update_record",
        recordId: IDS.dossier,
        expectedRevision: 1,
        changes: { body: { replace: "Archivist. Thirty-four years old." }, fields: { set: { age: 34 } } },
      },
    ],
    ...overrides,
  };
}

/** Everything that a failed import must leave untouched. */
export async function snapshotState(db: Db) {
  const [records, revisions, packages, reviewItems, sources] = await Promise.all([
    db.record.findMany({ orderBy: { id: "asc" } }),
    db.revision.findMany({ orderBy: [{ recordId: "asc" }, { revisionNumber: "asc" }] }),
    db.changePackage.findMany({ orderBy: { packageId: "asc" } }),
    db.reviewItem.findMany({ orderBy: { id: "asc" } }),
    db.source.findMany({ orderBy: { id: "asc" } }),
  ]);
  return { records, revisions, packages, reviewItems, sources };
}
