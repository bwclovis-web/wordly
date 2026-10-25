"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { isRecordType, type RecordType } from "@/domain/recordTypes";
import { isAuthorityStatus } from "@/domain/statuses";
import { errorIssue, type Issue } from "@/domain/issues";
import { parseJsonObject, type JsonObject } from "@/domain/json";
import { getDb } from "@/server/db";
import { MutationRejectedError } from "@/server/services/errors";
import {
  applyChangePackage,
  previewChangePackage,
  type ApplyOutcome,
  type PackagePreview,
} from "@/server/services/changePackageService";
import { exportContextBundle } from "@/server/services/contextExportService";
import { createRecord, setAuthorityStatus, setProtection, updateRecord } from "@/server/services/recordService";
import { resolveReviewItem } from "@/server/services/reviewService";

export interface FormResult {
  ok: boolean;
  message?: string;
  issues?: Issue[];
}

function str(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "");
}

function parseFields(text: string): JsonObject {
  return text.trim() ? parseJsonObject(text) : {};
}

function failure(error: unknown): FormResult {
  if (error instanceof MutationRejectedError) return { ok: false, issues: error.issues };
  return { ok: false, issues: [errorIssue("INVALID_CHANGE", (error as Error).message)] };
}

export async function createRecordAction(projectId: string, _prev: FormResult, formData: FormData): Promise<FormResult> {
  const type = str(formData, "type");
  const status = str(formData, "authorityStatus");
  if (!isRecordType(type) || !isAuthorityStatus(status)) return { ok: false, message: "Invalid type or status" };
  let recordId: string;
  try {
    const batch = await createRecord(getDb(), projectId, {
      type,
      title: str(formData, "title"),
      body: str(formData, "body"),
      fields: parseFields(str(formData, "fields")),
      authorityStatus: status,
    });
    recordId = batch.outcomes[0].recordId;
  } catch (error) {
    return failure(error);
  }
  revalidatePath(`/projects/${projectId}`);
  redirect(`/projects/${projectId}/records/${recordId}`);
}

export async function saveRecordAction(
  projectId: string,
  recordId: string,
  _prev: FormResult,
  formData: FormData,
): Promise<FormResult> {
  try {
    const status = str(formData, "authorityStatus");
    const batch = await updateRecord(getDb(), projectId, {
      recordId,
      expectedRevision: Number(str(formData, "expectedRevision")),
      title: str(formData, "title"),
      body: str(formData, "body"),
      fields: parseFields(str(formData, "fields")),
      authorityStatus: isAuthorityStatus(status) ? status : undefined,
      unlockProtected: formData.get("unlockProtected") === "on",
    });
    revalidatePath(`/projects/${projectId}`, "layout");
    return { ok: true, message: `Saved as revision ${batch.outcomes[0].newRevision}.` };
  } catch (error) {
    return failure(error);
  }
}

export async function setStatusAction(
  projectId: string,
  recordId: string,
  _prev: FormResult,
  formData: FormData,
): Promise<FormResult> {
  const status = str(formData, "status");
  if (!isAuthorityStatus(status)) return { ok: false, message: "Invalid status" };
  try {
    const batch = await setAuthorityStatus(getDb(), projectId, {
      recordId,
      expectedRevision: Number(str(formData, "expectedRevision")),
      status,
      supersededBy: str(formData, "supersededBy").trim() || null,
      unlockProtected: formData.get("unlockProtected") === "on",
    });
    revalidatePath(`/projects/${projectId}`, "layout");
    return { ok: true, message: `Status set; now revision ${batch.outcomes[0].newRevision}.` };
  } catch (error) {
    return failure(error);
  }
}

export async function setProtectionAction(projectId: string, recordId: string, formData: FormData) {
  await setProtection(getDb(), projectId, recordId, formData.get("protected") === "true");
  revalidatePath(`/projects/${projectId}`, "layout");
}

export async function previewPackageAction(projectId: string, raw: string): Promise<PackagePreview> {
  return previewChangePackage(getDb(), raw, { projectId });
}

export async function applyPackageAction(
  projectId: string,
  raw: string,
  confirmProtected: boolean,
): Promise<ApplyOutcome> {
  const outcome = await applyChangePackage(getDb(), raw, { projectId }, { confirmProtected });
  if (outcome.status === "applied") revalidatePath(`/projects/${projectId}`, "layout");
  return outcome;
}

export async function exportBundleAction(
  projectId: string,
  recordIds: string[],
  types: string[],
  includeSchema: boolean,
): Promise<string> {
  const bundle = await exportContextBundle(getDb(), projectId, {
    recordIds: recordIds.length ? recordIds : undefined,
    types: types.length ? types.filter((t): t is RecordType => isRecordType(t)) : undefined,
    includeSchema,
  });
  return JSON.stringify(bundle, null, 2);
}

export async function resolveReviewItemAction(projectId: string, reviewItemId: string) {
  await resolveReviewItem(getDb(), projectId, reviewItemId);
  revalidatePath(`/projects/${projectId}/history`);
}
