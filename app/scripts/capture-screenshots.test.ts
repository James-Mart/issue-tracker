import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_BASE_URL,
  parseArgs,
  resolveDefaultBaseUrl,
} from "./capture-screenshots.js";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("resolveDefaultBaseUrl", () => {
  it("defaults to localhost:8060 when AGENT_STACK_BASE_URL is unset", () => {
    expect(resolveDefaultBaseUrl({})).toBe(DEFAULT_BASE_URL);
  });

  it("uses AGENT_STACK_BASE_URL when set", () => {
    expect(
      resolveDefaultBaseUrl({ AGENT_STACK_BASE_URL: "http://127.0.0.1:41002" }),
    ).toBe("http://127.0.0.1:41002");
  });

  it("strips a trailing slash from AGENT_STACK_BASE_URL", () => {
    expect(
      resolveDefaultBaseUrl({ AGENT_STACK_BASE_URL: "http://127.0.0.1:41002/" }),
    ).toBe("http://127.0.0.1:41002");
  });
});

describe("parseArgs base URL", () => {
  it("picks up AGENT_STACK_BASE_URL from the environment", () => {
    vi.stubEnv("AGENT_STACK_BASE_URL", "http://127.0.0.1:42002");
    expect(parseArgs(["--list"]).baseUrl).toBe("http://127.0.0.1:42002");
  });

  it("lets --base-url override AGENT_STACK_BASE_URL", () => {
    vi.stubEnv("AGENT_STACK_BASE_URL", "http://127.0.0.1:42002");
    expect(parseArgs(["--base-url", "http://127.0.0.1:43002", "--list"]).baseUrl).toBe(
      "http://127.0.0.1:43002",
    );
  });

  it("falls back to 8060 when env is unset", () => {
    delete process.env.AGENT_STACK_BASE_URL;
    expect(parseArgs(["--list"]).baseUrl).toBe(DEFAULT_BASE_URL);
  });
});
