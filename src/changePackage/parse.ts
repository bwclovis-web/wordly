import { errorIssue, type Issue } from "@/domain/issues";
import { sha256, stableStringify } from "@/domain/json";
import {
  CHANGE_PACKAGE_FORMAT,
  CHANGE_PACKAGE_FORMAT_VERSION,
  changePackageV1Schema,
  SUPPORTED_OPERATIONS,
  type ChangePackageV1,
} from "./schema.v1";

export type ParseResult =
  | { ok: true; pkg: ChangePackageV1; contentHash: string; issues: Issue[] }
  | { ok: false; issues: Issue[] };

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/** Content hash over the normalized package, so formatting differences don't matter. */
export function packageContentHash(pkg: ChangePackageV1): string {
  return sha256(stableStringify(pkg));
}

/**
 * Structural validation of a change package. Collects every issue it can
 * (unsupported operations, schema errors, missing approval) in one pass.
 */
export function parseChangePackage(input: string | unknown): ParseResult {
  let raw: unknown = input;
  if (typeof input === "string") {
    try {
      raw = JSON.parse(input);
    } catch (e) {
      return { ok: false, issues: [errorIssue("INVALID_JSON", `Not valid JSON: ${(e as Error).message}`)] };
    }
  }
  if (!isObject(raw)) {
    return { ok: false, issues: [errorIssue("SCHEMA_INVALID", "A change package must be a JSON object.")] };
  }
  if (raw.format !== CHANGE_PACKAGE_FORMAT) {
    return {
      ok: false,
      issues: [
        errorIssue("UNSUPPORTED_FORMAT", `"format" must be "${CHANGE_PACKAGE_FORMAT}".`, { path: "format" }),
      ],
    };
  }
  if (raw.formatVersion !== CHANGE_PACKAGE_FORMAT_VERSION) {
    return {
      ok: false,
      issues: [
        errorIssue(
          "UNSUPPORTED_FORMAT_VERSION",
          `formatVersion ${JSON.stringify(raw.formatVersion)} is not supported; this importer supports version ${CHANGE_PACKAGE_FORMAT_VERSION}.`,
          { path: "formatVersion" },
        ),
      ],
    };
  }

  const issues: Issue[] = [];
  const unsupportedIndexes = new Set<number>();
  if (Array.isArray(raw.operations)) {
    raw.operations.forEach((op, index) => {
      const name = isObject(op) ? op.op : undefined;
      if (typeof name !== "string" || !(SUPPORTED_OPERATIONS as readonly string[]).includes(name)) {
        unsupportedIndexes.add(index);
        issues.push(
          errorIssue(
            "UNSUPPORTED_OPERATION",
            `Operation ${JSON.stringify(name ?? null)} is not supported. Supported: ${SUPPORTED_OPERATIONS.join(", ")}.`,
            { path: `operations.${index}.op`, operationIndex: index },
          ),
        );
      }
    });
  }
  if (!isObject(raw.approval) || raw.approval.status === undefined) {
    issues.push(
      errorIssue(
        "APPROVAL_MISSING",
        'The package must state approval explicitly: "approval": { "status": "approved" | "proposed" }.',
        { path: "approval" },
      ),
    );
  }

  const result = changePackageV1Schema.safeParse(raw);
  if (!result.success) {
    for (const zi of result.error.issues) {
      const path = zi.path.map(String);
      if (path[0] === "operations" && unsupportedIndexes.has(Number(path[1]))) continue;
      if (path[0] === "approval" && issues.some((i) => i.code === "APPROVAL_MISSING")) continue;
      const opIndex = path[0] === "operations" && path[1] !== undefined ? Number(path[1]) : undefined;
      issues.push(
        errorIssue("SCHEMA_INVALID", zi.message, {
          path: path.join(".") || undefined,
          ...(opIndex !== undefined && !Number.isNaN(opIndex) ? { operationIndex: opIndex } : {}),
        }),
      );
    }
  }

  if (issues.length > 0 || !result.success) return { ok: false, issues };
  return { ok: true, pkg: result.data, contentHash: packageContentHash(result.data), issues: [] };
}
