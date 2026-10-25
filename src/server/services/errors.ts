import type { Issue } from "@/domain/issues";

/** Thrown inside a transaction to roll it back; carries every issue found. */
export class MutationRejectedError extends Error {
  readonly issues: Issue[];

  constructor(issues: Issue[], message = "Mutation batch rejected") {
    super(`${message}: ${issues.map((i) => `${i.code} ${i.message}`).join("; ")}`);
    this.name = "MutationRejectedError";
    this.issues = issues;
  }
}

export class StaleRevisionError extends MutationRejectedError {
  constructor(issue: Issue) {
    super([issue], "Stale revision");
    this.name = "StaleRevisionError";
  }
}

export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotFoundError";
  }
}
