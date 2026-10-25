import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { Prisma, PrismaClient } from "@/generated/prisma/client";
import { databaseFilePath, fileUrl } from "./dbLocation";

export type Db = PrismaClient;
export type Tx = Prisma.TransactionClient;
export type DbOrTx = Db | Tx;

export function createDb(url: string): Db {
  return new PrismaClient({ adapter: new PrismaBetterSqlite3({ url }) });
}

const globalForDb = globalThis as unknown as { __wordlyDb?: Db };

/** Process-wide client for the Next.js app. Services take a `db` argument instead of calling this. */
export function getDb(): Db {
  if (!globalForDb.__wordlyDb) {
    globalForDb.__wordlyDb = createDb(fileUrl(databaseFilePath()));
  }
  return globalForDb.__wordlyDb;
}

export function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}
