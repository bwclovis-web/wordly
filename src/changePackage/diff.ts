import { diffLines, diffWords } from "diff";
import { stableStringify, type JsonObject, type JsonValue } from "@/domain/json";

export interface DiffPart {
  value: string;
  added?: boolean;
  removed?: boolean;
}

export interface FieldDiff {
  key: string;
  change: "added" | "removed" | "changed";
  before?: JsonValue;
  after?: JsonValue;
}

/** Word-level diff for short text, line-level for long text. */
export function textDiff(before: string, after: string): DiffPart[] {
  if (before === after) return before ? [{ value: before }] : [];
  const useLines = before.length + after.length > 20_000;
  const parts = useLines ? diffLines(before, after) : diffWords(before, after);
  return parts.map((p) => ({
    value: p.value,
    ...(p.added ? { added: true } : {}),
    ...(p.removed ? { removed: true } : {}),
  }));
}

export function fieldDiffs(before: JsonObject, after: JsonObject): FieldDiff[] {
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
  const diffs: FieldDiff[] = [];
  for (const key of keys) {
    const inBefore = key in before;
    const inAfter = key in after;
    if (inBefore && !inAfter) diffs.push({ key, change: "removed", before: before[key] });
    else if (!inBefore && inAfter) diffs.push({ key, change: "added", after: after[key] });
    else if (stableStringify(before[key]) !== stableStringify(after[key])) {
      diffs.push({ key, change: "changed", before: before[key], after: after[key] });
    }
  }
  return diffs;
}

export function hasTextChange(parts: DiffPart[]): boolean {
  return parts.some((p) => p.added || p.removed);
}
