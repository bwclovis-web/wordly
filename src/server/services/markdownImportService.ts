import { newId } from "@/domain/ids";
import { errorIssue, hasErrors, warningIssue, type Issue } from "@/domain/issues";
import { sha256 } from "@/domain/json";
import { contentClassOf, isRecordType, RECORD_TYPE_LABELS, RECORD_TYPES, type RecordType } from "@/domain/recordTypes";
import { isAuthorityStatus, type AuthorityStatus } from "@/domain/statuses";
import type { Db, DbOrTx } from "../db";
import { writeAudit } from "./auditService";
import { MutationRejectedError, NotFoundError } from "./errors";
import {
  applyMutationsInTx,
  planMutations,
  setRecordProtectionInTx,
  type Mutation,
  type MutationContext,
} from "./mutationService";

/*
 * Batch import of Markdown reference documents. Nothing is inferred: the
 * author picks document type, canon status and protection for every file, and
 * decides explicitly what happens to each file that looks like a duplicate.
 * Imports never create or modify manuscript chapters.
 */

export const IMPORTABLE_TYPES: readonly RecordType[] = RECORD_TYPES.filter((t) => contentClassOf(t) === "reference");
const MARKDOWN_EXTENSIONS = /\.(md|markdown)$/i;
export const MAX_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_FILES = 200;

export interface MarkdownFile {
  filename: string;
  content: string;
}

export type DuplicateReason = "same_content" | "same_title" | "same_filename";

export interface DuplicateCandidate {
  recordId: string;
  title: string;
  type: RecordType;
  authorityStatus: string;
  protected: boolean;
  currentRevision: number;
  reasons: DuplicateReason[];
}

export interface FilePreview {
  index: number;
  filename: string;
  byteSize: number;
  contentHash: string;
  suggestedTitle: string;
  excerpt: string;
  duplicates: DuplicateCandidate[];
  batchDuplicates: Array<{ index: number; filename: string; reasons: DuplicateReason[] }>;
  /** True when the author must choose create / replace / skip explicitly. */
  needsDecision: boolean;
  issues: Issue[];
}

export interface MarkdownImportPreview {
  files: FilePreview[];
  importableTypes: RecordType[];
}

export type ImportDecision =
  | { action: "create" }
  | { action: "replace"; recordId: string; expectedRevision: number }
  | { action: "skip" };

export interface MarkdownImportItem extends MarkdownFile {
  title: string;
  type: string;
  authorityStatus: string;
  protected: boolean;
  decision?: ImportDecision;
}

export interface MarkdownImportRequest {
  projectId: string;
  items: MarkdownImportItem[];
  conversationLabel?: string | null;
  /** Author confirmed replacing the protected records chosen in `decision`. */
  confirmProtectedReplacements?: boolean;
  actor?: string;
}

export interface ImportedFileResult {
  index: number;
  filename: string;
  action: "created" | "replaced" | "skipped";
  recordId: string | null;
  title: string;
  revision: number | null;
}

export type MarkdownImportOutcome =
  | { status: "applied"; batchId: string; results: ImportedFileResult[] }
  | { status: "rejected"; issues: Issue[] };

function stripBom(text: string): string {
  return text.replace(/^\uFEFF/, "");
}

/** Hash used for duplicate detection: ignores BOM, line-ending style and surrounding whitespace. */
function comparableHash(text: string): string {
  return sha256(stripBom(text).replace(/\r\n?/g, "\n").trim());
}

const normTitle = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();
const normFilename = (s: string) => s.trim().toLowerCase();

