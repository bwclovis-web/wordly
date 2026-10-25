import { fieldDiffs, hasTextChange, textDiff, type DiffPart, type FieldDiff } from "@/changePackage/diff";
import { parseChangePackage } from "@/changePackage/parse";
import type { ChangePackageV1, PackageOperation, SupportedOperation } from "@/changePackage/schema.v1";
import { newId } from "@/domain/ids";
import { errorIssue, hasErrors, warningIssue, type Issue } from "@/domain/issues";
import { contentClassOf, type ContentClass, type RecordType } from "@/domain/recordTypes";
import type { AuthorityStatus, ReviewOrigin } from "@/domain/statuses";
import { isUniqueConstraintError, type Db, type DbOrTx, type Tx } from "../db";
import { MutationRejectedError } from "./errors";
import { detectPotentialEffects, type PotentialEffect } from "./impactService";
import {
  applyMutationsInTx,
  planMutations,
  type Mutation,
  type MutationContext,
  type PlannedMutation,
} from "./mutationService";

export interface PackageTarget {
  projectId: string;
}

export interface OperationPreview {
  index: number;
  op: SupportedOperation;
  recordId: string;
  idAssignedOnApply: boolean;
  type: RecordType;
  contentClass: ContentClass;
  protected: boolean;
  usesProtectedOverride: boolean;
  expectedRevision: number | null;
  currentRevision: number | null;
  note?: string;
  titleBefore: string | null;
  titleAfter: string;
  bodyDiff: DiffPart[];
  bodyChanged: boolean;
  fieldDiffs: FieldDiff[];
  statusBefore: AuthorityStatus | null;
  statusAfter: AuthorityStatus;
  supersededByBefore: string | null;
  supersededByAfter: string | null;
  issues: Issue[];
}

export interface ReviewNotePreview {
  recordId: string;
  title: string | null;
  note: string;
}

export interface PackageHeader {
  packageId: string;
  formatVersion: number;
  workspaceId: string;
  projectId: string;
  summary: string;
  source: ChangePackageV1["source"] | null;
  approval: ChangePackageV1["approval"];
  scope: ChangePackageV1["scope"];
  protectedOverrides: string[];
  contentHash: string;
}

export interface PackagePreview {
  status: "invalid" | "valid" | "already_applied";
  canApply: boolean;
  requiresProtectedConfirmation: boolean;
  issues: Issue[];
  header: PackageHeader | null;
  operations: OperationPreview[];
  relatedNotes: ReviewNotePreview[];
  potentialEffects: PotentialEffect[];
  previousResult: PackageApplyResult | null;
}

export interface PackageApplyResult {
  packageId: string;
  projectId: string;
  summary: string;
  contentHash: string;
  appliedAt: string;
  sourceId: string;
  auditEntryId: string;
  changes: Array<{
    index: number;
    op: SupportedOperation;
    recordId: string;
    type: RecordType;
    title: string;
    previousRevision: number | null;
    newRevision: number;
  }>;
  createdRecordIds: string[];
  reviewItems: Array<{
    id: string;
    recordId: string;
    title: string;
    origin: ReviewOrigin;
    note: string;
    triggeredByRecordId: string | null;
  }>;
}

export type ApplyOutcome =
  | { status: "applied"; result: PackageApplyResult; warnings: Issue[] }
  | { status: "already_applied"; result: PackageApplyResult }
  | { status: "rejected"; issues: Issue[] };

export interface ApplyOptions {
  /** Author confirmed changes to records listed in `protectedOverrides`. */
  confirmProtected?: boolean;
  /** Runs inside the transaction just before commit; a throw rolls everything back. */
  beforeCommit?: (tx: Tx) => Promise<void>;
}

export function toMutations(pkg: ChangePackageV1): Mutation[] {
  return pkg.operations.map((op, index): Mutation => {
    switch (op.op) {
      case "create_record":
        return {
          kind: "create_record",
          recordId: op.newRecordId,
          type: op.type,
          title: op.title,
          body: op.body,
          fields: op.fields,
          authorityStatus: op.authorityStatus,
          operationIndex: index,
        };
      case "update_record":
        return {
          kind: "update_record",
          recordId: op.recordId,
          expectedRevision: op.expectedRevision,
          changes: {
            title: op.changes.title?.replace,
            body: op.changes.body?.replace,
            fields: op.changes.fields,
          },
          authorityStatus: op.authorityStatus,
          operationIndex: index,
        };
      case "set_authority_status":
        return {
          kind: "set_authority_status",
          recordId: op.recordId,
          expectedRevision: op.expectedRevision,
          status: op.status,
          supersededBy: op.supersededBy ?? null,
          operationIndex: index,
        };
    }
  });
}

