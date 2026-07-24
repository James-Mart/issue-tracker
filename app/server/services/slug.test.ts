import { describe, expect, it } from "vitest";
import { firstFreeSuffixedName, slugify, uniqueSlug } from "./slug";

describe("slugify", () => {
  it("lowercases and hyphenates words", () => {
    expect(slugify("Add auth endpoints")).toBe("add-auth-endpoints");
  });

  it("strips punctuation and collapses separators", () => {
    expect(slugify("  Fix: the (login)  bug!! ")).toBe("fix-the-login-bug");
  });

  it("is stable for an already-slugged title", () => {
    expect(slugify("add-auth")).toBe("add-auth");
  });

  it("falls back to a placeholder when nothing usable remains", () => {
    expect(slugify("!!!")).toBe("issue");
  });
});

describe("firstFreeSuffixedName", () => {
  it("returns preferred when free", () => {
    expect(firstFreeSuffixedName("add-auth", "", [])).toBe("add-auth");
    expect(firstFreeSuffixedName("foo", ".tsx", [])).toBe("foo.tsx");
  });

  it("suffixes numerically on collision", () => {
    expect(firstFreeSuffixedName("add-auth", "", ["add-auth"])).toBe(
      "add-auth-2",
    );
    expect(firstFreeSuffixedName("foo", ".tsx", ["foo.tsx"])).toBe("foo-2.tsx");
  });

  it("increments past consecutive collisions", () => {
    expect(
      firstFreeSuffixedName("add-auth", "", ["add-auth", "add-auth-2"]),
    ).toBe("add-auth-3");
    expect(
      firstFreeSuffixedName("foo", ".tsx", ["foo.tsx", "foo-2.tsx"]),
    ).toBe("foo-3.tsx");
  });

  it("skips gaps to the first free suffix", () => {
    expect(
      firstFreeSuffixedName("add-auth", "", ["add-auth", "add-auth-3"]),
    ).toBe("add-auth-2");
    expect(
      firstFreeSuffixedName("foo", ".tsx", [
        "foo.tsx",
        "foo-2.tsx",
        "foo-4.tsx",
      ]),
    ).toBe("foo-3.tsx");
  });
});

describe("uniqueSlug", () => {
  it("slugifies then applies firstFreeSuffixedName", () => {
    expect(uniqueSlug("Add auth", [])).toBe("add-auth");
    expect(uniqueSlug("Add auth", ["add-auth"])).toBe("add-auth-2");
    expect(uniqueSlug("Add auth", ["add-auth", "add-auth-3"])).toBe(
      "add-auth-2",
    );
  });
});
