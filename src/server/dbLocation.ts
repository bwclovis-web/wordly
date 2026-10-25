import path from "node:path";

export const DEFAULT_DATABASE_URL = "file:./prisma/dev.db";

export function databaseUrl(): string {
  return process.env.DATABASE_URL || DEFAULT_DATABASE_URL;
}

/**
 * Absolute path of the SQLite file. Relative `file:` URLs resolve against the
 * project root (the working directory of `pnpm` scripts, `next dev/start`,
 * and the Prisma CLI), so all of them open the same file.
 */
export function databaseFilePath(url: string = databaseUrl()): string {
  if (!url.startsWith("file:")) throw new Error(`Only SQLite file: URLs are supported (got ${url})`);
  return path.resolve(/*turbopackIgnore: true*/ process.cwd(), url.slice("file:".length));
}

export function fileUrl(filePath: string): string {
  return `file:${path.resolve(/*turbopackIgnore: true*/ filePath).replace(/\\/g, "/")}`;
}
