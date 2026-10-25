import { databaseFilePath } from "../src/server/dbLocation";
import { backupCurrentDatabase, databaseExists, main, printBackup, runPrisma } from "./lib/dbTools";

/* Applies pending migrations, taking a backup first when a database exists. */

main(async () => {
  const file = databaseFilePath();
  console.log(`Database file: ${file}`);
  if (databaseExists(file)) printBackup(await backupCurrentDatabase("pre-migrate"));
  runPrisma(["migrate", "deploy"], file);
});
