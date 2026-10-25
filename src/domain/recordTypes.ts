export const RECORD_TYPES = [
  "manuscript_chapter",
  "chapter_outline",
  "story_architecture",
  "character_dossier",
  "worldbuilding",
  "canon_decision",
  "continuity_note",
  "reference_note",
] as const;

export type RecordType = (typeof RECORD_TYPES)[number];

export const CONTENT_CLASSES = ["manuscript", "reference"] as const;
export type ContentClass = (typeof CONTENT_CLASSES)[number];

const CONTENT_CLASS_BY_TYPE: Record<RecordType, ContentClass> = {
  manuscript_chapter: "manuscript",
  chapter_outline: "reference",
  story_architecture: "reference",
  character_dossier: "reference",
  worldbuilding: "reference",
  canon_decision: "reference",
  continuity_note: "reference",
  reference_note: "reference",
};

export const RECORD_TYPE_LABELS: Record<RecordType, string> = {
  manuscript_chapter: "Manuscript chapter",
  chapter_outline: "Chapter outline",
  story_architecture: "Story architecture",
  character_dossier: "Character dossier",
  worldbuilding: "Worldbuilding",
  canon_decision: "Canon decision",
  continuity_note: "Continuity note",
  reference_note: "Reference note",
};

export function isRecordType(value: string): value is RecordType {
  return (RECORD_TYPES as readonly string[]).includes(value);
}

export function contentClassOf(type: RecordType): ContentClass {
  return CONTENT_CLASS_BY_TYPE[type];
}

export function defaultProtectedFor(type: RecordType): boolean {
  return contentClassOf(type) === "manuscript";
}
