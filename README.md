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
pnpm db:setup         # apply migrations, generate client, seed the demo project
pnpm dev              # http://127.0.0.1:3000 (bound to localhost only)
```

Other scripts: `pnpm test` (Vitest), `pnpm typecheck`, `pnpm build && pnpm start`,
`pnpm db:migrate` (create a new migration after editing `prisma/schema.prisma`),
`pnpm schema:export` (regenerate `docs/schemas/change-package.v1.schema.json`).

### Demo data

`pnpm db:seed` creates the project **The Salt Archive** (`prj_demo_salt_archive`)
with fixed record IDs. It includes a protected manuscript chapter, a dossier
for Mara Venn, worldbuilding, an outline, and an unresolved canon decision.
[`examples/sample-change-package.json`](examples/sample-change-package.json)
applies cleanly to a freshly seeded database. Import it on the project's
**Import change package** page to see the preview, the apply step, and the
"already applied" behavior.

## Workflow

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
| Source/provenance | `Source` row per change batch (UI / change package / future API), with conversation label and URL |
| Manuscript protection | `Record.protected` flag plus the manuscript/reference content class |

## Architecture

```
src/domain/            types, enums, IDs, issue codes (no I/O)
src/changePackage/     v1 Zod schema, JSON Schema, parser, diff helpers
src/server/services/   mutationService (the only writer of records/revisions),
                       protection guards, recordService (UI), changePackageService
                       (validate/preview/apply), impactService, contextExportService,
                       auditService, reviewService, projectService
src/app/               Next.js pages and server actions (thin; call services only)
tests/acceptance/      end-to-end service tests for the milestone acceptance checks
```

The UI, the change-package importer, and any future API/MCP adapter all go
through `mutationService.applyMutations`. That way they share the same
revision checks, scope and protection guards, provenance, and audit.

## Scope of this milestone

- Local only. There is no authentication, no remote access, and no ChatGPT
  connection. See [docs/future-chatgpt-connection.md](docs/future-chatgpt-connection.md)
  for what a real connection would require.
- Prisma is pinned to 7.10.x (the stable driver-adapter setup); `latest` on npm is an 8.0 release candidate.
