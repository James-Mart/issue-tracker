// @vitest-environment happy-dom
import { act } from "react";
import { describe, expect, it } from "vitest";
import type { RunSequenceSection } from "../run-sequence";
import {
  deliverTopic,
  FIVE_RUNS,
  flush,
  hasTopicListener,
  inFlightTallRunSequence,
  LIVE_AT_APPEND,
  liveSampleRun,
  mockScrollOverflow,
  mockViewport,
  mountPipelinePage,
  runCard,
  runCards,
  sequenceScrollBody,
  sequenceSheet,
  sheetCloseControl,
  stubRuns,
  tallRunSequence,
} from "./pipeline-page.test-helpers";

describe("PipelinePage phone", () => {
  it("scrolls a tall phone rail inside the sequence body while the header and handle stay pinned", async () => {
    mockViewport(390, 640);
    stubRuns(FIVE_RUNS, { e: tallRunSequence(24) });
    mountPipelinePage("/runs/e");
    await flush();

    const sheet = sequenceSheet();
    const scrollBody = sequenceScrollBody(sheet);
    const header = sheet.querySelector('[data-testid="run-sequence-pane-header"]');
    const close = sheetCloseControl(sheet);

    expect(scrollBody.className).toMatch(/overflow-y-auto/);
    expect(header).not.toBeNull();
    expect(scrollBody.contains(header)).toBe(false);
    expect(scrollBody.contains(close)).toBe(false);
    expect(close.className).toMatch(/\bmt-auto\b/);

    const beats = Array.from(
      scrollBody.querySelectorAll('[data-testid="sequence-beat"]'),
    ) as HTMLElement[];
    expect(beats.length).toBe(24);

    mockScrollOverflow(scrollBody, 2400, 200);
    expect(scrollBody.scrollHeight).toBeGreaterThan(scrollBody.clientHeight);

    const lastBeat = beats[beats.length - 1]!;
    const bodyBottom = 400;
    lastBeat.getBoundingClientRect = () =>
      ({
        top: bodyBottom + 40,
        bottom: bodyBottom + 80,
        left: 0,
        right: 0,
        width: 0,
        height: 40,
        x: 0,
        y: bodyBottom + 40,
        toJSON: () => ({}),
      }) as DOMRect;
    scrollBody.getBoundingClientRect = () =>
      ({
        top: 200,
        bottom: bodyBottom,
        left: 0,
        right: 0,
        width: 0,
        height: 200,
        x: 0,
        y: 200,
        toJSON: () => ({}),
      }) as DOMRect;

    expect(lastBeat.getBoundingClientRect().bottom).toBeGreaterThan(
      scrollBody.getBoundingClientRect().bottom,
    );

    act(() => {
      scrollBody.scrollTop = scrollBody.scrollHeight;
    });

    lastBeat.getBoundingClientRect = () =>
      ({
        top: bodyBottom - 60,
        bottom: bodyBottom - 20,
        left: 0,
        right: 0,
        width: 0,
        height: 40,
        x: 0,
        y: bodyBottom - 60,
        toJSON: () => ({}),
      }) as DOMRect;

    expect(lastBeat.getBoundingClientRect().bottom).toBeLessThanOrEqual(
      scrollBody.getBoundingClientRect().bottom + 1,
    );
    expect(lastBeat.getBoundingClientRect().top).toBeGreaterThanOrEqual(
      scrollBody.getBoundingClientRect().top - 1,
    );
  });

  it("preserves mid-trace scroll when a live beat appends on an in-flight phone run", async () => {
    mockViewport(390, 640);
    stubRuns(FIVE_RUNS, { e: inFlightTallRunSequence(24) });
    mountPipelinePage("/runs/e");
    await flush();

    expect(hasTopicListener("conversation:e")).toBe(true);

    const sheet = sequenceSheet();
    const scrollBody = sequenceScrollBody(sheet);
    mockScrollOverflow(scrollBody, 2400, 200);

    const midScrollTop = 400;
    act(() => {
      scrollBody.scrollTop = midScrollTop;
    });
    expect(scrollBody.scrollTop).toBe(midScrollTop);

    const bodyBottom = 400;
    scrollBody.getBoundingClientRect = () =>
      ({
        top: 200,
        bottom: bodyBottom,
        left: 0,
        right: 0,
        width: 0,
        height: 200,
        x: 0,
        y: 200,
        toJSON: () => ({}),
      }) as DOMRect;

    deliverTopic("conversation:e", {
      type: "event",
      seq: 10,
      event: {
        type: "delegation",
        run: liveSampleRun(),
        at: LIVE_AT_APPEND,
        seq: 10,
      },
    });
    await flush();

    expect(scrollBody.scrollTop).toBe(midScrollTop);

    const beats = Array.from(
      scrollBody.querySelectorAll('[data-testid="sequence-beat"]'),
    ) as HTMLElement[];
    expect(beats.length).toBe(25);
    const appended = beats.find(
      (beat) =>
        beat.querySelector('[data-testid="sequence-beat-label"]')?.textContent ===
        "spawn validator",
    );
    if (!appended) {
      throw new Error("missing appended live beat");
    }

    appended.getBoundingClientRect = () =>
      ({
        top: bodyBottom + 40,
        bottom: bodyBottom + 80,
        left: 0,
        right: 0,
        width: 0,
        height: 40,
        x: 0,
        y: bodyBottom + 40,
        toJSON: () => ({}),
      }) as DOMRect;

    expect(appended.getBoundingClientRect().bottom).toBeGreaterThan(
      scrollBody.getBoundingClientRect().bottom,
    );
    expect(appended.getBoundingClientRect().top).toBeGreaterThan(
      scrollBody.getBoundingClientRect().bottom,
    );
  });

  it("draws the selected run on the Rail at phone width", async () => {
    mockViewport(390);
    stubRuns(FIVE_RUNS, {
      e: {
        condition: "completed",
        lifelines: [
          { id: "human", label: "human", kind: "human" },
          { id: "coordinator", label: "planning", kind: "coordinator" },
        ],
        sections: [],
        beats: [
          {
            from: "human",
            to: "coordinator",
            label: "human replied",
            startedAt: "2026-08-28T13:00:00.000Z",
            kind: "human-turn",
          },
        ],
      },
    });
    const { container } = mountPipelinePage("/runs/e");
    await flush();
    const sheet = sequenceSheet();
    expect(sheet.className).toMatch(/\btop-0\b/);
    expect(sheet.className).toMatch(/\bslide-in-from-top\b/);
    const header = sheet.querySelector('[data-testid="run-sequence-pane-header"]');
    expect(header).toBeTruthy();
    const diagram = sheet.querySelector('[data-testid="run-sequence-diagram"]');
    expect(diagram?.getAttribute("data-layout")).toBe("phone");
    expect(sheet.textContent).toContain("human replied");
    expect(sheet.querySelector('[data-testid="sequence-from"]')?.textContent).toBe(
      "human",
    );
    expect(sheet.querySelector('[data-testid="sequence-to"]')?.textContent).toBe(
      "planning",
    );
    expect(sheetCloseControl(sheet).className).toMatch(/\bmt-auto\b/);
    expect(
      container.querySelector('[data-testid="pipeline-run-list"]')
        ?.querySelector('[data-testid="run-sequence-diagram"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-testid="pipeline-run-sequence-placeholder"]'),
    ).toBeNull();
  });

  it("stacks the phone sheet header so Sequence does not collide with issue and tokens", async () => {
    mockViewport(390);
    stubRuns(FIVE_RUNS, {
      e: {
        condition: "completed",
        lifelines: [
          { id: "coordinator", label: "Stakeholder", kind: "coordinator" },
        ],
        sections: [],
        beats: [],
        tokenTotal: 1_918_558,
        rootIssue: {
          id: "scrollable-runs",
          kind: "idea",
          title: "Scrollable runs",
          projectId: "issue-tracker",
        },
      },
    });
    mountPipelinePage("/runs/e");
    await flush();
    const header = sequenceSheet().querySelector(
      '[data-testid="run-sequence-pane-header"]',
    );
    expect(header?.getAttribute("data-layout")).toBe("phone");
    expect(header?.className).toMatch(/flex-col/);
    expect(header?.querySelector("h2")).toBeNull();
    expect(
      header?.querySelector('[data-testid="run-sequence-root-issue-link"]')
        ?.textContent,
    ).toBe("Scrollable runs");
    expect(
      header?.querySelector('[data-testid="run-sequence-token-total"]')
        ?.textContent,
    ).toBe("1.9M tokens");
    expect(
      header?.querySelector('[data-testid="run-sequence-header-meta"]'),
    ).not.toBeNull();
  });

  it("dismisses the phone sequence sheet back to /runs", async () => {
    mockViewport(390);
    stubRuns(FIVE_RUNS);
    const { container } = mountPipelinePage("/runs/e");
    await flush();
    const sheet = sequenceSheet();
    act(() => {
      sheetCloseControl(sheet).click();
    });
    await flush();
    expect(
      document.querySelector('[data-testid="pipeline-run-sequence-sheet"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-testid="location-probe"]')?.textContent,
    ).toBe("/runs");
    expect(runCard(container, "e").getAttribute("data-current")).toBeNull();
  });

  it("names each model variant on the phone rail caption", async () => {
    mockViewport(390);
    stubRuns(FIVE_RUNS, {
      e: {
        condition: "completed",
        lifelines: [
          { id: "coordinator", label: "Coordinator", kind: "coordinator" },
          {
            id: "implementor",
            label: "Implementor",
            kind: "role",
          },
        ],
        sections: [],
        beats: [
          {
            from: "coordinator",
            to: "implementor",
            label: "spawn Implementor (composer)",
            startedAt: "2026-08-28T13:00:00.000Z",
            durationMs: 30_000,
            kind: "spawn",
            turns: [
              {
                label: "spawn Implementor (composer)",
                startedAt: "2026-08-28T13:00:00.000Z",
                durationMs: 12_000,
              },
              {
                label: "spawn Implementor (sonnet)",
                startedAt: "2026-08-28T13:00:00.000Z",
                durationMs: 18_000,
              },
            ],
          },
        ],
      },
    });
    mountPipelinePage("/runs/e");
    await flush();
    const sheet = sequenceSheet();
    expect(
      sheet.querySelector('[data-testid="sequence-beat-label"]')?.textContent,
    ).toBe("spawn Implementor (composer)");
    const expand = sheet.querySelector(
      '[data-testid="sequence-beat"][data-row="collapsed"] button',
    );
    if (!(expand instanceof HTMLElement)) {
      throw new Error("missing expand control");
    }
    act(() => {
      expand.click();
    });
    const turnLabels = Array.from(
      sheet.querySelectorAll(
        '[data-testid="sequence-beat"][data-row="turn"] [data-testid="sequence-beat-label"]',
      ),
    ).map((el) => el.textContent);
    expect(turnLabels).toEqual([
      "spawn Implementor (composer)",
      "spawn Implementor (sonnet)",
    ]);
    expect(sheet.querySelector('[data-testid="sequence-to"]')?.textContent).toBe(
      "Implementor",
    );
  });

  it("draws an open spawn on the phone rail with a cyan dashed arrow", async () => {
    mockViewport(390);
    stubRuns(FIVE_RUNS, {
      e: {
        condition: "completed",
        lifelines: [
          { id: "human", label: "Human", kind: "human" },
          { id: "coordinator", label: "Stakeholder", kind: "coordinator" },
          { id: "retro", label: "Retro", kind: "role" },
        ],
        sections: [],
        beats: [
          {
            from: "coordinator",
            to: "retro",
            label: "spawn Retro",
            startedAt: "2026-08-28T13:00:00.000Z",
            kind: "spawn",
            indeterminate: true,
          },
        ],
      },
    });
    mountPipelinePage("/runs/e");
    await flush();
    const sheet = sequenceSheet();
    const diagram = sheet.querySelector('[data-testid="run-sequence-diagram"]');
    expect(diagram?.getAttribute("data-layout")).toBe("phone");
    const label = sheet.querySelector('[data-testid="sequence-beat-label"]');
    expect(label?.textContent).toBe("spawn Retro");
    expect(label?.textContent).not.toMatch(/no return/);
    expect(label?.closest("p")?.className).toContain("hsl(var(--current))");
    expect(sheet.querySelector(".animate-spin")).toBeNull();
    const arrow = sheet.querySelector(
      '[data-testid="sequence-arrow"][data-kind="spawn"]',
    );
    expect(arrow?.getAttribute("data-indeterminate")).toBe("true");
    expect(
      arrow?.querySelector('[data-testid="sequence-arrow-open-head"]'),
    ).not.toBeNull();
  });

  const PHONE_NESTED_SECTIONS: RunSequenceSection[] = [
    { beatStart: 0, beatEnd: 0, children: [] },
    {
      issueId: "pipeline-fixes",
      kind: "epic",
      title: "Pipeline fixes",
      beatStart: 1,
      beatEnd: 4,
      children: [
        {
          issueId: "run-status-semantics",
          kind: "story",
          title: "Run status semantics",
          beatStart: 1,
          beatEnd: 2,
          children: [],
        },
        {
          issueId: "diagram-grouping",
          kind: "story",
          title: "Diagram issue grouping",
          beatStart: 3,
          beatEnd: 4,
          children: [],
        },
      ],
    },
  ];

  function phoneSectionHeaders(container: ParentNode) {
    return Array.from(
      container.querySelectorAll('[data-testid="sequence-section"]'),
    ).map((el) => ({
      kind: el.getAttribute("data-kind"),
      title: el.querySelector('[data-testid="sequence-section-title"]')
        ?.textContent,
      expanded: el.getAttribute("aria-expanded"),
    }));
  }

  it("renders issue section headers on the phone rail", async () => {
    mockViewport(390);
    stubRuns(FIVE_RUNS, {
      e: {
        condition: "completed",
        lifelines: [
          { id: "human", label: "human", kind: "human" },
          { id: "coordinator", label: "planning", kind: "coordinator" },
          { id: "research", label: "research", kind: "role" },
        ],
        sections: PHONE_NESTED_SECTIONS,
        beats: [
          {
            from: "human",
            to: "coordinator",
            label: "human replied",
            startedAt: "2026-08-28T12:00:00.000Z",
            kind: "human-turn",
          },
          {
            from: "coordinator",
            to: "research",
            label: "spawn research",
            startedAt: "2026-08-28T12:01:00.000Z",
            durationMs: 45_000,
            kind: "spawn",
          },
          {
            from: "research",
            to: "coordinator",
            label: "research returned",
            startedAt: "2026-08-28T12:01:45.000Z",
            durationMs: 92_000,
            kind: "return",
          },
          {
            from: "coordinator",
            to: "research",
            label: "spawn git",
            startedAt: "2026-08-28T12:03:00.000Z",
            durationMs: 22_000,
            kind: "spawn",
          },
          {
            from: "research",
            to: "coordinator",
            label: "git returned",
            startedAt: "2026-08-28T12:03:22.000Z",
            durationMs: 180_000,
            kind: "return",
          },
        ],
      },
    });
    mountPipelinePage("/runs/e");
    await flush();
    const sheet = sequenceSheet();
    expect(
      sheet.querySelector('[data-testid="run-sequence-diagram"]')?.getAttribute(
        "data-layout",
      ),
    ).toBe("phone");
    expect(phoneSectionHeaders(sheet)).toEqual([
      { kind: "epic", title: "Pipeline fixes", expanded: "true" },
      { kind: "story", title: "Run status semantics", expanded: "true" },
      { kind: "story", title: "Diagram issue grouping", expanded: "true" },
    ]);
    expect(
      Array.from(sheet.querySelectorAll('[data-testid="sequence-beat"]')).map(
        (el) => el.getAttribute("data-beat-index"),
      ),
    ).toEqual(["0", "1", "2", "3", "4"]);
  });

  it("collapsing a phone rail section hides only its own beats", async () => {
    mockViewport(390);
    stubRuns(FIVE_RUNS, {
      e: {
        condition: "completed",
        lifelines: [
          { id: "human", label: "human", kind: "human" },
          { id: "coordinator", label: "planning", kind: "coordinator" },
          { id: "research", label: "research", kind: "role" },
        ],
        sections: PHONE_NESTED_SECTIONS,
        beats: [
          {
            from: "human",
            to: "coordinator",
            label: "human replied",
            startedAt: "2026-08-28T12:00:00.000Z",
            kind: "human-turn",
          },
          {
            from: "coordinator",
            to: "research",
            label: "spawn research",
            startedAt: "2026-08-28T12:01:00.000Z",
            durationMs: 45_000,
            kind: "spawn",
          },
          {
            from: "research",
            to: "coordinator",
            label: "research returned",
            startedAt: "2026-08-28T12:01:45.000Z",
            durationMs: 92_000,
            kind: "return",
          },
          {
            from: "coordinator",
            to: "research",
            label: "spawn git",
            startedAt: "2026-08-28T12:03:00.000Z",
            durationMs: 22_000,
            kind: "spawn",
          },
          {
            from: "research",
            to: "coordinator",
            label: "git returned",
            startedAt: "2026-08-28T12:03:22.000Z",
            durationMs: 180_000,
            kind: "return",
          },
        ],
      },
    });
    mountPipelinePage("/runs/e");
    await flush();
    const sheet = sequenceSheet();
    const story = Array.from(
      sheet.querySelectorAll('[data-testid="sequence-section"]'),
    ).find(
      (el) =>
        el.querySelector('[data-testid="sequence-section-title"]')
          ?.textContent === "Run status semantics",
    );
    if (!(story instanceof HTMLElement)) {
      throw new Error("missing story section header");
    }
    act(() => {
      story.click();
    });
    expect(story.getAttribute("aria-expanded")).toBe("false");
    expect(
      Array.from(sheet.querySelectorAll('[data-testid="sequence-beat"]')).map(
        (el) => el.getAttribute("data-beat-index"),
      ),
    ).toEqual(["0", "3", "4"]);
    expect(phoneSectionHeaders(sheet)).toEqual([
      { kind: "epic", title: "Pipeline fixes", expanded: "true" },
      { kind: "story", title: "Run status semantics", expanded: "false" },
      { kind: "story", title: "Diagram issue grouping", expanded: "true" },
    ]);
  });

  it("renders every fetched run at phone width with no elision", async () => {
    mockViewport(390);
    stubRuns(FIVE_RUNS);
    const { container } = mountPipelinePage("/runs/e");
    await flush();
    expect(
      runCards(container).map((el) => el.getAttribute("data-conversation-id")),
    ).toEqual(["a", "b", "c", "d", "e"]);
    expect(
      container.querySelector('[data-testid="pipeline-run-elision"]'),
    ).toBeNull();
  });
});
