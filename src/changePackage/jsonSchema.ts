import { z } from "zod";
import { changePackageV1Schema } from "./schema.v1";

let cached: Record<string, unknown> | undefined;

/** JSON Schema (draft 2020-12) for the change package as an author/assistant writes it. */
export function changePackageJsonSchema(): Record<string, unknown> {
  if (!cached) {
    cached = {
      $id: "https://wordly-editor.local/schemas/change-package.v1.json",
      title: "Wordly change package v1",
      ...(z.toJSONSchema(changePackageV1Schema, { io: "input" }) as Record<string, unknown>),
    };
  }
  return cached;
}
