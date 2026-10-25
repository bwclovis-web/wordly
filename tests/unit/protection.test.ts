import { describe, expect, it } from "vitest";
import { checkCreateAllowed, checkWriteAllowed } from "@/server/services/protection";

const none = new Set<string>();

describe("protection guards", () => {
  it("reference scope cannot write manuscript records even when unprotected", () => {
    const issues = checkWriteAllowed({ id: "rec_ch01xx", type: "manuscript_chapter", protected: false }, {
      scope: "reference",
      protectedOverrides: none,
    });
    expect(issues.map((i) => i.code)).toEqual(["SCOPE_VIOLATION"]);
  });

  it("manuscript scope still requires an override for protected records", () => {
    const target = { id: "rec_ch01xx", type: "manuscript_chapter" as const, protected: true };
    expect(checkWriteAllowed(target, { scope: "manuscript", protectedOverrides: none }).map((i) => i.code)).toEqual([
      "PROTECTED_RECORD",
    ]);
    expect(checkWriteAllowed(target, { scope: "manuscript", protectedOverrides: new Set([target.id]) })).toEqual([]);
  });

  it("protected reference records need an override in any scope", () => {
    const target = { id: "rec_worldx", type: "worldbuilding" as const, protected: true };
    expect(checkWriteAllowed(target, { scope: "reference", protectedOverrides: none }).map((i) => i.code)).toEqual([
      "PROTECTED_RECORD",
    ]);
    expect(checkWriteAllowed(target, { scope: "reference", protectedOverrides: new Set([target.id]) })).toEqual([]);
  });

  it("unprotected reference records are writable in reference scope", () => {
    expect(
      checkWriteAllowed({ id: "rec_dossier", type: "character_dossier", protected: false }, {
        scope: "reference",
        protectedOverrides: none,
      }),
    ).toEqual([]);
  });

  it("reference scope cannot create manuscript records", () => {
    expect(checkCreateAllowed("manuscript_chapter", { scope: "reference", protectedOverrides: none })).toHaveLength(1);
    expect(checkCreateAllowed("manuscript_chapter", { scope: "manuscript", protectedOverrides: none })).toEqual([]);
    expect(checkCreateAllowed("worldbuilding", { scope: "reference", protectedOverrides: none })).toEqual([]);
  });
});
