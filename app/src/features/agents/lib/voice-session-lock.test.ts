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
  it("starts with no active owner", () => {
    expect(activeOwner()).toBeNull();
  });

  it("acquires when idle and re-acquires for the same owner", () => {
    expect(tryAcquire("description")).toBe(true);
    expect(activeOwner()).toBe("description");
    expect(tryAcquire("description")).toBe(true);
    expect(activeOwner()).toBe("description");
  });

  it("rejects acquire for the other owner until release", () => {
    expect(tryAcquire("description")).toBe(true);
    expect(tryAcquire("composer")).toBe(false);
    expect(activeOwner()).toBe("description");

    release("description");
    expect(activeOwner()).toBeNull();
    expect(tryAcquire("composer")).toBe(true);
    expect(activeOwner()).toBe("composer");
  });

  it("release only clears when the caller is the holder", () => {
    tryAcquire("composer");
    release("description");
    expect(activeOwner()).toBe("composer");

    release("composer");
    expect(activeOwner()).toBeNull();
  });
});
