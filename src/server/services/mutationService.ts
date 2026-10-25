import { newId } from "@/domain/ids";
import { errorIssue, warningIssue, type Issue } from "@/domain/issues";
import { stableStringify, type JsonObject } from "@/domain/json";
import { snapshotHash, snapshotOf, toRecordView, type RecordSnapshot, type RecordView } from "@/domain/records";
import { defaultProtectedFor, type RecordType } from "@/domain/recordTypes";
import type { AuthorityStatus, MutationScope, SourceKind } from "@/domain/statuses";
import type { Db, DbOrTx, Tx } from "../db";
import { writeAudit } from "./auditService";
import { MutationRejectedError, NotFoundError, StaleRevisionError } from "./errors";
import { checkCreateAllowed, checkWriteAllowed } from "./protection";

/*
 * The only code path that writes Record and Revision rows. The UI, the
 * change-package importer, and any future API/MCP adapter all go through here.
 */

export interface CreateRecordMutation {
  kind: "create_record";
  /** Caller-chosen stable ID; generated when omitted. */
  recordId?: string;
  type: RecordType;
  title: string;
  body: string;
  fields: JsonObject;
  authorityStatus: AuthorityStatus;
  /** Request protection at creation. Cannot lower the type's default (manuscript is always protected). */
  protected?: boolean;
  operationIndex?: number;
}

export interface UpdateRecordMutation {
  kind: "update_record";
  recordId: string;
  expectedRevision: number;
  changes: {
    title?: string;
    body?: string;
    fields?: { set?: JsonObject; unset?: string[] };
  };
  authorityStatus?: AuthorityStatus;
  operationIndex?: number;
}

export interface SetAuthorityStatusMutation {
  kind: "set_authority_status";
  recordId: string;
  expectedRevision: number;
  status: AuthorityStatus;
  supersededBy?: string | null;
  operationIndex?: number;
}

export type Mutation = CreateRecordMutation | UpdateRecordMutation | SetAuthorityStatusMutation;

export interface MutationSource {
  kind: SourceKind;
  conversationLabel?: string | null;
  url?: string | null;
  packageId?: string | null;
  originalFilename?: string | null;
}

export interface MutationContext {
  projectId: string;
  actor: string;
  source: MutationSource;
  scope: MutationScope;
  protectedOverrides: ReadonlySet<string>;
}

export interface PlannedMutation {
  index: number;
  mutation: Mutation;
  recordId: string;
  type: RecordType;
  protected: boolean;
  before: RecordSnapshot | null;
  beforeRevision: number | null;
  after: RecordSnapshot;
  usesProtectedOverride: boolean;
}

export interface MutationPlan {
  issues: Issue[];
  planned: PlannedMutation[];
}

export interface MutationOutcome {
  index: number;
  kind: Mutation["kind"];
  recordId: string;
  type: RecordType;
  title: string;
  previousRevision: number | null;
  newRevision: number;
}

export interface AppliedBatch {
  sourceId: string;
  auditEntryId: string;
  outcomes: MutationOutcome[];
  planned: PlannedMutation[];
}

export interface AuditSpec {
  action: string;
  summary: string;
  packageId?: string | null;
}

function referencedIds(mutations: readonly Mutation[]): string[] {
  const ids = new Set<string>();
  for (const m of mutations) {
    if (m.kind === "create_record") {
      if (m.recordId) ids.add(m.recordId);
    } else {
      ids.add(m.recordId);
    }
    if (m.kind === "set_authority_status" && m.supersededBy) ids.add(m.supersededBy);
  }
  return [...ids];
}

/**
 * Validates a batch against current state without writing. Collects every
 * issue rather than stopping at the first. Planned entries are included even
 * for mutations with issues, whenever a before/after can be computed.
 */
