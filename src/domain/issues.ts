export const ISSUE_CODES = [
  "INVALID_JSON",
  "SCHEMA_INVALID",
  "UNSUPPORTED_FORMAT",
  "UNSUPPORTED_FORMAT_VERSION",
  "UNSUPPORTED_OPERATION",
  "APPROVAL_MISSING",
  "NOT_APPROVED",
  "TARGET_MISMATCH",
  "PACKAGE_ID_CONFLICT",
  "EMPTY_BATCH",
  "RECORD_NOT_FOUND",
  "RECORD_ID_CONFLICT",
  "DUPLICATE_TARGET",
  "STALE_REVISION",
  "SCOPE_VIOLATION",
  "PROTECTED_RECORD",
  "PROTECTED_CONFIRMATION_REQUIRED",
  "INVALID_CHANGE",
  "INVALID_REFERENCE",
  "NO_EFFECTIVE_CHANGE",
  "UNUSED_PROTECTED_OVERRIDE",
  "FIELD_NOT_PRESENT",
] as const;

export type IssueCode = (typeof ISSUE_CODES)[number];

export interface Issue {
  code: IssueCode;
  severity: "error" | "warning";
  message: string;
  /** JSON path within the submitted document, e.g. "operations.2.expectedRevision". */
  path?: string;
  operationIndex?: number;
  recordId?: string;
}

export function errorIssue(code: IssueCode, message: string, extra: Partial<Issue> = {}): Issue {
  return { code, severity: "error", message, ...extra };
}

export function warningIssue(code: IssueCode, message: string, extra: Partial<Issue> = {}): Issue {
  return { code, severity: "warning", message, ...extra };
}

export function hasErrors(issues: readonly Issue[]): boolean {
  return issues.some((i) => i.severity === "error");
}
