import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveSecretsSet } from "./cli-project-secrets.js";

describe("resolveSecretsSet", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "issue-secrets-set-"));
  });

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it("sets one key from --file or clears one key", () => {
    const path = join(dir, "secret.txt");
    writeFileSync(path, "sk_test_abc");
    expect(
      resolveSecretsSet({ key: "STRIPE_SANDBOX_KEY", file: path }),
    ).toEqual({
      action: "set",
      key: "STRIPE_SANDBOX_KEY",
      value: "sk_test_abc",
    });
    expect(
      resolveSecretsSet({ key: "STRIPE_SANDBOX_KEY", clear: true }),
    ).toEqual({
      action: "delete",
      key: "STRIPE_SANDBOX_KEY",
    });
  });

  it("rejects invalid flags and keys", () => {
    expect(() =>
      resolveSecretsSet({ key: "bad", file: join(dir, "x") }),
    ).toThrow(/invalid secret key/);
    expect(() => resolveSecretsSet({ file: join(dir, "x") })).toThrow(/--key/);
    expect(() =>
      resolveSecretsSet({ key: "STRIPE_SANDBOX_KEY", clear: true, file: "-" }),
    ).toThrow(/--clear cannot be combined with --file/);
    expect(() =>
      resolveSecretsSet({ key: "STRIPE_SANDBOX_KEY", doc: "vision" }),
    ).toThrow(/--doc and --attachment are not valid for secrets/);
  });
});
