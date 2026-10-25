import { databaseFilePath } from "../src/server/dbLocation";
import { backupCurrentDatabase, databaseExists, main, printBackup, runPrisma } from "./lib/dbTools";

/*
 * Developer-only: creates a migration after editing prisma/schema.prisma.
 * `prisma migrate dev` may offer to RESET the database if it detects drift;
 * answer "no" unless the backup below is one you are prepared to restore from.
 */

main(async () => {
  const file = databaseFilePath();
  console.log(`Database file: ${file}`);
  if (databaseExists(file)) printBackup(await backupCurrentDatabase("pre-migrate-dev"));
  console.log("\nWARNING: if Prisma asks to reset the database, answer NO unless you intend to lose all data.\n");
  runPrisma(["migrate", "dev", ...process.argv.slice(2)], file);
});
