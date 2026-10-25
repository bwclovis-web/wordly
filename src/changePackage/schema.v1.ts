import { z } from "zod";
import { PACKAGE_ID_PATTERN, PROJECT_ID_PATTERN, RECORD_ID_PATTERN, WORKSPACE_ID_PATTERN } from "@/domain/ids";
import { RECORD_TYPES } from "@/domain/recordTypes";
import { AUTHORITY_STATUSES, MUTATION_SCOPES } from "@/domain/statuses";

export const CHANGE_PACKAGE_FORMAT = "wordly.change-package";
export const CHANGE_PACKAGE_FORMAT_VERSION = 1;

export const SUPPORTED_OPERATIONS = ["create_record", "update_record", "set_authority_status"] as const;
export type SupportedOperation = (typeof SUPPORTED_OPERATIONS)[number];

const recordId = z.string().regex(RECORD_ID_PATTERN, "Record IDs look like rec_XXXXXX");
const fieldsObject = z.record(z.string().min(1), z.json());
const authorityStatus = z.enum(AUTHORITY_STATUSES);
const note = z.string().max(2000).optional();

const createRecordOp = z
  .object({
    op: z.literal("create_record"),
    newRecordId: recordId.optional(),
    type: z.enum(RECORD_TYPES),
    title: z.string().min(1).max(500),
    body: z.string().max(2_000_000).default(""),
    fields: fieldsObject.default({}),
    authorityStatus,
    note,
  })
  .strict();

const updateRecordOp = z
  .object({
    op: z.literal("update_record"),
    recordId,
    expectedRevision: z.number().int().min(1),
    changes: z
      .object({
        title: z.object({ replace: z.string().min(1).max(500) }).strict().optional(),
        body: z.object({ replace: z.string().max(2_000_000) }).strict().optional(),
        fields: z
          .object({
            set: fieldsObject.optional(),
            unset: z.array(z.string().min(1)).optional(),
          })
          .strict()
          .optional(),
      })
      .strict(),
    authorityStatus: authorityStatus.optional(),
    note,
  })
  .strict();

const setAuthorityStatusOp = z
  .object({
    op: z.literal("set_authority_status"),
    recordId,
    expectedRevision: z.number().int().min(1),
    status: authorityStatus,
    supersededBy: recordId.optional(),
    note,
  })
  .strict();

export const operationSchema = z.discriminatedUnion("op", [createRecordOp, updateRecordOp, setAuthorityStatusOp]);

export const changePackageV1Schema = z
  .object({
    format: z.literal(CHANGE_PACKAGE_FORMAT),
    formatVersion: z.literal(CHANGE_PACKAGE_FORMAT_VERSION),
    packageId: z.string().regex(PACKAGE_ID_PATTERN, "Package IDs look like pkg_XXXXXX"),
    workspaceId: z.string().regex(WORKSPACE_ID_PATTERN),
    projectId: z.string().regex(PROJECT_ID_PATTERN),
    summary: z.string().min(1).max(4000),
    source: z
      .object({
        conversationLabel: z.string().max(500).optional(),
        url: z.url().max(2000).optional(),
      })
      .strict()
      .optional(),
    approval: z
      .object({
        status: z.enum(["approved", "proposed"]),
        statement: z.string().max(4000).optional(),
      })
      .strict(),
    scope: z.enum(MUTATION_SCOPES).default("reference"),
    protectedOverrides: z.array(recordId).default([]),
    operations: z.array(operationSchema).min(1).max(500),
    relatedRecords: z
      .array(z.object({ recordId, note: z.string().min(1).max(2000) }).strict())
      .default([]),
  })
  .strict();

export type ChangePackageV1 = z.output<typeof changePackageV1Schema>;
export type ChangePackageV1Input = z.input<typeof changePackageV1Schema>;
export type PackageOperation = ChangePackageV1["operations"][number];
