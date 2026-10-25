import { describe, expect, it } from "vitest";
import { changePackageJsonSchema } from "@/changePackage/jsonSchema";
import { packageContentHash, parseChangePackage } from "@/changePackage/parse";
import { makePackage } from "../helpers";

describe("change package parsing", () => {
  it("accepts a minimal valid package and applies defaults", () => {
    const pkg = makePackage();
    delete (pkg as { scope?: string }).scope;
    const result = parseChangePackage(pkg);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.pkg.scope).toBe("reference");
      expect(result.pkg.protectedOverrides).toEqual([]);
      expect(result.pkg.relatedRecords).toEqual([]);
    }
  });

  it("rejects unknown format and versions", () => {
    expect(parseChangePackage({ ...makePackage(), format: "other" })).toMatchObject({
      ok: false,
      issues: [expect.objectContaining({ code: "UNSUPPORTED_FORMAT" })],
    });
    expect(parseChangePackage({ ...makePackage(), formatVersion: 2 })).toMatchObject({
      ok: false,
      issues: [expect.objectContaining({ code: "UNSUPPORTED_FORMAT_VERSION" })],
    });
  });

  it("rejects unknown top-level and operation properties", () => {
    const result = parseChangePackage({ ...makePackage(), autoApprove: true });
    expect(result.ok).toBe(false);
    const pkg = makePackage();
    const op = { ...pkg.operations[0], deleteEverything: true };
    expect(parseChangePackage({ ...pkg, operations: [op] }).ok).toBe(false);
  });

  it("rejects malformed record IDs", () => {
    const pkg = makePackage();
    const result = parseChangePackage({
      ...pkg,
      operations: [{ ...pkg.operations[0], recordId: "Mara Venn" }],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues[0]).toMatchObject({ code: "SCHEMA_INVALID", operationIndex: 0 });
  });

  it("approval status must be approved or proposed, never inferred", () => {
    const pkg = makePackage();
    expect(parseChangePackage({ ...pkg, approval: {} })).toMatchObject({
      ok: false,
      issues: [expect.objectContaining({ code: "APPROVAL_MISSING" })],
    });
    expect(parseChangePackage({ ...pkg, approval: { status: "yes" } }).ok).toBe(false);
  });

  it("content hash ignores formatting and key order", () => {
    const pkg = makePackage();
    const a = parseChangePackage(JSON.stringify(pkg));
    const reordered = Object.fromEntries(Object.entries(pkg).reverse());
    const b = parseChangePackage(JSON.stringify(reordered, null, 4));
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) {
      expect(a.contentHash).toBe(b.contentHash);
      expect(packageContentHash(a.pkg)).toBe(a.contentHash);
    }
  });

  it("produces a JSON Schema describing operations", () => {
    const schema = changePackageJsonSchema() as { properties: Record<string, unknown>; required: string[] };
    expect(schema.required).toEqual(expect.arrayContaining(["format", "packageId", "approval", "operations"]));
    expect(schema.properties).toHaveProperty("operations");
  });
});
