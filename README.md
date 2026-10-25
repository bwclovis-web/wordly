# Wordly Editor

A local, authoritative store for a novel's project state: manuscript chapters,
outlines, character dossiers, worldbuilding, canon decisions, and continuity
notes. Each record is revisioned, and every revision carries provenance.

Creative work happens in ChatGPT. Approved decisions come back as versioned
**change packages**. These are bounded, validated JSON change sets that apply
atomically and only once, and they never touch protected manuscript prose
unless that is explicitly authorized. Conversation suggestions never become
canon on their own.

## Setup

Requires Node 24+ and pnpm 10+.

```bash
cp .env.example .env  # DATABASE_URL="file:./prisma/dev.db"
pnpm install          # also generates the Prisma client
pnpm db:setup         # back up (if a DB exists), apply migrations, generate client, seed the demo project
pnpm dev              # http://127.0.0.1:3000 (bound to localhost only)
```

`pnpm db:setup` is safe to re-run. It never deletes data, and the demo seed
skips itself if the demo workspace already exists.

### Where the database lives

`DATABASE_URL` in `.env` names the SQLite file. Relative paths resolve from
the project root, and the app, the Prisma CLI, and every `db:*` script open the
same file (`src/server/dbLocation.ts`). Run `pnpm db:info` to print the
resolved path, applied migrations, and row counts. It is read-only.

### Database scripts

| Command | Effect on your data |
| --- | --- |
| `pnpm db:info` | Read-only. Shows the database path, migrations, and counts. |
| `pnpm db:backup [--label name]` | Read-only. Writes `backups/<timestamp>/` containing a SQLite snapshot plus one `*.wordly-backup.json` per workspace. |
| `pnpm db:deploy` | Backs up, then applies pending migrations. Use this after pulling schema changes. |
| `pnpm db:restore <file> --dry-run` | Read-only. Validates a backup and summarizes it. |
| `pnpm db:restore <file> --new-database <path>` | Creates a new SQLite file (refuses if it exists) and restores with the original IDs. |
| `pnpm db:restore <file> --into-current` | Backs up, then adds the backup as a new workspace with new IDs. Existing workspaces are untouched. |
| `pnpm db:seed` | Adds the demo project if missing. |
| `pnpm db:reset --confirm-delete-all-data [--seed]` | **Destructive.** Backs up, deletes the database file, and recreates an empty schema. Without the flag it only explains what it would do. |
| `pnpm db:migrate:dev` | Developer only: creates a migration after editing `prisma/schema.prisma`. Backs up first. If Prisma offers to reset the database, answer **no**. |

Never run `prisma migrate reset` against your working database. `backups/` is
git-ignored. Copy important backups somewhere outside the repository too.

### Backup and restore, safely

1. Back up: `pnpm db:backup --label before-trial`, or use **Backup & restore**
   in the app to download a single workspace.
2. Check the backup: `pnpm db:restore backups/<dir>/<workspace>.wordly-backup.json --dry-run`.
3. Prove it restores without touching your data:
   `pnpm db:restore <file> --new-database ../wordly-restore-check.db`, then
   `DATABASE_URL="file:../wordly-restore-check.db" pnpm db:info`.
4. To work from a restored copy, either restore it as a new workspace (app or
   `--into-current`), or point `DATABASE_URL` at the restored file and restart the app.
5. To return to a raw snapshot, stop the app, copy your current `prisma/dev.db`
   aside, copy `backups/<dir>/dev.db` into place, and start the app.

Format and validation details: [docs/backup-format.md](docs/backup-format.md).

Other scripts: `pnpm test` (Vitest), `pnpm typecheck`, `pnpm build && pnpm start`,
`pnpm schema:export` (regenerate `docs/schemas/change-package.v1.schema.json`).

### Rules for contributors and agents

