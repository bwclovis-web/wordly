import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createDb } from "../src/server/db";
import { databaseFilePath, fileUrl } from "../src/server/dbLocation";
import {
  restoreWorkspaceBackup,
  validateWorkspaceBackup,
  type IdStrategy,
} from "../src/server/services/backupService";
import { backupCurrentDatabase, databaseExists, flagValue, hasFlag, main, positionalArgs, printBackup, runPrisma } from "./lib/dbTools";

/*
 * Restores a *.wordly-backup.json file. Never overwrites existing records:
 *   --new-database <file>  create a new SQLite file and restore with the original IDs
 *   --into-current         add to the current database as a new workspace with new IDs
 *   --dry-run              validate and summarize only
 */

const USAGE = `Usage:
  pnpm db:restore <backup.json> --dry-run
  pnpm db:restore <backup.json> --new-database <path/to/new.db>
  pnpm db:restore <backup.json> --into-current [--name "Workspace name"]`;

main(async () => {
  const [backupPath] = positionalArgs();
  const newDatabase = flagValue("--new-database");
  const intoCurrent = hasFlag("--into-current");
  const dryRun = hasFlag("--dry-run");
  if (!backupPath || (!dryRun && Boolean(newDatabase) === intoCurrent)) {
    console.log(USAGE);
    process.exit(1);
  }
  const text = readFileSync(path.resolve(backupPath), "utf8");
  const idStrategy: IdStrategy = newDatabase ? "preserve" : "remap";

  let targetFile: string;
  if (newDatabase) {
    targetFile = path.resolve(newDatabase);
    if (existsSync(targetFile)) throw new Error(`${targetFile} already exists. Choose a path that does not exist.`);
  } else {
    targetFile = databaseFilePath();
    if (!databaseExists(targetFile)) throw new Error(`No database at ${targetFile}. Run \`pnpm db:setup\` first.`);
  }

  if (dryRun) {
    // A new database starts empty, so ID collisions are only checked for --into-current.
    const db = createDb(fileUrl(databaseFilePath()));
    try {
      report(await validateWorkspaceBackup(db, text, { idStrategy: "remap" }));
    } finally {
      await db.$disconnect();
    }
    return;
  }

  if (newDatabase) {
    console.log(`Creating ${targetFile}`);
    runPrisma(["migrate", "deploy"], targetFile);
  } else {
    printBackup(await backupCurrentDatabase("pre-restore"));
  }

  const db = createDb(fileUrl(targetFile));
  try {
    const outcome = await restoreWorkspaceBackup(db, text, {
      idStrategy,
      workspaceName: flagValue("--name"),
      actor: "author (db:restore)",
    });
    if (!outcome.ok) {
      for (const issue of outcome.issues) console.error(`  [${issue.code}] ${issue.message}`);
      throw new Error("Restore rejected; nothing was written.");
    }
    console.log(`Restored workspace "${outcome.workspaceName}" (${outcome.workspaceId}) into ${targetFile}`);
    for (const p of outcome.projects) console.log(`  Project "${p.title}": ${p.id}${p.id !== p.originalId ? ` (was ${p.originalId})` : ""}`);
    if (newDatabase) console.log(`\nTo open it, set DATABASE_URL="${fileUrl(targetFile)}" in .env and restart the app.`);
  } finally {
    await db.$disconnect();
  }
});

function report(v: Awaited<ReturnType<typeof validateWorkspaceBackup>>) {
  if (v.summary) {
    console.log(`Workspace "${v.summary.workspaceName}" (${v.summary.workspaceId}), backed up ${v.summary.createdAt}`);
    for (const p of v.summary.projects) {
      console.log(`  ${p.title}: ${p.records} records, ${p.changePackages} packages, ${p.openReviewItems} open review items`);
    }
  }
  for (const issue of v.issues) console.log(`  [${issue.severity}] ${issue.code}: ${issue.message}`);
  console.log(v.ok ? "Backup is valid; restore would succeed." : "Backup is NOT restorable as requested.");
  if (!v.ok) process.exit(1);
}
