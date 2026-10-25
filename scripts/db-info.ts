import Database from "better-sqlite3";
import { statSync } from "node:fs";
import { databaseFilePath, databaseUrl } from "../src/server/dbLocation";
import { databaseExists, main } from "./lib/dbTools";

/* Read-only: shows which database file the app and Prisma CLI will use. */

main(async () => {
  const file = databaseFilePath();
  console.log(`DATABASE_URL:  ${databaseUrl()}${process.env.DATABASE_URL ? "" : " (default; DATABASE_URL not set)"}`);
  console.log(`Database file: ${file}`);
  if (!databaseExists(file)) {
    console.log("Status:        does not exist yet (run `pnpm db:setup`)");
    return;
  }
  console.log(`Size:          ${(statSync(file).size / 1024).toFixed(1)} KiB`);
  const sqlite = new Database(file, { readonly: true, fileMustExist: true });
  try {
    const tables = new Set(
      (sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>).map((t) => t.name),
    );
    if (tables.has("_prisma_migrations")) {
      const rows = sqlite
        .prepare("SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL ORDER BY migration_name")
        .all() as Array<{ migration_name: string }>;
      console.log(`Migrations:    ${rows.map((r) => r.migration_name).join(", ") || "none"}`);
    }
    for (const table of ["Workspace", "Project", "Record", "Revision", "ChangePackage", "ReviewItem", "ImportedFile"]) {
      if (!tables.has(table)) continue;
      const { n } = sqlite.prepare(`SELECT COUNT(*) AS n FROM "${table}"`).get() as { n: number };
      console.log(`${(table + ":").padEnd(15)}${n}`);
    }
  } finally {
    sqlite.close();
  }
});
