import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api/errors";
import {
  implementingLaunchCopy,
  implementingSessionMessage,
  implementingSessionModel,
  implementingSessionTitle,
  isImplementingWorkRoot,
  parseImplementingLockRefusal,
  WORK_LOOP_COORDINATOR_MODEL,
} from "./implementing-launch";

describe("implementingSessionTitle", () => {
  it("templates the title from the issue title", () => {
    expect(implementingSessionTitle("Ship it")).toBe("Implement Ship it");
  });
});

describe("implementingSessionModel", () => {
  it("prefers the work-loop coordinator model when listed", () => {
    expect(
      implementingSessionModel([
        { id: "claude-opus-5", displayName: "Opus 5" },
        { id: WORK_LOOP_COORDINATOR_MODEL, displayName: "Composer 2.5" },
      ]),
    ).toBe(WORK_LOOP_COORDINATOR_MODEL);
  });

  it("falls back to the default conversation model", () => {
    expect(
      implementingSessionModel([
        { id: "claude-opus-5", displayName: "Opus 5" },
      ]),
    ).toBe("claude-opus-5");
  });
});

describe("implementingSessionMessage", () => {
  it("names the work-root id and issue-tracker-work skill", () => {
    expect(implementingSessionMessage("ship-it")).toBe(
      "Work ship-it in the issue tracker using the issue-tracker-work skill.",
    );
  });
});

describe("implementingLaunchCopy", () => {
  it("describes what the work loop will do", () => {
    const copy = implementingLaunchCopy();
    expect(copy.actionLabel).toBe("Start work loop");
    expect(copy.detail).toContain("coordinator");
    expect(copy.detail).toContain("implementors");
  });
});

describe("isImplementingWorkRoot", () => {
  const epic = {
    kind: "epic" as const,
    id: "ship-it",
    title: "Ship it",
    partOf: "platform",
    status: "open" as const,
    order: 0,
    archived: false,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
  };
  const projectStory = {
    kind: "story" as const,
    id: "root-story",
    title: "Root story",
    partOf: "platform",
    status: "todo" as const,
    order: 0,
    archived: false,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
  };

  it("accepts Epics on the implementing channel", () => {
    expect(isImplementingWorkRoot("implementing", epic)).toBe(true);
  });

  it("accepts project-level Stories on the implementing channel", () => {
    expect(
      isImplementingWorkRoot("implementing", projectStory, "project"),
    ).toBe(true);
  });

  it("rejects Epic Stories and other kinds", () => {
    expect(
      isImplementingWorkRoot("implementing", projectStory, "epic"),
    ).toBe(false);
    expect(isImplementingWorkRoot("planning", epic)).toBe(false);
  });
});

describe("parseImplementingLockRefusal", () => {
  it("reads holder fields from a 409 ApiError body", () => {
    expect(
      parseImplementingLockRefusal(
        new ApiError("conflict", 409, {
          error: "locked",
          holderIssueId: "ship-it",
          holderIssueTitle: "Ship it",
        }),
      ),
    ).toEqual({
      holderIssueId: "ship-it",
      holderIssueTitle: "Ship it",
    });
  });

  it("returns undefined for other errors", () => {
    expect(parseImplementingLockRefusal(new Error("nope"))).toBeUndefined();
    expect(
      parseImplementingLockRefusal(new ApiError("bad", 500, {})),
    ).toBeUndefined();
  });
});
