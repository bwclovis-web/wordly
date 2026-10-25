"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/server/db";
import {
  restoreWorkspaceBackup,
  validateWorkspaceBackup,
  type BackupSummary,
  type RestoreOutcome,
} from "@/server/services/backupService";
import type { Issue } from "@/domain/issues";

export interface BackupCheck {
  ok: boolean;
  issues: Issue[];
  summary: BackupSummary | null;
}

export async function checkBackupAction(raw: string): Promise<BackupCheck> {
  const v = await validateWorkspaceBackup(getDb(), raw, { idStrategy: "remap" });
  return { ok: v.ok, issues: v.issues, summary: v.summary };
}

export async function restoreBackupAction(raw: string, workspaceName: string): Promise<RestoreOutcome> {
  const outcome = await restoreWorkspaceBackup(getDb(), raw, { idStrategy: "remap", workspaceName, actor: "author (UI restore)" });
  if (outcome.ok) revalidatePath("/", "layout");
  return outcome;
}