export function packageContext(pkg: ChangePackageV1): MutationContext {
  return {
    projectId: pkg.projectId,
    actor: "change-package",
    source: {
      kind: "change_package",
      conversationLabel: pkg.source?.conversationLabel ?? null,
      url: pkg.source?.url ?? null,
      packageId: pkg.packageId,
    },
    scope: pkg.scope,
    protectedOverrides: new Set(pkg.protectedOverrides),
  };
}

interface Analysis {
  pkg: ChangePackageV1 | null;
  contentHash: string | null;
  issues: Issue[];
  planned: PlannedMutation[];
  previousResult: PackageApplyResult | null;
  relatedNotes: ReviewNotePreview[];
}

async function analyze(db: DbOrTx, input: string | unknown, target: PackageTarget): Promise<Analysis> {
  const parsed = parseChangePackage(input);
  if (!parsed.ok) {
    return { pkg: null, contentHash: null, issues: parsed.issues, planned: [], previousResult: null, relatedNotes: [] };
  }
  const { pkg, contentHash } = parsed;
  const issues: Issue[] = [];

  const previous = await db.changePackage.findUnique({
    where: { projectId_packageId: { projectId: target.projectId, packageId: pkg.packageId } },
  });
  if (previous) {
    if (previous.contentHash === contentHash) {
      return {
        pkg,
        contentHash,
        issues: [],
        planned: [],
        previousResult: JSON.parse(previous.resultJson) as PackageApplyResult,
        relatedNotes: [],
      };
    }
    issues.push(
      errorIssue(
        "PACKAGE_ID_CONFLICT",
        `Package ID ${pkg.packageId} was already applied with different content. Use a new packageId for a new change set.`,
        { path: "packageId" },
      ),
    );
  }

  const project = await db.project.findUnique({ where: { id: target.projectId } });
  if (!project || pkg.projectId !== target.projectId) {
    issues.push(
      errorIssue("TARGET_MISMATCH", `Package targets project ${pkg.projectId}, but it is being imported into ${target.projectId}.`, {
        path: "projectId",
      }),
    );
  } else if (project.workspaceId !== pkg.workspaceId) {
    issues.push(
      errorIssue("TARGET_MISMATCH", `Package targets workspace ${pkg.workspaceId}, but project ${project.id} belongs to ${project.workspaceId}.`, {
        path: "workspaceId",
      }),
    );
  }

  if (pkg.approval.status !== "approved") {
    issues.push(
      errorIssue(
        "NOT_APPROVED",
        `Approval status is "${pkg.approval.status}". Only packages explicitly marked "approved" can be applied; this one can be previewed only.`,
        { path: "approval.status" },
      ),
    );
  }

  if (hasErrors(issues.filter((i) => i.code === "TARGET_MISMATCH"))) {
    return { pkg, contentHash, issues, planned: [], previousResult: null, relatedNotes: [] };
  }

  const plan = await planMutations(db, packageContext(pkg), toMutations(pkg));
  issues.push(...plan.issues);

  pkg.protectedOverrides.forEach((id, i) => {
    const planned = plan.planned.find((p) => p.recordId === id);
    if (!planned || !planned.protected) {
      issues.push(
        warningIssue(
          "UNUSED_PROTECTED_OVERRIDE",
          planned ? `Override for ${id} is unnecessary; the record is not protected.` : `Override for ${id} is not used by any operation.`,
          { path: `protectedOverrides.${i}`, recordId: id },
        ),
      );
    }
  });

  const relatedIds = pkg.relatedRecords.map((r) => r.recordId);
  const relatedRows = await db.record.findMany({
    where: { id: { in: relatedIds }, projectId: pkg.projectId },
    select: { id: true, title: true },
  });
  const relatedTitles = new Map(relatedRows.map((r) => [r.id, r.title]));
  const relatedNotes: ReviewNotePreview[] = [];
  pkg.relatedRecords.forEach((r, i) => {
    const created = plan.planned.find((p) => p.before === null && p.recordId === r.recordId);
    if (!relatedTitles.has(r.recordId) && !created) {
      issues.push(
        errorIssue("INVALID_REFERENCE", `Related record ${r.recordId} does not exist in this project.`, {
          path: `relatedRecords.${i}.recordId`,
          recordId: r.recordId,
        }),
      );
    }
    relatedNotes.push({ recordId: r.recordId, title: relatedTitles.get(r.recordId) ?? created?.after.title ?? null, note: r.note });
  });

  return { pkg, contentHash, issues, planned: plan.planned, previousResult: null, relatedNotes };
}

