import "dotenv/config";
import { createDb } from "../src/server/db";
import { databaseFilePath, fileUrl } from "../src/server/dbLocation";
import { createProject, createWorkspace } from "../src/server/services/projectService";
import { createRecord } from "../src/server/services/recordService";

/*
 * Demo project with fixed IDs so examples/sample-change-package.json applies
 * against a freshly seeded database. Safe to re-run; skips if present.
 */

const DEMO_IDS = {
  workspace: "wsp_demo",
  project: "prj_demo_salt_archive",
  chapter1: "rec_demo_ch01_prose",
  chapter1Outline: "rec_demo_ch01_outline",
  maraDossier: "rec_demo_mara_dossier",
  saltGuild: "rec_demo_salt_guild",
  decisionMaraAge: "rec_demo_decision_mara_age",
} as const;

async function main() {
  const db = createDb(fileUrl(databaseFilePath()));
  try {
    if (await db.workspace.findUnique({ where: { id: DEMO_IDS.workspace } })) {
      console.log("Demo data already present; nothing to do.");
      return;
    }
    await createWorkspace(db, { id: DEMO_IDS.workspace, name: "Demo workspace" });
    await createProject(db, { id: DEMO_IDS.project, workspaceId: DEMO_IDS.workspace, title: "The Salt Archive" });
    const p = DEMO_IDS.project;

    await createRecord(db, p, {
      recordId: DEMO_IDS.maraDossier,
      type: "character_dossier",
      title: "Mara Venn",
      body: "Archivist of the Salt Guild. Thirty years old. Lost her brother in the flood of the Lower Stacks.",
      fields: { name: "Mara Venn", aliases: ["Mara", "the Archivist"], age: 30, role: "protagonist" },
      authorityStatus: "approved",
    });
    await createRecord(db, p, {
      recordId: DEMO_IDS.saltGuild,
      type: "worldbuilding",
      title: "The Salt Guild",
      body: "A guild of archivists who preserve records in salt-cured vellum. Mara serves as its youngest senior archivist.",
      fields: { aliases: ["the Guild"] },
      authorityStatus: "approved",
    });
    await createRecord(db, p, {
      recordId: DEMO_IDS.chapter1Outline,
      type: "chapter_outline",
      title: "Chapter 1 outline",
      body: "1. Mara discovers the water-damaged ledger.\n2. The Guild council dismisses her concern.\n3. She takes the ledger home.",
      authorityStatus: "approved",
    });
    await createRecord(db, p, {
      recordId: DEMO_IDS.chapter1,
      type: "manuscript_chapter",
      title: "Chapter 1: The Wet Ledger",
      body: "The ledger had been dry for three hundred years. Mara Venn knew this because she had checked it every morning for the last decade.",
      authorityStatus: "draft",
    });
    await createRecord(db, p, {
      recordId: DEMO_IDS.decisionMaraAge,
      type: "canon_decision",
      title: "Mara's age",
      body: "Is Mara 30 or older? Unresolved: the decade of morning checks implies she started at 20.",
      authorityStatus: "unresolved",
    });

    console.log(`Seeded demo project ${p}.`);
  } finally {
    await db.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
