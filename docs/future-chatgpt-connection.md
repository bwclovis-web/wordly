# Future ChatGPT connection: requirements

> **Status: not implemented.** This milestone has no remote access, API
> server, MCP server, or ChatGPT integration. The app listens on `127.0.0.1`
> only and has no authentication. Do not expose it to a network. This document
> records what a future connection must satisfy. It does not claim that the
> connection exists or works.

## Goal

Eventually, the author could tell ChatGPT "update the working files with the
decisions I approved", and a connected assistant would:

1. Read the relevant current records.
2. Prepare a bounded change set.
3. Apply the changes the request authorizes.
4. Preserve revisions and provenance.
5. Return a precise change summary.

The explicit request is the authorization. No redundant approval step is
added unless there is ambiguity, a conflict, or protected content.

Today, the same workflow runs manually: export a
[context bundle](context-bundle-format.md), get a
[change package](change-package-format.md) back, and import it.

## Requirements

### 1. A supported integration mechanism

- Use a mechanism that ChatGPT officially supports for calling external tools
  at the time of implementation, such as a remote MCP server registered as a
  ChatGPT connector or app. Verify current OpenAI documentation and plan
  availability first. Do not build against assumptions.
- Having an HTTP API in this app does not mean ChatGPT can use it. The
  integration exists only once ChatGPT can actually discover and call the
  tools.

### 2. Secure reachability

- ChatGPT runs in the cloud and cannot reach `localhost` on the author's machine.
- Options include a hosted service that holds the project store (with sync),
  or an authenticated outbound tunnel or relay from the local app. A raw open
  port is never acceptable.
- TLS everywhere. Rate limiting and request size limits.
- Never bind the existing local UI to a public interface as a shortcut. The
  UI has no authentication.

### 3. Authentication and project-scoped authorization

- OAuth 2.1 (or whatever the chosen ChatGPT mechanism requires), with the
  author as the only principal.
- Tokens scoped to specific workspaces or projects, with separate `read` and
  `write` scopes. A separate, explicit `manuscript:write` scope should be
  required before any manuscript-scope mutation.
- Revocable tokens. Each token's last use is visible in the app.

### 4. Read/search tools

| Tool | Backed by |
| --- | --- |
| `list_records(projectId, types?)` returns ids, titles, types, revisions, statuses, protection | `recordService.listRecords` |
| `get_records(projectId, ids)` returns full content with revisions | `recordService.getRecord` |
| `search_records(projectId, query)` | new, read-only |
| `get_record_history(recordId)` | `recordService.listRevisions` |
| `export_context(projectId, selection)` | `contextExportService.exportContextBundle` |

### 5. Revision-aware write tools

| Tool | Backed by |
| --- | --- |
| `preview_change_package(package)` | `changePackageService.previewChangePackage` |
| `apply_change_package(package, confirmProtected?)` | `changePackageService.applyChangePackage` |

- Writes go only through change packages. That way the adapter inherits
  schema validation, `expectedRevision` stale checks, scope and protection
  guards, atomic transactions, provenance, and audit from the existing service
  layer (`mutationService.applyMutations`). The adapter must not write to the
  database directly.
- The adapter sets `source.kind = "api"` and records the token and client
  identity as the actor. (The `Source.kind` column already allows `api`.)
- Protected records still require explicit author confirmation.
  `confirmProtected` should only be set when the author's request clearly
  covers those records, and ideally only after the assistant has shown them
  which protected records are affected.
- Stale or conflicting packages return structured issues (`STALE_REVISION`,
  etc.) so the assistant can re-read and re-prepare the package instead of
  overwriting.

### 6. Audit history and idempotency

- `packageId` is the idempotency key. Retries from ChatGPT or the network
  then cannot double-apply. Re-sending the same package returns the original
  result, and reusing the ID with different content is rejected.
- Every applied package produces an audit entry, per-revision provenance
  (conversation label and URL), and review items for potentially affected
  records. These already exist and need no change.
- Additionally log each remote call (tool, token, outcome), including rejected
  attempts, in a separate access log.

## Already in place for a future adapter

- A single mutation path (`src/server/services/mutationService.ts`) that the
  UI and the importer already share.
- Explicit, separate fields for document type, canon status, revision
  history, provenance, and protection.
- A versioned package format with a published JSON Schema.
- Acceptance tests (`tests/acceptance/`) covering revision preservation,
  stale detection, idempotency, protection, and atomicity. A future adapter
  should run the same scenarios through its tools.
