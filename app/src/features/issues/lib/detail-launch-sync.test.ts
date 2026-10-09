import { describe, expect, it } from "vitest";
import {
  channelForLaunchKind,
  detailLaunchFaultCopy,
  detailLaunchPendingCopy,
  launchOverlaysChannel,
  launchTranscriptSession,
} from "./detail-launch-sync";

describe("channelForLaunchKind", () => {
  it("maps work to implementing and planning to planning", () => {
    expect(channelForLaunchKind("work")).toBe("implementing");
    expect(channelForLaunchKind("planning")).toBe("planning");
  });
});

describe("launchOverlaysChannel", () => {
  it("lights only the matching issue and channel", () => {
    expect(
      launchOverlaysChannel("auth", "implementing", {
        issueId: "auth",
        kind: "work",
      }),
    ).toBe(true);
    expect(
      launchOverlaysChannel("auth", "planning", {
        issueId: "auth",
        kind: "work",
      }),
    ).toBe(false);
    expect(
      launchOverlaysChannel("other", "implementing", {
        issueId: "auth",
        kind: "work",
      }),
    ).toBe(false);
    expect(launchOverlaysChannel("auth", "implementing", null)).toBe(false);
  });
});

const waitingLine =
  "The transcript opens here as soon as the session appears.";

describe("detailLaunchPendingCopy", () => {
  it("names the in-flight work loop", () => {
    expect(detailLaunchPendingCopy("work")).toEqual({
      title: "Starting the work loop…",
      detail: waitingLine,
    });
  });

  it("names the in-flight planning session", () => {
    expect(detailLaunchPendingCopy("planning")).toEqual({
      title: "Starting the planning session…",
      detail: waitingLine,
    });
  });
});

describe("launchTranscriptSession", () => {
  const older = {
    id: "older",
    createdAt: "2026-08-01T00:00:00.000Z",
    archived: false,
  };
  const opened = {
    id: "opened",
    createdAt: "2026-08-02T00:00:00.000Z",
    archived: false,
  };

  it("returns the resume row even when it predates the launch", () => {
    expect(
      launchTranscriptSession(
        {
          startedAt: "2026-08-03T00:00:00.000Z",
          resumeSession: {
            id: "older",
            title: "Implement",
            model: "composer-2.5",
          },
        },
        [older],
      ),
    ).toBe(older);
  });

  it("returns nothing when the resume id is not in the list yet", () => {
    expect(
      launchTranscriptSession(
        {
          startedAt: "2026-08-03T00:00:00.000Z",
          resumeSession: {
            id: "missing",
            title: "Implement",
            model: "composer-2.5",
          },
        },
        [older],
      ),
    ).toBeUndefined();
  });

  it("returns the newest session created at or after the launch began", () => {
    expect(
      launchTranscriptSession(
        { startedAt: "2026-08-02T00:00:00.000Z" },
        [older, opened],
      ),
    ).toBe(opened);
    expect(
      launchTranscriptSession({ startedAt: opened.createdAt }, [older, opened]),
    ).toBe(opened);
  });

  it("ignores an archived session and a session from before the launch", () => {
    expect(
      launchTranscriptSession({ startedAt: "2026-08-02T00:00:00.000Z" }, [
        older,
        { ...opened, archived: true },
      ]),
    ).toBeUndefined();
  });
});

describe("detailLaunchFaultCopy", () => {
  it("names a 409 implementing lock", () => {
    expect(
      detailLaunchFaultCopy({
        issueId: "auth",
        kind: "work",
        lockHolderTitle: "Push notifications",
        status: 409,
      }),
    ).toEqual({
      message:
        "Session create rejected — implementing lock held by Push notifications (409).",
      hint: "Start the work loop again.",
    });
  });

  it("names a generic work-loop rejection", () => {
    expect(
      detailLaunchFaultCopy({
        issueId: "auth",
        kind: "work",
        errorMessage: "upstream refused",
      }),
    ).toEqual({
      message: "Session create rejected — upstream refused.",
      hint: "Start the work loop again.",
    });
  });
});
