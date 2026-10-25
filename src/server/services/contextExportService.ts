import { changePackageJsonSchema } from "@/changePackage/jsonSchema";
import { CHANGE_PACKAGE_FORMAT, CHANGE_PACKAGE_FORMAT_VERSION } from "@/changePackage/schema.v1";
import type { JsonObject } from "@/domain/json";
import { toRecordView } from "@/domain/records";
import type { ContentClass, RecordType } from "@/domain/recordTypes";
import type { AuthorityStatus } from "@/domain/statuses";
import type { DbOrTx } from "../db";
import { NotFoundError } from "./errors";

export const CONTEXT_BUNDLE_FORMAT = "wordly.context-bundle";
export const CONTEXT_BUNDLE_FORMAT_VERSION = 1;

export interface ContextBundleRecord {
  id: string;
  type: RecordType;
  contentClass: ContentClass;
  title: string;
  revision: number;
  authorityStatus: AuthorityStatus;
  supersededByRecordId: string | null;
  protected: boolean;
  body: string;
  fields: JsonObject;
  updatedAt: string;
}

export interface ContextBundle {
  format: typeof CONTEXT_BUNDLE_FORMAT;
  formatVersion: typeof CONTEXT_BUNDLE_FORMAT_VERSION;
  exportedAt: string;
  workspaceId: string;
  workspaceName: string;
  projectId: string;
  projectTitle: string;
  selection: { recordIds: string[] | null; types: RecordType[] | null };
  records: ContextBundleRecord[];
  changePackageInstructions: string[];
  changePackageTemplate: Record<string, unknown>;
  changePackageSchema: Record<string, unknown>;
}

export interface ExportSelection {
  recordIds?: string[];
  types?: RecordType[];
  includeSchema?: boolean;
}

export const CHANGE_PACKAGE_INSTRUCTIONS: string[] = [
  `Return a single JSON object with "format": "${CHANGE_PACKAGE_FORMAT}" and "formatVersion": ${CHANGE_PACKAGE_FORMAT_VERSION}, matching changePackageSchema.`,
  "Use the workspaceId and projectId from this bundle.",
  'Choose a new, unique packageId (e.g. "pkg_2026-10-25_mara-backstory"). Never reuse a packageId for different content.',
  "Reference existing records only by the exact id values in this bundle. For update_record and set_authority_status, set expectedRevision to the record's current revision from this bundle.",
  "Include only changes the author explicitly approved. Do not add speculative edits.",
  'Set approval.status to "approved" only when the author explicitly approved applying these changes; otherwise use "proposed". Record the author\'s approval wording in approval.statement.',
  "Set each operation's authorityStatus/status explicitly. Recording a proposed or unresolved decision is allowed; it stays proposed/unresolved.",
  'Use scope "reference" for worldbuilding, dossiers, outlines, decisions, and notes. Only use scope "manuscript" if the author explicitly asked to change chapter prose.',
  "Records with protected: true must not be changed unless the author explicitly authorized it; list such record ids in protectedOverrides.",
  "Do not propagate a change into other records that merely mention it. List them in relatedRecords with a note for later review instead.",
  "Supported operations: create_record, update_record (title.replace, body.replace, fields.set, fields.unset), set_authority_status (optionally supersededBy). There is no delete.",
  "Add source.conversationLabel (and source.url when available) identifying this conversation.",
];

export async function exportContextBundle(
  db: DbOrTx,
  projectId: string,
  selection: ExportSelection = {},
): Promise<ContextBundle> {
  const project = await db.project.findUnique({ where: { id: projectId }, include: { workspace: true } });
  if (!project) throw new NotFoundError(`Project ${projectId} not found`);

  const rows = await db.record.findMany({
    where: {
      projectId,
      ...(selection.recordIds ? { id: { in: selection.recordIds } } : {}),
      ...(selection.types ? { type: { in: selection.types } } : {}),
    },
    orderBy: [{ type: "asc" }, { title: "asc" }],
  });

  const records: ContextBundleRecord[] = rows.map(toRecordView).map((r) => ({
    id: r.id,
    type: r.type,
    contentClass: r.contentClass,
    title: r.title,
    revision: r.currentRevision,
    authorityStatus: r.authorityStatus,
    supersededByRecordId: r.supersededByRecordId,
    protected: r.protected,
    body: r.body,
    fields: r.fields,
    updatedAt: r.updatedAt.toISOString(),
  }));

  return {
    format: CONTEXT_BUNDLE_FORMAT,
    formatVersion: CONTEXT_BUNDLE_FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    workspaceId: project.workspaceId,
    workspaceName: project.workspace.name,
    projectId: project.id,
    projectTitle: project.title,
    selection: { recordIds: selection.recordIds ?? null, types: selection.types ?? null },
    records,
    changePackageInstructions: CHANGE_PACKAGE_INSTRUCTIONS,
    changePackageTemplate: {
      format: CHANGE_PACKAGE_FORMAT,
      formatVersion: CHANGE_PACKAGE_FORMAT_VERSION,
      packageId: "pkg_<unique-id>",
      workspaceId: project.workspaceId,
      projectId: project.id,
      summary: "<what changed and why>",
      source: { conversationLabel: "<conversation name>", url: "<conversation url, optional>" },
      approval: { status: "approved", statement: "<the author's approval wording>" },
      scope: "reference",
      protectedOverrides: [],
      operations: [],
      relatedRecords: [],
    },
    changePackageSchema: selection.includeSchema === false ? {} : changePackageJsonSchema(),
  };
}
