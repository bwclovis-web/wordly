import { existsSync, rmSync } from "node:fs";
import { databaseFilePath } from "../src/server/dbLocation";
import { backupCurrentDatabase, databaseExists, hasFlag, main, printBackup, runPrisma, runSeed } from "./lib/dbTools";

/*
 * Destructive. Deletes the database file and recreates an empty schema.
 * Refuses to run without --confirm-delete-all-data and always backs up first.
 */

const CONFIRM = "--confirm-delete-all-data";

main(async () => {
  const file = databaseFilePath();
  if (!hasFlag(CONFIRM)) {
    console.log(`This would DELETE ALL DATA in:\n  ${file}\n`);
    console.log("A full backup is written to backups/ first, but the live database is then removed.");
    console.log(`To proceed run:  pnpm db:reset ${CONFIRM}   (add --seed to load the demo project)`);
    console.log("Nothing was changed.");
    process.exit(1);
  }
  if (databaseExists(file)) {
    const backup = await backupCurrentDatabase("pre-reset");
    printBackup(backup);
  }
  for (const suffix of ["", "-journal", "-wal", "-shm"]) {
    if (existsSync(file + suffix)) rmSync(file + suffix);
  }
  console.log(`Deleted ${file}`);
  runPrisma(["migrate", "deploy"], file);
  if (hasFlag("--seed")) runSeed(file);
  console.log("Reset complete.");
});
