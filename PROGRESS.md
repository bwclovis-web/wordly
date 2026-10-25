# Progress

## Milestone 1 (baseline commit `daea4e2`)

Revisioned record store, change-package importer (validate, preview, atomic
apply, idempotent, stale detection, protected manuscript), context export,
and the local UI.

## Milestone 2: ready for a controlled trial with copies of real references

### Implemented

- **Baseline preserved.** A local git repository holds the Milestone 1 commit.
  It has no remote. `.gitignore` excludes `.env*` (except `.env.example`),
  SQLite files and journal/WAL/SHM files, `backups/`, `exports/`, `imports/`,
  `uploads/`, `recovery/`, `manuscripts/`, `references/`, `private/`, context
  bundles, backup files, build output, and dependencies.
- **Database location and safe scripts.** One resolver
  (`src/server/dbLocation.ts`) is shared by the app, seed, and scripts. The
  Prisma CLI resolves the same file; this was verified with `migrate status`
  and `db:info`. New scripts: `db:info`, `db:backup`, `db:restore`. `db:deploy`,
  `db:setup`, and `db:migrate:dev` now back up first. `db:reset` refuses to run
  without `--confirm-delete-all-data` and backs up before deleting.
  Previously there was no reset script, but `db:migrate` (`prisma migrate dev`)
  could offer to reset on schema drift with no backup. It is now
  `db:migrate:dev`, which backs up and prints a warning first.
- **Agent rules.** `AGENTS.md` keeps the block that `next dev` manages
  (verified in `generate-agent-files.js`: only the text between the markers is
  replaced). Persistent rules live in `PROJECT_RULES.md`, which `AGENTS.md`
  links to from below the managed block.
- **Schema migration** `20261025152500_package_scope_and_file_imports`:
  change-package idempotency is now keyed by (`projectId`, `packageId`);
  `Source.originalFilename` and the `ImportedFile` table were added. Your
  existing `prisma/dev.db` was backed up to `backups/pre-migration-*/` before
  the migration. It was migrated in place with its data preserved (1 workspace,
  6 records, 8 revisions, 1 package, 4 review items, both before and after).
- **Full backup/restore** (`wordly.workspace-backup` v1, see
  [docs/backup-format.md](docs/backup-format.md)). It covers records,
  revisions, provenance, protection, canon status, links, aliases and fields,
  applied packages with their raw JSON and hashes, audit entries, review items,
  and imported files. The whole file is validated before any write: checksum,
  counts, referential integrity, revision continuity and hashes, package
  hashes, schema version, and ID collisions. Restore is a single transaction,
  either into a separate database with the original IDs or into the current
  database as an isolated new workspace with new IDs. Available as app UI,
  download route, and CLI.
- **Markdown reference import** (app: *Import Markdown references*):
  - Batch preview that writes nothing.
  - Explicit per-file document type (reference types only), canon status, and
    protection, with no defaults and nothing inferred from filenames.
  - Duplicate detection against existing records (same content, same title,
    or previously imported filename) and within the batch. Each duplicate
    needs an explicit create, replace (new revision, stale-checked), or skip.
  - Protected replacements need confirmation, and protection can only be
    raised.
  - One transaction per batch.
  - Original filename and exact content are kept in `ImportedFile`, linked to
    a `markdown_import` provenance source and the revision it produced.
- **ChatGPT round trip** verified end-to-end with invented content
  (`tests/acceptance/chatgpt-roundtrip.test.ts`): import references, export
  context, build a package only from the export, preview, apply, check
  revisions and provenance, reapply with no writes, reject a stale update,
  confirm protected prose is unchanged and flagged for review, then back up
  and restore and reapply as `already_applied` in the restored database.

### Check results (Oct 25, 2026)

| Check | Result |
| --- | --- |
| `pnpm typecheck` | pass (exit 0) |
| `pnpm test` | 11 files, 53 tests passed. 41 were from Milestone 1; 12 are new: 4 backup/restore, 7 Markdown import, 1 ChatGPT round trip |
| `pnpm build` | pass, 0 warnings. Routes include `/backup`, `/backup/[workspaceId]`, `/projects/[projectId]/import-markdown` |
| CLI on your database | `db:info`, `db:backup`, `db:restore --dry-run`, and `db:restore --new-database` (temp file, then deleted) all succeeded; restored counts matched. `db:reset` without the flag refused and changed nothing |
| Browser smoke test | Production build against a scratch database (deleted afterwards). Markdown import preview, duplicate replace, and provenance display worked; backup download, restore as a new workspace, and rejection of a tampered backup worked |

Your `prisma/dev.db` was only read and backed up during this work. Backups
were created in `backups/pre-migration-*` and `backups/*-verify`.

### First trial with copies of real references

1. `pnpm db:backup --label before-first-import`. Copy that folder outside the repository.
2. Copy a few reference files (not the originals, and not manuscript chapters)
   into a folder outside this repository.
3. `pnpm dev`, open your project (or create a new one), and choose
   **Import Markdown references**. Select the copies.
4. In the preview, choose each file's type, canon status, and protection.
   Mark something `approved` only if it really is approved canon. For flagged
   duplicates, choose create, replace, or skip.
5. Import, then open a few records and check the body text and the revision
   provenance ("Markdown import of <filename>").
6. Use **Export context** for the records you want to discuss. Take the bundle
   to ChatGPT, bring back a change package, and preview it on **Import change package**.
7. Afterwards, `pnpm db:backup --label after-first-import`. To undo
   everything, follow "Backup and restore, safely" in the README.

### Remaining manuscript-workflow gaps

- No manuscript chapter import. Chapters are created and edited one at a time
  in the editor, and Markdown import refuses manuscript types by design.
- Replacing a record from Markdown changes its title, body, and status but
  leaves structured fields (for example `age`, `aliases`) untouched. Review
  them after a replace.
- Only a level-1 heading or the filename is used as the suggested title. No
  front-matter parsing, no splitting one file into several records, and no
  folder or tag structure.
- Links between records are only `supersededByRecordId` and free-form fields.
  There is no first-class link or relationship model, and no alias index
  beyond mention detection.
- Mention detection matches exact titles, names, and aliases only; it does not
  catch partial names (for example "Ines" for "Ines Corrow").
- No chapter ordering, word counts, or manuscript assembly and export.
- The editor is a plain textarea: no rich Markdown preview, no search across
  records, and no bulk status changes.
- Backups are manual (no schedule). Restoring a single record from an old
  backup is not supported. Restore a whole workspace as a copy and compare.
- No ChatGPT connection. The workflow remains export and paste. See
  [docs/future-chatgpt-connection.md](docs/future-chatgpt-connection.md).
