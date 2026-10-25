import { backupCurrentDatabase, flagValue, main, printBackup } from "./lib/dbTools";

/* Non-destructive: snapshots the database and exports every workspace. */

main(async () => {
  printBackup(await backupCurrentDatabase(flagValue("--label")));
});