function operationPreview(pkg: ChangePackageV1, p: PlannedMutation, issues: Issue[]): OperationPreview {
  const op: PackageOperation = pkg.operations[p.index];
  const bodyDiff = textDiff(p.before?.body ?? "", p.after.body);
  return {
    index: p.index,
    op: op.op,
    recordId: p.recordId,
    idAssignedOnApply: op.op === "create_record" && !op.newRecordId,
    type: p.type,
    contentClass: contentClassOf(p.type),
    protected: p.protected,
    usesProtectedOverride: p.usesProtectedOverride,
    expectedRevision: op.op === "create_record" ? null : op.expectedRevision,
    currentRevision: p.beforeRevision,
    note: op.note,
    titleBefore: p.before?.title ?? null,
    titleAfter: p.after.title,
    bodyDiff,
    bodyChanged: p.before === null ? p.after.body !== "" : hasTextChange(bodyDiff),
    fieldDiffs: fieldDiffs(p.before?.fields ?? {}, p.after.fields),
    statusBefore: p.before?.authorityStatus ?? null,
    statusAfter: p.after.authorityStatus,
    supersededByBefore: p.before?.supersededByRecordId ?? null,
    supersededByAfter: p.after.supersededByRecordId,
    issues: issues.filter((i) => i.operationIndex === p.index),
  };
}

function impactTriggers(planned: readonly PlannedMutation[]) {
  return planned.map((p) => ({ recordId: p.recordId, title: p.after.title, snapshots: [p.before, p.after] }));
}

function headerOf(pkg: ChangePackageV1, contentHash: string): PackageHeader {
  return {
    packageId: pkg.packageId,
    formatVersion: pkg.formatVersion,
    workspaceId: pkg.workspaceId,
    projectId: pkg.projectId,
    summary: pkg.summary,
    source: pkg.source ?? null,
    approval: pkg.approval,
    scope: pkg.scope,
    protectedOverrides: pkg.protectedOverrides,
    contentHash,
  };
}

/** Full validation plus before/after diffs. Never writes. */
export async function previewChangePackage(
  db: DbOrTx,
  input: string | unknown,
  target: PackageTarget,
): Promise<PackagePreview> {
  const a = await analyze(db, input, target);
  const base = {
    header: a.pkg && a.contentHash ? headerOf(a.pkg, a.contentHash) : null,
    relatedNotes: a.relatedNotes,
  };
  if (a.previousResult) {
    return {
      ...base,
      status: "already_applied",
      canApply: false,
      requiresProtectedConfirmation: false,
      issues: [],
      operations: [],
      potentialEffects: [],
      previousResult: a.previousResult,
    };
  }
  const operations = a.pkg ? a.planned.map((p) => operationPreview(a.pkg!, p, a.issues)) : [];
  const potentialEffects = a.pkg
    ? await detectPotentialEffects(db, a.pkg.projectId, impactTriggers(a.planned), new Set(a.planned.map((p) => p.recordId)))
    : [];
  const valid = !!a.pkg && !hasErrors(a.issues);
  return {
    ...base,
    status: valid ? "valid" : "invalid",
    canApply: valid,
    requiresProtectedConfirmation: a.planned.some((p) => p.usesProtectedOverride),
    issues: a.issues,
    operations,
    potentialEffects,
    previousResult: null,
  };
}

class AlreadyAppliedSignal extends Error {
  constructor(readonly result: PackageApplyResult) {
    super("already applied");
  }
}

/**
 * Validates and applies a package atomically. On any issue nothing is written.
 * Re-applying the same package (same ID and content) is a no-op.
 */
