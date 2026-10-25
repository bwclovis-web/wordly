# Context bundle format (v1)

A context bundle is an export of selected current records. You paste or upload
it into a ChatGPT conversation so the assistant works from accurate project
state and can return a compatible [change package](change-package-format.md).

Export one from **Export context** in a project. Choose records by type or
individually, then download the bundle or copy it to the clipboard.
Manuscript chapters are unselected by default.

```json
{
  "format": "wordly.context-bundle",
  "formatVersion": 1,
  "exportedAt": "2026-10-25T15:00:00.000Z",
  "workspaceId": "wsp_demo",
  "workspaceName": "Demo workspace",
  "projectId": "prj_demo_salt_archive",
  "projectTitle": "The Salt Archive",
  "selection": { "recordIds": ["rec_demo_mara_dossier"], "types": null },
  "records": [
    {
      "id": "rec_demo_mara_dossier",
      "type": "character_dossier",
      "contentClass": "reference",
      "title": "Mara Venn",
      "revision": 2,
      "authorityStatus": "approved",
      "supersededByRecordId": null,
      "protected": false,
      "body": "Archivist of the Salt Guild. ...",
      "fields": { "name": "Mara Venn", "aliases": ["Mara"], "age": 34 },
      "updatedAt": "2026-10-25T15:12:25.000Z"
    }
  ],
  "changePackageInstructions": ["..."],
  "changePackageTemplate": { "format": "wordly.change-package", "...": "..." },
  "changePackageSchema": { "$schema": "https://json-schema.org/draft/2020-12/schema", "...": "..." }
}
```

## Record fields

| Field | Use when preparing a change package |
| --- | --- |
| `id` | The stable record ID to put in `recordId`. |
| `revision` | The value to put in `expectedRevision`. If the record changes in the app after export, the package is rejected as stale instead of overwriting newer work. |
| `type`, `contentClass` | Document type, and whether it is `manuscript` or `reference` content. |
| `authorityStatus` | Canon/decision status: `draft`, `proposed`, `approved`, `superseded`, `unresolved`. |
| `protected` | When `true`, the record must not be changed unless the author explicitly authorizes it (`protectedOverrides`). |
| `body`, `fields` | Current content. |

## Instructions, template, and schema

`changePackageInstructions` is a list of plain-language rules for the
assistant: use only IDs from the bundle, copy revisions into
`expectedRevision`, mark `approval.status` as `"approved"` only when the author
explicitly approved, prefer `relatedRecords` over propagating edits, and so on.
`changePackageTemplate` is pre-filled with this project's IDs.
`changePackageSchema` is the full JSON Schema; you can omit it from the export
to keep the bundle small.

## Suggested ChatGPT workflow

1. Export a bundle with the records relevant to the conversation.
2. Paste it into the conversation and work as usual.
3. When decisions are settled, say: "Update the working files with the
   decisions I approved. Return a change package."
4. Save the returned JSON and import it on **Import change package**. Review
   the preview, then apply.
5. Export a fresh bundle before the next round so the revisions are current.