/** First level-1 heading, else the filename without extension. Only a suggestion; the author can edit it. */
export function suggestTitle(filename: string, content: string): string {
  const heading = stripBom(content).match(/^#[ \t]+(.+?)[ \t#]*$/m);
  if (heading) return heading[1].trim().slice(0, 300);
  const base = filename.replace(/^.*[\\/]/, "").replace(MARKDOWN_EXTENSIONS, "");
  return base.trim().slice(0, 300) || "Untitled";
}

function byteLength(text: string): number {
  return Buffer.byteLength(text, "utf8");
}

async function analyzeFiles(
  db: DbOrTx,
  projectId: string,
  files: ReadonlyArray<MarkdownFile & { title?: string }>,
): Promise<FilePreview[]> {
  const project = await db.project.findUnique({ where: { id: projectId } });
  if (!project) throw new NotFoundError(`Project ${projectId} not found`);

  const [records, imported] = await Promise.all([
    db.record.findMany({ where: { projectId } }),
    db.importedFile.findMany({ where: { projectId }, select: { originalFilename: true, content: true, recordId: true } }),
  ]);
  const byId = new Map(records.map((r) => [r.id, r]));
  const recordsByHash = new Map<string, string[]>();
  const add = (map: Map<string, string[]>, key: string, id: string) => {
    const list = map.get(key) ?? [];
    if (!list.includes(id)) list.push(id);
    map.set(key, list);
  };
  for (const r of records) add(recordsByHash, comparableHash(r.body), r.id);
  for (const f of imported) add(recordsByHash, comparableHash(f.content), f.recordId);
  const recordsByTitle = new Map<string, string[]>();
  for (const r of records) add(recordsByTitle, normTitle(r.title), r.id);
  const recordsByFilename = new Map<string, string[]>();
  for (const f of imported) add(recordsByFilename, normFilename(f.originalFilename), f.recordId);

  const prepared = files.map((f, index) => ({
    index,
    file: f,
    hash: comparableHash(f.content),
    title: (f.title ?? suggestTitle(f.filename, f.content)).trim(),
  }));

  return prepared.map(({ index, file, hash, title }) => {
    const issues: Issue[] = [];
    const at = { operationIndex: index, path: `items.${index}` };
    const size = byteLength(file.content);
    if (!MARKDOWN_EXTENSIONS.test(file.filename)) {
      issues.push(errorIssue("IMPORT_INVALID", `${file.filename}: only .md and .markdown files can be imported.`, at));
    }
    if (!stripBom(file.content).trim()) issues.push(errorIssue("IMPORT_INVALID", `${file.filename} is empty.`, at));
    if (size > MAX_FILE_BYTES) issues.push(errorIssue("IMPORT_INVALID", `${file.filename} is larger than 5 MB.`, at));
    if (file.content.includes("\uFFFD")) {
      issues.push(warningIssue("IMPORT_INVALID", `${file.filename} contains replacement characters; it may not be UTF-8 text.`, at));
    }

    const reasons = new Map<string, Set<DuplicateReason>>();
    const mark = (ids: string[] | undefined, reason: DuplicateReason) => {
      for (const id of ids ?? []) {
        if (!byId.has(id)) continue;
        const set = reasons.get(id) ?? new Set();
        set.add(reason);
        reasons.set(id, set);
      }
    };
    mark(recordsByHash.get(hash), "same_content");
    if (title) mark(recordsByTitle.get(normTitle(title)), "same_title");
    mark(recordsByFilename.get(normFilename(file.filename)), "same_filename");
    const duplicates: DuplicateCandidate[] = [...reasons].map(([id, set]) => {
      const r = byId.get(id)!;
      return {
        recordId: r.id,
        title: r.title,
        type: r.type as RecordType,
        authorityStatus: r.authorityStatus,
        protected: r.protected,
        currentRevision: r.currentRevision,
        reasons: [...set],
      };
    });

    const batchDuplicates = prepared
      .filter((o) => o.index !== index)
      .map((o) => {
        const rs: DuplicateReason[] = [];
        if (o.hash === hash) rs.push("same_content");
        if (title && normTitle(o.title) === normTitle(title)) rs.push("same_title");
        if (normFilename(o.file.filename) === normFilename(file.filename)) rs.push("same_filename");
        return { index: o.index, filename: o.file.filename, reasons: rs };
      })
      .filter((d) => d.reasons.length > 0);

    return {
      index,
      filename: file.filename,
      byteSize: size,
      contentHash: sha256(file.content),
      suggestedTitle: title,
      excerpt: stripBom(file.content).slice(0, 400),
      duplicates,
      batchDuplicates,
      needsDecision: duplicates.length > 0 || batchDuplicates.length > 0,
      issues,
    };
  });
}

/** Reads nothing but the database; writes nothing. */
export async function previewMarkdownImport(db: DbOrTx, projectId: string, files: MarkdownFile[]): Promise<MarkdownImportPreview> {
  if (files.length > MAX_FILES) throw new Error(`At most ${MAX_FILES} files per batch.`);
  return { files: await analyzeFiles(db, projectId, files), importableTypes: [...IMPORTABLE_TYPES] };
}

function itemContext(req: MarkdownImportRequest, item: MarkdownImportItem): MutationContext {
  const decision = item.decision;
  return {
    projectId: req.projectId,
    actor: req.actor ?? "author",
    source: { kind: "markdown_import", conversationLabel: req.conversationLabel ?? null, originalFilename: item.filename },
    scope: "reference",
    protectedOverrides: new Set(
      decision?.action === "replace" && req.confirmProtectedReplacements ? [decision.recordId] : [],
    ),
  };
}

function itemMutation(item: MarkdownImportItem, type: RecordType, status: AuthorityStatus, index: number): Mutation {
  const body = stripBom(item.content);
  if (item.decision?.action === "replace") {
    return {
      kind: "update_record",
      recordId: item.decision.recordId,
      expectedRevision: item.decision.expectedRevision,
      changes: { title: item.title.trim(), body },
      authorityStatus: status,
      operationIndex: index,
    };
  }
  return {
    kind: "create_record",
    type,
    title: item.title.trim(),
    body,
    fields: {},
    authorityStatus: status,
    protected: item.protected,
    operationIndex: index,
  };
}

/** Full validation against current state, collecting every problem. */
async function validateRequest(db: DbOrTx, req: MarkdownImportRequest): Promise<Issue[]> {
  const issues: Issue[] = [];
  if (req.items.length === 0) return [errorIssue("EMPTY_BATCH", "No files to import.")];
  if (req.items.length > MAX_FILES) return [errorIssue("IMPORT_INVALID", `At most ${MAX_FILES} files per batch.`)];

  const analysis = await analyzeFiles(db, req.projectId, req.items);
  const replaceTargets = new Map<string, number>();

  for (const [index, item] of req.items.entries()) {
    const at = (field: string) => ({ operationIndex: index, path: `items.${index}.${field}` });
    const name = item.filename;
    issues.push(...analysis[index].issues);
    if (item.decision?.action === "skip") continue;

    if (!isRecordType(item.type)) {
      issues.push(errorIssue("IMPORT_INVALID", `${name}: choose a document type.`, at("type")));
    } else if (contentClassOf(item.type) !== "reference") {
      issues.push(
        errorIssue("SCOPE_VIOLATION", `${name}: Markdown imports create reference documents only, not ${RECORD_TYPE_LABELS[item.type]}.`, at("type")),
      );
    }
    if (!isAuthorityStatus(item.authorityStatus)) {
      issues.push(errorIssue("IMPORT_INVALID", `${name}: choose a canon status explicitly.`, at("authorityStatus")));
    }
    if (typeof item.protected !== "boolean") {
      issues.push(errorIssue("IMPORT_INVALID", `${name}: choose whether the record is protected.`, at("protected")));
    }
    if (!item.title?.trim()) issues.push(errorIssue("IMPORT_INVALID", `${name}: title is required.`, at("title")));

    if (!item.decision && analysis[index].needsDecision) {
      issues.push(
        errorIssue(
          "IMPORT_DECISION_REQUIRED",
          `${name} looks like a duplicate (${describeDuplicates(analysis[index])}). Choose create new, replace, or skip.`,
          at("decision"),
        ),
      );
    }

    if (item.decision?.action === "replace") {
      const target = await db.record.findFirst({ where: { id: item.decision.recordId, projectId: req.projectId } });
      if (!target) {
        issues.push(errorIssue("RECORD_NOT_FOUND", `${name}: record ${item.decision.recordId} to replace was not found.`, at("decision")));
        continue;
      }
      const prior = replaceTargets.get(target.id);
      if (prior !== undefined) {
        issues.push(
          errorIssue("DUPLICATE_TARGET", `${name} and ${req.items[prior].filename} both replace "${target.title}".`, at("decision")),
        );
      }
      replaceTargets.set(target.id, index);
      if (isRecordType(item.type) && target.type !== item.type) {
        issues.push(
          errorIssue(
            "IMPORT_INVALID",
            `${name}: "${target.title}" is a ${RECORD_TYPE_LABELS[target.type as RecordType]}; a replacement keeps the record's type. Choose that type or create a new record.`,
            at("type"),
          ),
        );
      }
      if (target.protected && !req.confirmProtectedReplacements) {
        issues.push(
          errorIssue(
            "PROTECTED_CONFIRMATION_REQUIRED",
            `${name} replaces protected record "${target.title}". Confirm protected replacements to continue.`,
            { ...at("decision"), recordId: target.id },
          ),
        );
      }
      if (target.protected && !item.protected) {
        issues.push(
          warningIssue("IMPORT_INVALID", `${name}: "${target.title}" stays protected; imports never remove protection.`, at("protected")),
        );
      }
    }
  }

  if (hasErrors(issues)) return issues;

  for (const [index, item] of req.items.entries()) {
    if (item.decision?.action === "skip") continue;
    const plan = await planMutations(db, itemContext(req, item), [
      itemMutation(item, item.type as RecordType, item.authorityStatus as AuthorityStatus, index),
    ]);
    for (const issue of plan.issues) {
      const hint =
        issue.code === "NO_EFFECTIVE_CHANGE" ? " The file matches the record exactly; choose skip." : "";
      issues.push({ ...issue, operationIndex: index, message: `${item.filename}: ${issue.message}${hint}` });
    }
  }
  if (req.items.every((i) => i.decision?.action === "skip")) {
    issues.push(errorIssue("EMPTY_BATCH", "Every file is set to skip; nothing to import."));
  }
  return issues;
}

function describeDuplicates(f: FilePreview): string {
  const parts = f.duplicates.map((d) => `"${d.title}": ${d.reasons.join(", ").replace(/_/g, " ")}`);
  parts.push(...f.batchDuplicates.map((d) => `${d.filename} in this batch: ${d.reasons.join(", ").replace(/_/g, " ")}`));
  return parts.join("; ");
}

/** Validates everything first, then writes the whole batch in one transaction or nothing. */
export async function applyMarkdownImport(db: Db, req: MarkdownImportRequest): Promise<MarkdownImportOutcome> {
  const issues = await validateRequest(db, req);
  if (hasErrors(issues)) return { status: "rejected", issues };

  const batchId = newId("bat");
  const actor = req.actor ?? "author";
  try {
    const results = await db.$transaction(
      async (tx) => {
        const out: ImportedFileResult[] = [];
        for (const [index, item] of req.items.entries()) {
          if (item.decision?.action === "skip") {
            out.push({ index, filename: item.filename, action: "skipped", recordId: null, title: item.title.trim(), revision: null });
            continue;
          }
          const type = item.type as RecordType;
          const replacing = item.decision?.action === "replace";
          const batch = await applyMutationsInTx(
            tx,
            itemContext(req, item),
            [itemMutation(item, type, item.authorityStatus as AuthorityStatus, index)],
            {
              action: "markdown.import",
              summary: `${replacing ? "Replaced" : "Imported"} ${RECORD_TYPE_LABELS[type]} "${item.title.trim()}" from ${item.filename}`,
            },
          );
          const outcome = batch.outcomes[0];
          if (replacing && item.protected) {
            await setRecordProtectionInTx(tx, { projectId: req.projectId, recordId: outcome.recordId, protected: true, actor });
          }
          await tx.importedFile.create({
            data: {
              id: newId("imp"),
              projectId: req.projectId,
              batchId,
              originalFilename: item.filename,
              contentHash: sha256(item.content),
              content: item.content,
              byteSize: byteLength(item.content),
              recordId: outcome.recordId,
              action: replacing ? "replaced" : "created",
              revisionNumber: outcome.newRevision,
              sourceId: batch.sourceId,
            },
          });
          out.push({
            index,
            filename: item.filename,
            action: replacing ? "replaced" : "created",
            recordId: outcome.recordId,
            title: outcome.title,
            revision: outcome.newRevision,
          });
        }
        const counts = { created: 0, replaced: 0, skipped: 0 };
        for (const r of out) counts[r.action] += 1;
        await writeAudit(tx, {
          projectId: req.projectId,
          action: "markdown.import.batch",
          actor,
          summary: `Markdown import: ${counts.created} created, ${counts.replaced} replaced, ${counts.skipped} skipped`,
          details: {
            batchId,
            conversationLabel: req.conversationLabel ?? null,
            files: out.map((r) => ({
              filename: r.filename,
              action: r.action,
              recordId: r.recordId,
              revision: r.revision,
              type: req.items[r.index].type,
              authorityStatus: req.items[r.index].authorityStatus,
              protected: req.items[r.index].protected,
            })),
          },
        });
        return out;
      },
      { timeout: 120_000 },
    );
    return { status: "applied", batchId, results };
  } catch (error) {
    if (error instanceof MutationRejectedError) return { status: "rejected", issues: error.issues };
    throw error;
  }
}
