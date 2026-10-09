import { describe, expect, it } from "vitest";
import { PHASE_SECRET_MASK, createPhaseOutputMasker, maskSecrets } from "./agent-stack-secrets.js";

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
});
