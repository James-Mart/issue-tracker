import { describe, expect, it } from "vitest";
import { alignOf, isHumanRole, lastAgentMessageIndex } from "./message";

describe("isHumanRole", () => {
  it("treats human as the composer role", () => {
    expect(isHumanRole("human")).toBe(true);
  });

  it("treats agent and other roles as non-human", () => {
    expect(isHumanRole("agent")).toBe(false);
    expect(isHumanRole("implementor")).toBe(false);
  });
});

describe("alignOf", () => {
  it("aligns human messages to the end", () => {
    expect(alignOf("human")).toBe("end");
  });

  it("aligns non-human messages to the start", () => {
    expect(alignOf("agent")).toBe("start");
    expect(alignOf("stakeholder")).toBe("start");
  });
});

describe("lastAgentMessageIndex", () => {
  it("returns the latest non-human message index", () => {
    expect(
      lastAgentMessageIndex([
        { role: "agent" },
        { role: "human" },
        { role: "implementor" },
        { role: "human" },
      ]),
    ).toBe(2);
  });

  it("returns -1 when only human messages exist", () => {
    expect(lastAgentMessageIndex([{ role: "human" }])).toBe(-1);
  });
});
