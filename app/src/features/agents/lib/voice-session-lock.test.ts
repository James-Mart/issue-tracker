import { afterEach, describe, expect, it } from "vitest";
import {
  activeOwner,
  release,
  resetVoiceSessionLockForTests,
  reviewVoiceOwner,
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

  it("keeps two review composers from sharing one session", () => {
    const first = reviewVoiceOwner("review:story-1:conversation");
    const second = reviewVoiceOwner("review:story-1:reply:a");
    expect(tryAcquire(first)).toBe(true);
    expect(tryAcquire(second)).toBe(false);
    expect(activeOwner()).toBe(first);

    release(first);
    expect(tryAcquire(second)).toBe(true);
    expect(activeOwner()).toBe(second);
  });

  it("release only clears when the caller is the holder", () => {
    tryAcquire("composer");
    release("description");
    expect(activeOwner()).toBe("composer");

    release("composer");
    expect(activeOwner()).toBeNull();
  });
});
