import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  PHASE_SECRET_MASK,
  createPhaseOutputMasker,
  loadPhaseSecrets,
  maskSecrets,
} from "./agent-stack-secrets.js";
import { setSecret } from "./secret-store.js";

describe("phase secret masking", () => {
  it("replaces a secret split across chunks and keeps a longer value intact", () => {
    const secrets = {
      STRIPE_SANDBOX_KEY: "sk_test_echo",
      OTHER: "sk_test_echo_longer",
    };
    const masker = createPhaseOutputMasker(secrets);
    expect(masker.push("prefix sk_test_echo_lon")).toBe("prefix ");
    expect(masker.push("ger and sk_test_")).toBe(`${PHASE_SECRET_MASK} and `);
    expect(masker.push("echo\n")).toBe(`${PHASE_SECRET_MASK}\n`);
    expect(masker.flush()).toBe("");
    expect(maskSecrets("sk_test_echo_longer then sk_test_echo", secrets)).toBe(
      `${PHASE_SECRET_MASK} then ${PHASE_SECRET_MASK}`,
    );
  });

  it("masks a secret prefix when the stream closes before the value completes", () => {
    const masker = createPhaseOutputMasker({ STRIPE_SANDBOX_KEY: "sk_test_echo" });
    expect(masker.push("sk_test_")).toBe("");
    expect(masker.flush()).toBe(PHASE_SECRET_MASK);
  });

  it("refuses a secret key that collides with an AGENT_STACK_* variable", () => {
    const previous = process.env.HOME;
    const home = mkdtempSync(join(tmpdir(), "issue-phase-secrets-"));
    process.env.HOME = home;
    try {
      setSecret("proj", "AGENT_STACK_PORT", "leak");
      expect(() => loadPhaseSecrets("proj")).toThrow(
        'secret key "AGENT_STACK_PORT" collides with an AGENT_STACK_* variable',
      );
    } finally {
      if (previous === undefined) delete process.env.HOME;
      else process.env.HOME = previous;
      rmSync(home, { recursive: true, force: true });
    }
  });
});
