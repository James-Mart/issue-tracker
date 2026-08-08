import { describe, expect, it } from "vitest";
import {
  parseChatCompanionPreference,
  resolveChatCompanionExpanded,
  writeChatCompanionParam,
} from "./chat-companion";

describe("parseChatCompanionPreference", () => {
  it("defaults to adaptive when absent or unknown", () => {
    expect(parseChatCompanionPreference(null)).toBe("adaptive");
    expect(parseChatCompanionPreference("")).toBe("adaptive");
    expect(parseChatCompanionPreference("other")).toBe("adaptive");
  });

  it("accepts expanded and collapsed", () => {
    expect(parseChatCompanionPreference("expanded")).toBe("expanded");
    expect(parseChatCompanionPreference("collapsed")).toBe("collapsed");
  });
});

describe("writeChatCompanionParam", () => {
  it("sets chat=expanded when expanded (explicit override)", () => {
    const params = new URLSearchParams("chat=collapsed&x=1");
    expect(writeChatCompanionParam(params, "expanded").toString()).toBe(
      "chat=expanded&x=1",
    );
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

describe("resolveChatCompanionExpanded", () => {
  it("honors explicit overrides", () => {
    expect(
      resolveChatCompanionExpanded("expanded", {
        hasMessages: false,
        agentLive: false,
      }),
    ).toBe(true);
    expect(
      resolveChatCompanionExpanded("collapsed", {
        hasMessages: true,
        agentLive: true,
      }),
    ).toBe(false);
  });

  it("opens adaptively when there are messages or a live agent", () => {
    expect(
      resolveChatCompanionExpanded("adaptive", {
        hasMessages: true,
        agentLive: false,
      }),
    ).toBe(true);
    expect(
      resolveChatCompanionExpanded("adaptive", {
        hasMessages: false,
        agentLive: true,
      }),
    ).toBe(true);
    expect(
      resolveChatCompanionExpanded("adaptive", {
        hasMessages: false,
        agentLive: false,
      }),
    ).toBe(false);
  });
});
