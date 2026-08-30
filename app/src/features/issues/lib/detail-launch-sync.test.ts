import { describe, expect, it } from "vitest";
import {
  channelForLaunchKind,
  detailLaunchFaultCopy,
  detailLaunchPendingCopy,
  launchOverlaysChannel,
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

describe("detailLaunchPendingCopy", () => {
  it("names the in-flight work loop", () => {
    expect(detailLaunchPendingCopy("work")).toEqual({
      title: "Starting the work loop…",
      detail:
        "Session create is in flight. The coordinator transcript will open here once the run is acknowledged.",
    });
  });

  it("names the in-flight planning session", () => {
    expect(detailLaunchPendingCopy("planning")).toEqual({
      title: "Starting the planning session…",
      detail:
        "Session create is in flight. The planning transcript will open here once the run is acknowledged.",
    });
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
      hint: "Retire the active run on that epic, then return here.",
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
