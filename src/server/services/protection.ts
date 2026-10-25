import { errorIssue, type Issue } from "@/domain/issues";
import { contentClassOf, RECORD_TYPE_LABELS, type RecordType } from "@/domain/recordTypes";
import type { MutationScope } from "@/domain/statuses";

export interface ProtectionContext {
  scope: MutationScope;
  protectedOverrides: ReadonlySet<string>;
}

export interface GuardTarget {
  id: string;
  type: RecordType;
  protected: boolean;
}

/**
 * Write rules shared by every caller of the mutation layer:
 * - a `reference` scope never touches manuscript-class records;
 * - a protected record is writable only when explicitly listed in `protectedOverrides`.
 */
export function checkWriteAllowed(
  target: GuardTarget,
  ctx: ProtectionContext,
  extra: Partial<Issue> = {},
): Issue[] {
  const issues: Issue[] = [];
  if (ctx.scope === "reference" && contentClassOf(target.type) === "manuscript") {
    issues.push(
      errorIssue(
        "SCOPE_VIOLATION",
        `${RECORD_TYPE_LABELS[target.type]} ${target.id} is manuscript content and cannot be changed by a reference-scope change.`,
        { recordId: target.id, ...extra },
      ),
    );
  }
  if (target.protected && !ctx.protectedOverrides.has(target.id)) {
    issues.push(
      errorIssue(
        "PROTECTED_RECORD",
        `Record ${target.id} is protected. It can only be changed when explicitly unlocked (in the editor) or listed in protectedOverrides (in a change package).`,
        { recordId: target.id, ...extra },
      ),
    );
  }
  return issues;
}

export function checkCreateAllowed(
  type: RecordType,
  ctx: ProtectionContext,
  extra: Partial<Issue> = {},
): Issue[] {
  if (ctx.scope === "reference" && contentClassOf(type) === "manuscript") {
    return [
      errorIssue(
        "SCOPE_VIOLATION",
        `A reference-scope change cannot create manuscript content (${RECORD_TYPE_LABELS[type]}).`,
        extra,
      ),
    ];
  }
  return [];
}
