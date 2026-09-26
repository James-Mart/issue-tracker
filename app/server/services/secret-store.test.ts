import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  deleteSecret,
  listSecretKeys,
  readSecretsForRuntime,
  secretFilePath,
  secretsDir,
  setSecret,
} from "./secret-store.js";

describe("secret store", () => {
  let home: string;
  let previousHome: string | undefined;

  beforeEach(() => {
    previousHome = process.env.HOME;
    home = mkdtempSync(join(tmpdir(), "issue-secret-store-home-"));
    process.env.HOME = home;
  });

  afterEach(() => {
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    if (home) rmSync(home, { recursive: true, force: true });
  });

  it("sets, replaces, and removes secrets with owner-only paths", () => {
    setSecret("proj", "STRIPE_SANDBOX_KEY", "sk_test_abc");
    expect(listSecretKeys("proj")).toEqual(["STRIPE_SANDBOX_KEY"]);
    expect(readSecretsForRuntime("proj")).toEqual({
      STRIPE_SANDBOX_KEY: "sk_test_abc",
    });

    const dir = secretsDir();
    const file = secretFilePath("proj");
    expect(existsSync(dir)).toBe(true);
    expect(existsSync(file)).toBe(true);
    expect(statSync(dir).mode & 0o777).toBe(0o700);
    expect(statSync(file).mode & 0o777).toBe(0o600);

    setSecret("proj", "STRIPE_SANDBOX_KEY", "sk_test_xyz");
    expect(readSecretsForRuntime("proj")).toEqual({
      STRIPE_SANDBOX_KEY: "sk_test_xyz",
    });

    setSecret("proj", "OTHER_KEY", "value");
    expect(listSecretKeys("proj")).toEqual(["OTHER_KEY", "STRIPE_SANDBOX_KEY"]);

    deleteSecret("proj", "OTHER_KEY");
    expect(listSecretKeys("proj")).toEqual(["STRIPE_SANDBOX_KEY"]);

    deleteSecret("proj", "STRIPE_SANDBOX_KEY");
    expect(listSecretKeys("proj")).toEqual([]);
    expect(existsSync(file)).toBe(false);
  });

  it("refuses invalid key names", () => {
    expect(() => setSecret("proj", "lowercase", "x")).toThrow(/invalid secret key/);
    expect(() => setSecret("proj", "1BAD", "x")).toThrow(/invalid secret key/);
    expect(() => deleteSecret("proj", "bad-key")).toThrow(/invalid secret key/);
  });

  it("refuses to read a file whose mode is wider than 0600", () => {
    const dir = secretsDir();
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const file = secretFilePath("proj");
    writeFileSync(
      file,
      `${JSON.stringify({ STRIPE_SANDBOX_KEY: "secret-value" })}\n`,
      { mode: 0o644 },
    );
    expect(() => listSecretKeys("proj")).toThrow(/wider than expected/);
    expect(() => readSecretsForRuntime("proj")).toThrow(/wider than expected/);
    expect(() =>
      setSecret("proj", "OTHER_KEY", "still-secret"),
    ).toThrow(/wider than expected/);

    chmodSync(file, 0o600);
    setSecret("proj", "OTHER_KEY", "ok");
    expect(listSecretKeys("proj").sort()).toEqual([
      "OTHER_KEY",
      "STRIPE_SANDBOX_KEY",
    ]);
    expect(readSecretsForRuntime("proj").OTHER_KEY).toBe("ok");
    expect(
      JSON.stringify(readSecretsForRuntime("proj")),
    ).not.toContain("still-secret");
  });

  it("returns empty state when no store file exists", () => {
    expect(listSecretKeys("missing")).toEqual([]);
    expect(readSecretsForRuntime("missing")).toEqual({});
  });
});
