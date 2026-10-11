import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { beforeEach, describe, expect, it } from "vitest";
import { runIssueCli } from "./cli-program.js";
import { env, nextAt, useCliTestFixtures, writeIssue } from "./cli.test-helpers.js";

useCliTestFixtures();

describe("project secrets", () => {
  beforeEach(() => {
    writeIssue("p", { kind: "project", title: "Proj", createdAt: nextAt(), updatedAt: nextAt() });
  });

  it("sets, gets, clears, and surfaces secrets without printing values", async () => {
    const home = mkdtempSync(join(tmpdir(), "issue-cli-secrets-home-"));
    const secretValue = "sk_test_super_secret_value";
    const cliEnv = () => ({ ...env(), HOME: home });
    try {
      expect(
        (await runIssueCli([
          "project",
          "set",
          "p",
          "secrets",
          "--key",
          "STRIPE_SANDBOX_KEY",
          "--file",
          "-",
        ], {
          env: cliEnv(),
          stdin: `${secretValue}\n`,
        })).status,
      ).toBe(0);

      const got = await runIssueCli(["project", "get", "p", "secrets"], {
        env: cliEnv(),
      });
      expect(got.status).toBe(0);
      expect(got.stdout).toBe("STRIPE_SANDBOX_KEY\n");
      expect(got.stdout).not.toContain(secretValue);

      const summary = await runIssueCli(["summary", "p"], { env: cliEnv() });
      expect(summary.status).toBe(0);
      expect(summary.stdout).toContain("  secrets: STRIPE_SANDBOX_KEY");
      expect(summary.stdout).not.toContain(secretValue);

      expect(
        (await runIssueCli([
          "project",
          "set",
          "p",
          "secrets",
          "--key",
          "STRIPE_SANDBOX_KEY",
          "--file",
          "-",
        ], {
          env: cliEnv(),
          stdin: "sk_test_replaced\n",
        })).status,
      ).toBe(0);
      expect(
        (await runIssueCli(["project", "get", "p", "secrets"], { env: cliEnv() }))
          .stdout,
      ).toBe("STRIPE_SANDBOX_KEY\n");

      expect(
        (await runIssueCli([
          "project",
          "set",
          "p",
          "secrets",
          "--key",
          "STRIPE_SANDBOX_KEY",
          "--clear",
        ], { env: cliEnv() })).status,
      ).toBe(0);
      expect(
        (await runIssueCli(["project", "get", "p", "secrets"], { env: cliEnv() }))
          .stdout,
      ).toBe("");
      expect(
        (await runIssueCli(["summary", "p"], { env: cliEnv() })).stdout,
      ).not.toContain("  secrets:");
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
