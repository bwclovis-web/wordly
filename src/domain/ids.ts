import { ulid } from "ulid";

export type IdPrefix = "wsp" | "prj" | "rec" | "rev" | "pkg" | "src" | "aud" | "rvw" | "imp" | "bat";

export function newId(prefix: IdPrefix): string {
  return `${prefix}_${ulid()}`;
}

/** Externally supplied IDs (e.g. from a change package) must match these patterns. */
export const RECORD_ID_PATTERN = /^rec_[A-Za-z0-9_-]{6,64}$/;
export const PACKAGE_ID_PATTERN = /^pkg_[A-Za-z0-9_-]{6,80}$/;
export const WORKSPACE_ID_PATTERN = /^wsp_[A-Za-z0-9_-]{4,64}$/;
export const PROJECT_ID_PATTERN = /^prj_[A-Za-z0-9_-]{4,64}$/;