`AGENTS.md` starts with a block that `next dev` writes and rewrites, between
`<!-- BEGIN:nextjs-agent-rules -->` and `<!-- END:nextjs-agent-rules -->`
(see `node_modules/next/dist/server/lib/generate-agent-files.js`). Next
replaces only that block. Persistent project rules live in
[PROJECT_RULES.md](PROJECT_RULES.md), which no tool generates. `AGENTS.md` links
to it from below the managed block, where the link survives regeneration.

### Demo data

`pnpm db:seed` creates the project **The Salt Archive** (`prj_demo_salt_archive`)
with fixed record IDs. It includes a protected manuscript chapter, a dossier
for Mara Venn, worldbuilding, an outline, and an unresolved canon decision.
[`examples/sample-change-package.json`](examples/sample-change-package.json)
applies cleanly to a freshly seeded database. Import it on the project's
**Import change package** page to see the preview, the apply step, and the
"already applied" behavior.

## Workflow

0. **Import references (optional).** On **Import Markdown references**,
   select `.md` files. The preview writes nothing. For every file you choose
   the document type (reference types only), canon status, and protection;
   none are preselected or inferred from filenames. For each file that looks
   like an existing record (same content, title, or previously imported
   filename) you choose create new, replace (as a new revision), or skip. The
   batch applies in one transaction. Each file's original name and exact
   content are stored with its revision provenance.
1. **Export context.** Select records and download a
   [context bundle](docs/context-bundle-format.md) containing IDs, current
   revisions, types, statuses, protection flags, and package instructions.
2. **Work in ChatGPT** with that bundle. When decisions are settled, ask for a change package.
3. **Import change package.** The app validates the whole package and shows
   before/after diffs, stale or blocked operations, and potentially affected
   records (which it lists but does not change). Then you apply it.
4. **History & review.** View the audit log, applied packages, and open
   review items for records that may need follow-up.

## Concepts (kept separate)

| Concept | Where |
| --- | --- |
| Document type | `Record.type` (manuscript chapter, outline, dossier, ...) |
| Canon/decision status | `Record.authorityStatus`: draft, proposed, approved, superseded, unresolved |
| Revision history | Immutable `Revision` rows; `Record.currentRevision` |
| Source/provenance | `Source` row per change batch (UI / change package / Markdown import / future API), with conversation label, URL, and original filename; `ImportedFile` keeps each imported file verbatim |
| Manuscript protection | `Record.protected` flag plus the manuscript/reference content class |

## Architecture

```
src/domain/            types, enums, IDs, issue codes (no I/O)
src/changePackage/     v1 Zod schema, JSON Schema, parser, diff helpers
src/backup/            wordly.workspace-backup v1 schema
src/server/services/   mutationService (the only writer of records/revisions),
                       protection guards, recordService (UI), changePackageService
                       (validate/preview/apply), markdownImportService (preview/apply),
                       backupService (create/validate/restore), impactService,
                       contextExportService, auditService, reviewService, projectService
src/app/               Next.js pages and server actions (thin; call services only)
scripts/               db:* scripts (info, backup, restore, deploy, reset) and schema export
tests/acceptance/      end-to-end service tests, including the ChatGPT round trip
tests/fixtures/        invented Markdown reference files
```

Backup restore is the one write path that does not use `mutationService`,
because it copies stored history (revisions, provenance, audit) exactly as it was.

The UI, the change-package importer, and any future API/MCP adapter all go
through `mutationService.applyMutations`. That way they share the same
revision checks, scope and protection guards, provenance, and audit.

## Scope

Status, check results, the first real-reference trial steps, and known gaps
are in [PROGRESS.md](PROGRESS.md).

- Local only. There is no authentication, no remote access, and no ChatGPT
  connection. See [docs/future-chatgpt-connection.md](docs/future-chatgpt-connection.md)
  for what a real connection would require.
- Prisma is pinned to 7.10.x (the stable driver-adapter setup); `latest` on npm is an 8.0 release candidate.
