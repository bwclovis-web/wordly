# Workspace backup format (`wordly.workspace-backup`, v1)

A complete copy of one workspace, produced by **Backup & restore** in the app,
`GET /backup/<workspaceId>`, or `pnpm db:backup`. Schema:
[`src/backup/format.v1.ts`](../src/backup/format.v1.ts).

## Contents

| Field | What it preserves |
| --- | --- |
| `workspace`, `projects` | IDs, names, creation times |
| `records` | Current content, type, canon status (`authorityStatus`), superseded-by link, protection flag, current revision |
| `revisions` | Every revision's full snapshot, content hash, and the provenance source that created it |
| `sources` | Provenance: kind (ui / change_package / markdown_import), actor, conversation label, URL, package ID, original filename |
| `changePackages` | Applied package identity: (`projectId`, `packageId`), content hash, the exact raw JSON, and the stored result |
| `auditEntries` | The full audit log with details JSON verbatim |
| `reviewItems` | Open and resolved review items, including what triggered them |
| `importedFiles` | Each imported Markdown file's original name, exact content, hash, and which record revision it produced |
| `counts`, `checksum` | Row counts, and a sha256 over the stable serialization of every other field |
| `app.migrations` | Schema migrations known to the app that wrote the file |

Record links are stored inside records (`supersededByRecordId`) and fields
(`aliases`, any JSON). They are part of each record and revision and are
restored with them.

## Validation before any write

A restore checks the whole file first and writes nothing if any check fails:

- format and version; schema of every row; checksum; declared counts;
- unique IDs; every reference resolves within the backup (project, record, source, superseded-by);
- every record has revisions 1..current with no gaps, each revision matches its
  content hash, and each record's current content equals its latest revision;
- each package's raw JSON still hashes to its stored content hash; each imported file matches its hash;
- the backup was not written by a newer schema than this app;
- when preserving IDs, none of them already exist in the target database.

## Restore modes

| Mode | Where | IDs | Use |
| --- | --- | --- | --- |
| Separate database | `pnpm db:restore <file> --new-database <path>` | Preserved exactly | Verify a backup, or recover onto a fresh file |
| New workspace | App: **Backup & restore**, or `pnpm db:restore <file> --into-current` | All new | Inspect an old state beside current work |

Both run in a single transaction. If anything fails, nothing is written. In
new-workspace mode, IDs inside stored result and audit JSON are rewritten to
the new IDs. Raw package JSON and its hash are kept verbatim, so applied
packages are still recognized (`already_applied`) in the restored copy. A
`workspace.restore` audit entry records the backup checksum and the ID mapping.