export async function planMutations(
  db: DbOrTx,
  ctx: MutationContext,
  mutations: readonly Mutation[],
): Promise<MutationPlan> {
  const issues: Issue[] = [];
  const planned: PlannedMutation[] = [];

  if (mutations.length === 0) {
    issues.push(errorIssue("EMPTY_BATCH", "No operations to apply."));
    return { issues, planned };
  }

  const rows = await db.record.findMany({ where: { id: { in: referencedIds(mutations) } } });
  const existing = new Map<string, RecordView>(rows.map((r) => [r.id, toRecordView(r)]));
  const createdIds = new Set<string>();
  const targeted = new Set<string>();

  const inProject = (id: string) => {
    const rec = existing.get(id);
    return rec && rec.projectId === ctx.projectId ? rec : undefined;
  };

  mutations.forEach((m, index) => {
    const opIndex = m.operationIndex ?? index;
    const at = (field?: string) => ({
      operationIndex: opIndex,
      path: field ? `operations.${opIndex}.${field}` : `operations.${opIndex}`,
    });

    if (m.kind === "create_record") {
      const recordId = m.recordId ?? newId("rec");
      if (m.recordId && existing.has(m.recordId)) {
        issues.push(
          errorIssue("RECORD_ID_CONFLICT", `Record ID ${m.recordId} already exists.`, {
            ...at("newRecordId"),
            recordId,
          }),
        );
      }
      if (targeted.has(recordId)) {
        issues.push(
          errorIssue("DUPLICATE_TARGET", `Record ${recordId} is targeted by more than one operation.`, {
            ...at(),
            recordId,
          }),
        );
      }
      targeted.add(recordId);
      createdIds.add(recordId);
      issues.push(...checkCreateAllowed(m.type, ctx, at()));
      if (!m.title.trim()) {
        issues.push(errorIssue("INVALID_CHANGE", "Title must not be empty.", at("title")));
      }
      planned.push({
        index: opIndex,
        mutation: m,
        recordId,
        type: m.type,
        protected: m.protected === true || defaultProtectedFor(m.type),
        before: null,
        beforeRevision: null,
        after: {
          title: m.title,
          body: m.body,
          fields: m.fields,
          authorityStatus: m.authorityStatus,
          supersededByRecordId: null,
        },
        usesProtectedOverride: false,
      });
      return;
    }

    const record = inProject(m.recordId);
    if (!record) {
      issues.push(
        errorIssue("RECORD_NOT_FOUND", `Record ${m.recordId} does not exist in this project.`, {
          ...at("recordId"),
          recordId: m.recordId,
        }),
      );
      return;
    }
    if (targeted.has(record.id)) {
      issues.push(
        errorIssue("DUPLICATE_TARGET", `Record ${record.id} is targeted by more than one operation.`, {
          ...at(),
          recordId: record.id,
        }),
      );
    }
    targeted.add(record.id);

    if (m.expectedRevision !== record.currentRevision) {
      issues.push(
        errorIssue(
          "STALE_REVISION",
          `Record ${record.id} is at revision ${record.currentRevision}, but the change expected revision ${m.expectedRevision}.`,
          { ...at("expectedRevision"), recordId: record.id },
        ),
      );
    }
    issues.push(...checkWriteAllowed(record, ctx, at()));

    const before = snapshotOf(record);
    const after: RecordSnapshot = { ...before, fields: { ...before.fields } };

    if (m.kind === "update_record") {
      const { title, body, fields } = m.changes;
      if (title === undefined && body === undefined && !fields && m.authorityStatus === undefined) {
        issues.push(errorIssue("INVALID_CHANGE", "Update contains no changes.", { ...at("changes"), recordId: record.id }));
      }
      if (title !== undefined) {
        if (!title.trim()) {
          issues.push(errorIssue("INVALID_CHANGE", "Title must not be empty.", { ...at("changes.title"), recordId: record.id }));
        }
        after.title = title;
      }
      if (body !== undefined) after.body = body;
      if (fields) {
        const set = fields.set ?? {};
        const unset = fields.unset ?? [];
        for (const key of unset) {
          if (key in set) {
            issues.push(
              errorIssue("INVALID_CHANGE", `Field "${key}" is both set and unset.`, {
                ...at("changes.fields"),
                recordId: record.id,
              }),
            );
          } else if (!(key in after.fields)) {
            issues.push(
              warningIssue("FIELD_NOT_PRESENT", `Field "${key}" is not present on ${record.id}; unset has no effect.`, {
                ...at("changes.fields.unset"),
                recordId: record.id,
              }),
            );
          }
          delete after.fields[key];
        }
        Object.assign(after.fields, set);
      }
      if (m.authorityStatus !== undefined) {
        after.authorityStatus = m.authorityStatus;
        if (m.authorityStatus !== "superseded") after.supersededByRecordId = null;
      }
    } else {
      after.authorityStatus = m.status;
      if (m.status === "superseded") {
        after.supersededByRecordId = m.supersededBy ?? null;
        if (m.supersededBy) {
          if (m.supersededBy === record.id) {
            issues.push(
              errorIssue("INVALID_REFERENCE", "A record cannot supersede itself.", {
                ...at("supersededBy"),
                recordId: record.id,
              }),
            );
          } else if (!inProject(m.supersededBy) && !mutations.some((o) => o.kind === "create_record" && o.recordId === m.supersededBy)) {
            issues.push(
              errorIssue("INVALID_REFERENCE", `supersededBy ${m.supersededBy} does not exist in this project.`, {
                ...at("supersededBy"),
                recordId: record.id,
              }),
            );
          }
        }
      } else {
        if (m.supersededBy) {
          issues.push(
            errorIssue("INVALID_CHANGE", "supersededBy is only allowed when status is \"superseded\".", {
              ...at("supersededBy"),
              recordId: record.id,
            }),
          );
        }
        after.supersededByRecordId = null;
      }
    }

    if (snapshotHash(before) === snapshotHash(after)) {
      issues.push(
        errorIssue("NO_EFFECTIVE_CHANGE", `Operation would not change record ${record.id}.`, {
          ...at(),
          recordId: record.id,
        }),
      );
    }

    planned.push({
      index: opIndex,
      mutation: m,
      recordId: record.id,
      type: record.type,
      protected: record.protected,
      before,
      beforeRevision: record.currentRevision,
      after,
      usesProtectedOverride: record.protected && ctx.protectedOverrides.has(record.id),
    });
  });

  return { issues, planned };
}

