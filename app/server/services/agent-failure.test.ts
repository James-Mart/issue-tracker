import { describe, expect, it } from "vitest";
import { classifyAgentFailure } from "./agent-failure.js";

describe("classifyAgentFailure", () => {
  it("returns auth when an auth code and a transport code both appear", () => {
    expect(
      classifyAgentFailure("error", {
        message: "something else",
        code: "unauthenticated",
        name: "NetworkError",
      }),
    ).toBe("auth");
  });
});