export async function applyChangePackage(
  db: Db,
  input: string | unknown,
  target: PackageTarget,
  options: ApplyOptions = {},
): Promise<ApplyOutcome> {
  const a = await analyze(db, input, target);
  if (a.previousResult) return { status: "already_applied", result: a.previousResult };
  if (!a.pkg || !a.contentHash || hasErrors(a.issues)) return { status: "rejected", issues: a.issues };

  const pkg = a.pkg;
  const contentHash = a.contentHash;
  if (a.planned.some((p) => p.usesProtectedOverride) && !options.confirmProtected) {
    return {
      status: "rejected",
      issues: [
        ...a.issues,
        errorIssue(
          "PROTECTED_CONFIRMATION_REQUIRED",
          "This package changes protected records listed in protectedOverrides. Confirm the protected changes to apply it.",
          { path: "protectedOverrides" },
        ),
      ],
    };
  }

  try {
    const result = await db.$transaction(
      async (tx) => {
        const existing = await tx.changePackage.findUnique({
          where: { projectId_packageId: { projectId: pkg.projectId, packageId: pkg.packageId } },
        });
        if (existing) {
          if (existing.contentHash === contentHash) {
            throw new AlreadyAppliedSignal(JSON.parse(existing.resultJson) as PackageApplyResult);
          }
          throw new MutationRejectedError([
            errorIssue("PACKAGE_ID_CONFLICT", `Package ID ${pkg.packageId} was already applied with different content.`, {
              path: "packageId",
            }),
          ]);
        }

        const batch = await applyMutationsInTx(tx, packageContext(pkg), toMutations(pkg), {
          action: "package.apply",
          summary: `Applied change package ${pkg.packageId}: ${pkg.summary}`,
          packageId: pkg.packageId,
        });

        const changedIds = new Set(batch.planned.map((p) => p.recordId));
        const effects = await detectPotentialEffects(tx, pkg.projectId, impactTriggers(batch.planned), changedIds);
        const titles = new Map(
          (
            await tx.record.findMany({
              where: { projectId: pkg.projectId, id: { in: pkg.relatedRecords.map((r) => r.recordId) } },
              select: { id: true, title: true },
            })
          ).map((r) => [r.id, r.title]),
        );

        const reviewItems: PackageApplyResult["reviewItems"] = [
          ...pkg.relatedRecords.map((r) => ({
            id: newId("rvw"),
            recordId: r.recordId,
            title: titles.get(r.recordId) ?? r.recordId,
            origin: "package_note" as const,
            note: r.note,
            triggeredByRecordId: null,
          })),
          ...effects.map((e) => ({
            id: newId("rvw"),
            recordId: e.recordId,
            title: e.title,
            origin: "detected_mention" as const,
            note: `Mentions ${e.matchedTerms.map((t) => `"${t}"`).join(", ")}, which changed in this package (${e.triggeredByTitle}). Not modified; review for consistency.`,
            triggeredByRecordId: e.triggeredByRecordId,
          })),
        ];
        for (const item of reviewItems) {
          await tx.reviewItem.create({
            data: {
              id: item.id,
              projectId: pkg.projectId,
              recordId: item.recordId,
              packageId: pkg.packageId,
              triggeredByRecordId: item.triggeredByRecordId,
              origin: item.origin,
              note: item.note,
            },
          });
        }

        const appliedAt = new Date();
        const result: PackageApplyResult = {
          packageId: pkg.packageId,
          projectId: pkg.projectId,
          summary: pkg.summary,
          contentHash,
          appliedAt: appliedAt.toISOString(),
          sourceId: batch.sourceId,
          auditEntryId: batch.auditEntryId,
          changes: batch.outcomes.map((o) => ({
            index: o.index,
            op: o.kind,
            recordId: o.recordId,
            type: o.type,
            title: o.title,
            previousRevision: o.previousRevision,
            newRevision: o.newRevision,
          })),
          createdRecordIds: batch.outcomes.filter((o) => o.previousRevision === null).map((o) => o.recordId),
          reviewItems,
        };

        await tx.changePackage.create({
          data: {
            packageId: pkg.packageId,
            projectId: pkg.projectId,
            formatVersion: pkg.formatVersion,
            contentHash,
            summary: pkg.summary,
            status: "applied",
            rawJson: JSON.stringify(pkg),
            resultJson: JSON.stringify(result),
            appliedAt,
          },
        });

        if (options.beforeCommit) await options.beforeCommit(tx);
        return result;
      },
      { timeout: 30_000 },
    );
    return { status: "applied", result, warnings: a.issues.filter((i) => i.severity === "warning") };
  } catch (error) {
    if (error instanceof AlreadyAppliedSignal) return { status: "already_applied", result: error.result };
    if (error instanceof MutationRejectedError) return { status: "rejected", issues: error.issues };
    if (isUniqueConstraintError(error)) {
      const existing = await db.changePackage.findUnique({
        where: { projectId_packageId: { projectId: pkg.projectId, packageId: pkg.packageId } },
      });
      if (existing && existing.contentHash === contentHash) {
        return { status: "already_applied", result: JSON.parse(existing.resultJson) as PackageApplyResult };
      }
      return {
        status: "rejected",
        issues: [errorIssue("PACKAGE_ID_CONFLICT", `Package ID ${pkg.packageId} conflicts with an existing package.`)],
      };
    }
    throw error;
  }
}

export interface ChangePackageSummary {
  packageId: string;
  summary: string;
  status: string;
  appliedAt: Date;
  result: PackageApplyResult;
}

export async function listChangePackages(db: DbOrTx, projectId: string): Promise<ChangePackageSummary[]> {
  const rows = await db.changePackage.findMany({ where: { projectId }, orderBy: { appliedAt: "desc" } });
  return rows.map((r) => ({
    packageId: r.packageId,
    summary: r.summary,
    status: r.status,
    appliedAt: r.appliedAt,
    result: JSON.parse(r.resultJson) as PackageApplyResult,
  }));
}
