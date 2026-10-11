import { describe, expect, it } from "vitest";
import { spawnCliColdBoot, useCliTestFixtures } from "./cli.test-helpers.js";

useCliTestFixtures();

describe("thin shell cold-boot", () => {
  it("exits 0 for --help", () => {
    const { status } = spawnCliColdBoot(["--help"]);
    expect(status).toBe(0);
  });
});
