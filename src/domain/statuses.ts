export const AUTHORITY_STATUSES = [
  "draft",
  "proposed",
  "approved",
  "superseded",
  "unresolved",
] as const;

export type AuthorityStatus = (typeof AUTHORITY_STATUSES)[number];

export function isAuthorityStatus(value: string): value is AuthorityStatus {
  return (AUTHORITY_STATUSES as readonly string[]).includes(value);
}

export const SOURCE_KINDS = ["ui", "change_package", "api"] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

/** Which content class a mutation batch is allowed to touch. */
export const MUTATION_SCOPES = ["reference", "manuscript"] as const;
export type MutationScope = (typeof MUTATION_SCOPES)[number];

export const REVIEW_ORIGINS = ["package_note", "detected_mention"] as const;
export type ReviewOrigin = (typeof REVIEW_ORIGINS)[number];
