import { afterEach, describe, expect, it } from "vitest";
import {
  activeOwner,
  release,
  resetVoiceSessionLockForTests,
  tryAcquire,
} from "./voice-session-lock";

afterEach(() => {
  resetVoiceSessionLockForTests();
});

describe("voiceSessionLock", () => {
  it("rejects acquire for the other owner until release", () => {
    expect(tryAcquire("description")).toBe(true);
    expect(tryAcquire("composer")).toBe(false);
    expect(activeOwner()).toBe("description");

    release("description");
    expect(activeOwner()).toBeNull();
    expect(tryAcquire("composer")).toBe(true);
    expect(activeOwner()).toBe("composer");
  });
});