async function writeRevision(tx: Tx, recordId: string, revisionNumber: number, snapshot: RecordSnapshot, sourceId: string) {
  await tx.revision.create({
    data: {
      id: newId("rev"),
      recordId,
      revisionNumber,
      title: snapshot.title,
      body: snapshot.body,
      fields: stableStringify(snapshot.fields),
      authorityStatus: snapshot.authorityStatus,
      supersededByRecordId: snapshot.supersededByRecordId,
      contentHash: snapshotHash(snapshot),
      sourceId,
    },
  });
}

/**
 * Re-plans inside the transaction (so guards and revision checks see the
 * committed state), then writes every mutation or throws to roll back.
 */
export async function applyMutationsInTx(
  tx: Tx,
  ctx: MutationContext,
  mutations: readonly Mutation[],
  audit: AuditSpec,
): Promise<AppliedBatch> {
  const plan = await planMutations(tx, ctx, mutations);
  if (plan.issues.some((i) => i.severity === "error")) {
    throw new MutationRejectedError(plan.issues);
  }

  const sourceId = newId("src");
  await tx.source.create({
    data: {
      id: sourceId,
      projectId: ctx.projectId,
      kind: ctx.source.kind,
      actor: ctx.actor,
      conversationLabel: ctx.source.conversationLabel ?? null,
      url: ctx.source.url ?? null,
      packageId: ctx.source.packageId ?? null,
      originalFilename: ctx.source.originalFilename ?? null,
    },
  });

  const outcomes: MutationOutcome[] = [];
  for (const p of plan.planned) {
    const data = {
      title: p.after.title,
      body: p.after.body,
      fields: stableStringify(p.after.fields),
      authorityStatus: p.after.authorityStatus,
      supersededByRecordId: p.after.supersededByRecordId,
    };
    let newRevision: number;
    if (p.beforeRevision === null) {
      newRevision = 1;
      await tx.record.create({
        data: {
          id: p.recordId,
          projectId: ctx.projectId,
          type: p.type,
          protected: p.protected,
          currentRevision: newRevision,
          ...data,
        },
      });
    } else {
      newRevision = p.beforeRevision + 1;
      const result = await tx.record.updateMany({
        where: { id: p.recordId, projectId: ctx.projectId, currentRevision: p.beforeRevision },
        data: { ...data, currentRevision: newRevision },
      });
      if (result.count !== 1) {
        throw new StaleRevisionError(
          errorIssue("STALE_REVISION", `Record ${p.recordId} changed while the batch was being applied.`, {
            recordId: p.recordId,
            operationIndex: p.index,
          }),
        );
      }
    }
    await writeRevision(tx, p.recordId, newRevision, p.after, sourceId);
    outcomes.push({
      index: p.index,
      kind: p.mutation.kind,
      recordId: p.recordId,
      type: p.type,
      title: p.after.title,
      previousRevision: p.beforeRevision,
      newRevision,
    });
  }

  const auditEntryId = await writeAudit(tx, {
    projectId: ctx.projectId,
    action: audit.action,
    actor: ctx.actor,
    summary: audit.summary,
    sourceId,
    packageId: audit.packageId ?? null,
    details: {
      scope: ctx.scope,
      sourceKind: ctx.source.kind,
      protectedOverridesUsed: plan.planned.filter((p) => p.usesProtectedOverride).map((p) => p.recordId),
      outcomes: outcomes.map((o) => ({
        index: o.index,
        kind: o.kind,
        recordId: o.recordId,
        type: o.type,
        title: o.title,
        previousRevision: o.previousRevision,
        newRevision: o.newRevision,
      })),
    },
  });

  return { sourceId, auditEntryId, outcomes, planned: plan.planned };
}

export async function applyMutations(
  db: Db,
  ctx: MutationContext,
  mutations: readonly Mutation[],
  audit: AuditSpec,
): Promise<AppliedBatch> {
  return db.$transaction((tx) => applyMutationsInTx(tx, ctx, mutations, audit));
}

/**
 * Protection is a record-level flag outside revisioned content. It is changed
 * only through this function, never through a mutation batch or change package.
 */
export async function setRecordProtection(
  db: Db,
  input: { projectId: string; recordId: string; protected: boolean; actor: string },
): Promise<void> {
  await db.$transaction((tx) => setRecordProtectionInTx(tx, input));
}

export async function setRecordProtectionInTx(
  tx: Tx,
  input: { projectId: string; recordId: string; protected: boolean; actor: string },
): Promise<void> {
  const record = await tx.record.findFirst({ where: { id: input.recordId, projectId: input.projectId } });
  if (!record) throw new NotFoundError(`Record ${input.recordId} not found`);
  if (record.protected === input.protected) return;
  await tx.record.update({ where: { id: record.id }, data: { protected: input.protected } });
  await writeAudit(tx, {
    projectId: input.projectId,
    action: "record.protection",
    actor: input.actor,
    summary: `${input.protected ? "Protected" : "Unprotected"} "${record.title}"`,
    details: { recordId: record.id, protected: input.protected },
  });
}
