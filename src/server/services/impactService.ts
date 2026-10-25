import type { RecordSnapshot } from "@/domain/records";
import { contentClassOf, isRecordType, type ContentClass, type RecordType } from "@/domain/recordTypes";
import type { DbOrTx } from "../db";

/*
 * Identifies records that *might* be affected by a change (they mention a
 * changed record's name or aliases). These are surfaced for review and are
 * never modified automatically.
 */

export interface ImpactTrigger {
  recordId: string;
  title: string;
  snapshots: (RecordSnapshot | null)[];
}

export interface PotentialEffect {
  recordId: string;
  title: string;
  type: RecordType;
  contentClass: ContentClass;
  protected: boolean;
  triggeredByRecordId: string;
  triggeredByTitle: string;
  matchedTerms: string[];
}

const MIN_TERM_LENGTH = 3;

/** Titles plus `fields.aliases` / `fields.name` from every given snapshot. */
export function searchTermsFor(snapshots: (RecordSnapshot | null)[]): string[] {
  const terms = new Map<string, string>();
  const add = (value: unknown) => {
    if (typeof value !== "string") return;
    const term = value.trim();
    if (term.length >= MIN_TERM_LENGTH) terms.set(term.toLowerCase(), term);
  };
  for (const s of snapshots) {
    if (!s) continue;
    add(s.title);
    add(s.fields.name);
    const aliases = s.fields.aliases;
    if (Array.isArray(aliases)) aliases.forEach(add);
  }
  return [...terms.values()];
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function termMatcher(term: string): RegExp {
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(term)}($|[^\\p{L}\\p{N}])`, "iu");
}

export async function detectPotentialEffects(
  db: DbOrTx,
  projectId: string,
  triggers: readonly ImpactTrigger[],
  excludeRecordIds: ReadonlySet<string>,
): Promise<PotentialEffect[]> {
  const prepared = triggers
    .map((t) => ({ ...t, matchers: searchTermsFor(t.snapshots).map((term) => ({ term, re: termMatcher(term) })) }))
    .filter((t) => t.matchers.length > 0);
  if (prepared.length === 0) return [];

  const candidates = await db.record.findMany({
    where: { projectId, id: { notIn: [...excludeRecordIds] } },
    select: { id: true, title: true, type: true, body: true, protected: true },
  });

  const effects: PotentialEffect[] = [];
  for (const candidate of candidates) {
    if (!isRecordType(candidate.type)) continue;
    const haystack = `${candidate.title}\n${candidate.body}`;
    for (const trigger of prepared) {
      if (trigger.recordId === candidate.id) continue;
      const matched = trigger.matchers.filter((m) => m.re.test(haystack)).map((m) => m.term);
      if (matched.length === 0) continue;
      effects.push({
        recordId: candidate.id,
        title: candidate.title,
        type: candidate.type,
        contentClass: contentClassOf(candidate.type),
        protected: candidate.protected,
        triggeredByRecordId: trigger.recordId,
        triggeredByTitle: trigger.title,
        matchedTerms: matched,
      });
    }
  }
  return effects;
}
