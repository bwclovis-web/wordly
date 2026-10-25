import "dotenv/config";
import Database from "better-sqlite3";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createDb } from "../../src/server/db";
import { databaseFilePath, fileUrl } from "../../src/server/dbLocation";
import { createWorkspaceBackup } from "../../src/server/services/backupService";

export const BACKUPS_DIR = path.resolve(process.cwd(), "backups");

export function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

export function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

export function flagValue(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const VALUE_FLAGS = new Set(["--new-database", "--name", "--label"]);

export function positionalArgs(): string[] {
  const args = process.argv.slice(2);
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith("--")) {
      if (VALUE_FLAGS.has(args[i])) i++;
      continue;
    }
    out.push(args[i]);
  }
  return out;
}

export function databaseExists(file = databaseFilePath()): boolean {
  return existsSync(file) && statSync(file).size > 0;
}

/** Consistent copy of a live SQLite file using SQLite's online backup API. */
export async function snapshotSqlite(sourceFile: string, destFile: string): Promise<void> {
  mkdirSync(path.dirname(destFile), { recursive: true });
  const sqlite = new Database(sourceFile, { readonly: true, fileMustExist: true });
  try {
    await sqlite.backup(destFile);
  } finally {
    sqlite.close();
  }
}

export interface FullBackupResult {
  dir: string;
  sqliteFile: string;
  workspaceFiles: Array<{ workspaceId: string; name: string; file: string }>;
}

/**
 * Writes backups/<timestamp>[-label]/ containing a raw SQLite snapshot of the
 * whole database plus one portable JSON backup per workspace.
 */
export async function backupCurrentDatabase(label?: string): Promise<FullBackupResult> {
  const file = databaseFilePath();
  if (!databaseExists(file)) throw new Error(`No database found at ${file}; nothing to back up.`);
  const dir = path.join(BACKUPS_DIR, label ? `${timestamp()}-${label}` : timestamp());
  const sqliteFile = path.join(dir, path.basename(file));
  await snapshotSqlite(file, sqliteFile);

  const workspaceFiles: FullBackupResult["workspaceFiles"] = [];
  const db = createDb(fileUrl(file));
  try {
    const hasTables = await db.$queryRawUnsafe<Array<{ name: string }>>(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='Workspace'",
    );
    if (hasTables.length > 0) {
      for (const ws of await db.workspace.findMany({ orderBy: { id: "asc" } })) {
        const backup = await createWorkspaceBackup(db, ws.id);
        const out = path.join(dir, `${ws.id}.wordly-backup.json`);
        writeFileSync(out, JSON.stringify(backup, null, 2), "utf8");
        workspaceFiles.push({ workspaceId: ws.id, name: ws.name, file: out });
      }
    }
  } finally {
    await db.$disconnect();
  }
  return { dir, sqliteFile, workspaceFiles };
}

export function printBackup(result: FullBackupResult) {
  console.log(`Backup written to ${result.dir}`);
  console.log(`  SQLite snapshot: ${path.basename(result.sqliteFile)}`);
  for (const w of result.workspaceFiles) console.log(`  Workspace "${w.name}" (${w.workspaceId}): ${path.basename(w.file)}`);
}

function runTool(args: string[], dbFile: string): void {
  const command = ["pnpm", "exec", ...args].map((a) => (/^[\w./:=@-]+$/.test(a) ? a : JSON.stringify(a))).join(" ");
  const result = spawnSync(command, {
    stdio: "inherit",
    shell: true,
    env: { ...process.env, DATABASE_URL: fileUrl(dbFile) },
  });
  if (result.status !== 0) throw new Error(`${args.join(" ")} failed with exit code ${result.status}`);
}

/** Runs the project's Prisma CLI against an explicit database file. */
export function runPrisma(args: string[], dbFile = databaseFilePath()): void {
  runTool(["prisma", ...args], dbFile);
}

export function runSeed(dbFile = databaseFilePath()): void {
  runTool(["tsx", "prisma/seed.ts"], dbFile);
}

export async function main(fn: () => Promise<void>) {
  try {
    await fn();
  } catch (error) {
    console.error(`\nError: ${(error as Error).message}`);
    process.exit(1);
  }
}
