import { describe, expect, it } from "vitest";
import {
  parseChatCompanionState,
  writeChatCompanionParam,
} from "./chat-companion";

describe("parseChatCompanionState", () => {
  it("defaults to expanded when absent or unknown", () => {
    expect(parseChatCompanionState(null)).toBe("expanded");
    expect(parseChatCompanionState("")).toBe("expanded");
    expect(parseChatCompanionState("other")).toBe("expanded");
  });

  it("accepts expanded and collapsed", () => {
    expect(parseChatCompanionState("expanded")).toBe("expanded");
    expect(parseChatCompanionState("collapsed")).toBe("collapsed");
  });
});

describe("writeChatCompanionParam", () => {
  it("omits chat when expanded (default)", () => {
    const params = new URLSearchParams("chat=collapsed&x=1");
    expect(writeChatCompanionParam(params, "expanded").toString()).toBe("x=1");
  });

  it("sets chat=collapsed when collapsed", () => {
    const params = new URLSearchParams("x=1");
    expect(writeChatCompanionParam(params, "collapsed").toString()).toBe(
      "x=1&chat=collapsed",
    );
    expect(writeChatCompanionParam(params, "collapsed").get("chat")).toBe(
      "collapsed",
    );
  });
});
