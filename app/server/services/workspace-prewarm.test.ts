import { describe, expect, it } from "vitest";
import { disposeSessionsAndReleasePrewarm } from "./workspace-prewarm.js";

describe("shutdown prewarm releases", () => {
  it("disposes sessions before awaiting a still-pending prewarm", async () => {
    const order: string[] = [];
    let finishPrewarm!: (releases: Array<() => Promise<void>>) => void;
    const pending = new Promise<Array<() => Promise<void>>>((resolve) => {
      finishPrewarm = resolve;
    });

    const shutdown = disposeSessionsAndReleasePrewarm(async () => {
      order.push("dispose");
    }, pending);
    await Promise.resolve();
    order.push("prewarm-done");
    finishPrewarm([
      async () => {
        order.push("release");
      },
    ]);
    await shutdown;

    expect(order).toEqual(["dispose", "prewarm-done", "release"]);
  });
});
