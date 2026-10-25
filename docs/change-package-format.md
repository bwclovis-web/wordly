# Change package format (v1)

A change package is a JSON document describing a bounded set of edits to a
project's records. It is how decisions approved in a ChatGPT conversation are
brought into Wordly Editor without replacing whole reference-file collections.

- Machine-readable schema: [`schemas/change-package.v1.schema.json`](schemas/change-package.v1.schema.json)
  (regenerate with `pnpm schema:export`; source of truth is `src/changePackage/schema.v1.ts`).
- Example: [`../examples/sample-change-package.json`](../examples/sample-change-package.json)
  (applies to the seeded demo project).

## Top-level fields

| Field | Required | Description |
| --- | --- | --- |
| `format` | yes | Always `"wordly.change-package"`. |
| `formatVersion` | yes | Always `1`. Other versions are rejected. |
| `packageId` | yes | `pkg_` + 6-80 of `[A-Za-z0-9_-]`. Unique per change set; used for idempotency. |
| `workspaceId`, `projectId` | yes | Must match the project the package is imported into. |
| `summary` | yes | Human-readable description of the change set. |
| `source` | no | `{ conversationLabel?, url? }`. Stored as provenance on every revision created. |
| `approval` | yes | `{ status: "approved" \| "proposed", statement? }`. Must be stated explicitly. |
| `scope` | no | `"reference"` (default) or `"manuscript"`. See [Protection](#protection). |
| `protectedOverrides` | no | Record IDs of protected records this package is explicitly authorized to change. |
| `operations` | yes | 1-500 operations, applied in order, all-or-nothing. |
| `relatedRecords` | no | `[{ recordId, note }]`. Records to flag for later review. Never edited. |

Unknown fields are rejected everywhere (top level and inside operations).

## Approval

- Only packages with `approval.status: "approved"` can be applied. A
  `"proposed"` package can be validated and previewed, but not applied.
- Approval is never inferred from a filename, from importing a file, or from
  the presence of an operation.
- An explicit request such as "update the working files with the decisions I
  approved" is the authorization. The importer does not add another approval
  step, except when the package changes protected records. In that case the
  author must also confirm the protected changes when applying.
- Per-record canon status is separate from package approval. An approved
  package may record a decision as `proposed` or `unresolved`, and that status
  is kept as written.

## Operations

All operations accept an optional `note` (shown in preview).

### `create_record`

```json
{ "op": "create_record", "newRecordId": "rec_note_mara_age", "type": "continuity_note",
  "title": "Mara's age continuity", "body": "...", "fields": {}, "authorityStatus": "approved" }
```

- `newRecordId` is optional. If omitted, the server assigns an ID, which the
  change summary reports. Supply it when other operations or `relatedRecords`
  need to reference the new record.
- `type`: one of `manuscript_chapter`, `chapter_outline`, `story_architecture`,
  `character_dossier`, `worldbuilding`, `canon_decision`, `continuity_note`,
  `reference_note`.
- `authorityStatus` is required: `draft | proposed | approved | superseded | unresolved`.

### `update_record`

```json
{ "op": "update_record", "recordId": "rec_demo_mara_dossier", "expectedRevision": 1,
  "changes": {
    "title":  { "replace": "..." },
    "body":   { "replace": "..." },
    "fields": { "set": { "age": 34 }, "unset": ["oldKey"] }
  },
  "authorityStatus": "approved" }
```

- `expectedRevision` must equal the record's current revision, or the package is rejected as stale.
- `changes` members are all optional, but the operation must change something.
- `fields.set` replaces the listed keys. `fields.unset` removes keys. Other keys are untouched.
- `authorityStatus` is optional. If omitted, the status is unchanged.

### `set_authority_status`

```json
{ "op": "set_authority_status", "recordId": "rec_demo_decision_mara_age", "expectedRevision": 2,
  "status": "superseded", "supersededBy": "rec_decision_mara_age_v2" }
```

- `supersededBy` is only allowed with `status: "superseded"`. It must reference
  a record in the project, or one created earlier in the same package.

There is **no delete operation**. Any other `op` value is rejected with `UNSUPPORTED_OPERATION`.

## Protection

Manuscript prose is protected independently of reference notes:

- **Content class.** `manuscript_chapter` records are manuscript content. All
  other types are reference content. A `scope: "reference"` package can never
  create or modify manuscript content, even with overrides.
- **Protection flag.** Any record can be flagged `protected` in the app
  (manuscript chapters are protected by default). A protected record can be
  changed only if its ID is in `protectedOverrides` and the author confirms
  when applying. Packages cannot change the protection flag itself.
- To edit chapter prose through a package, you need all three:
  `scope: "manuscript"`, the chapter ID in `protectedOverrides`, and the
  author's confirmation at apply time.

## Potential effects versus explicit changes

Changes are never propagated automatically. The preview lists explicit
operations separately from **potentially affected** records, which are other
records whose text mentions a changed record's title, `fields.name`, or
`fields.aliases`. When the package is applied, those records and any
`relatedRecords` become open review items. None of them is modified.

## Validation and application

1. The whole package is validated, and every problem is reported at once.
2. The preview shows before/after diffs (word-level body diff, per-key field
   diff, status change), blocked operations, and potential effects.
3. Apply runs in a single database transaction. It re-checks revisions and
   protection, appends new revisions (old revisions are never modified), and
   writes provenance, an audit entry, review items, and the package record.
4. Any failure rolls back everything, leaving existing data unchanged.

### Idempotency

The `packageId` is recorded per project, together with a hash of the
normalized package content. The key is (`projectId`, `packageId`).

- Same `packageId` and same content in the same project: the result is
  `already_applied`. Nothing is written, and the original change summary is returned.
- Same `packageId` but different content: the package is rejected with `PACKAGE_ID_CONFLICT`.
- A workspace restored from backup as a copy (new IDs) keeps its own record of
  applied packages, so a package already applied before the backup is
  `already_applied` in the copy as well, and applying a new package to one copy
  never marks it applied in the other.

## Issue codes

| Code | Meaning |
| --- | --- |
| `INVALID_JSON` | Input is not JSON. |
| `SCHEMA_INVALID` | Field missing, wrong type, or unknown field. |
| `UNSUPPORTED_FORMAT` / `UNSUPPORTED_FORMAT_VERSION` | Not a v1 change package. |
| `UNSUPPORTED_OPERATION` | `op` is not one of the three supported operations. |
| `APPROVAL_MISSING` | No explicit `approval.status`. |
| `NOT_APPROVED` | `approval.status` is `"proposed"`; preview only. |
| `TARGET_MISMATCH` | Workspace/project does not match the import target. |
| `PACKAGE_ID_CONFLICT` | `packageId` reused with different content. |
| `RECORD_NOT_FOUND` | Referenced record is not in this project. |
| `RECORD_ID_CONFLICT` | `newRecordId` already exists. |
| `DUPLICATE_TARGET` | Two operations target the same record. |
| `STALE_REVISION` | `expectedRevision` is not the current revision. |
| `SCOPE_VIOLATION` | Reference-scope package touches manuscript content. |
| `PROTECTED_RECORD` | Protected record not listed in `protectedOverrides`. |
| `PROTECTED_CONFIRMATION_REQUIRED` | Author did not confirm protected changes. |
| `INVALID_CHANGE` | Empty update, empty title, field both set and unset, misplaced `supersededBy`. |
| `INVALID_REFERENCE` | `supersededBy` or `relatedRecords` points to an unknown record. |
| `NO_EFFECTIVE_CHANGE` | Operation would not change the record. |
| `UNUSED_PROTECTED_OVERRIDE` (warning) | Override listed but not needed. |
| `FIELD_NOT_PRESENT` (warning) | `unset` names a field that does not exist. |
