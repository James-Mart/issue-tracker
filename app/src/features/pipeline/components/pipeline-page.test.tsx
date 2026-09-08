// @vitest-environment happy-dom
import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import { PIPELINE_RUNS_LIMIT } from "../run-list";
import type { RunSequenceSection } from "../run-sequence";
import {
  deliverTopic,
  FIVE_RUNS,
  flush,
  hasTopicListener,
  inFlightTallRunSequence,
  jsonResponse,
  LIVE_AT_APPEND,
  liveSampleRun,
  mockScrollOverflow,
  mockViewport,
  mountPipelinePage,
  nodeEl,
  pageEyebrow,
  recentRun,
  runCard,
  runCards,
  sequencePaneHeader,
  sequenceScrollBody,
  sequenceSheet,
  sheetCloseControl,
  sourcePanel,
  stubRuns,
  tallRunSequence,
} from "./pipeline-page.test-helpers";

describe("PipelinePage", () => {
  it("renders a Runs eyebrow on /runs", async () => {
    stubRuns();
    const { container } = mountPipelinePage("/runs");
    await flush();
    expect(pageEyebrow(container)).toBe("Runs");
    expect(container.textContent).toContain("Recent runs");
    expect(
      container.querySelector('[role="tablist"][aria-label="Pipeline view"]'),
    ).toBeNull();
  });

  it("redirects /pipeline/runs/:conversationId to /runs/:conversationId", async () => {
    stubRuns(FIVE_RUNS);
    const { container } = mountPipelinePage("/pipeline/runs/c");
    await flush();
    expect(
      container.querySelector('[data-testid="location-probe"]')?.textContent,
    ).toBe("/runs/c");
    expect(pageEyebrow(container)).toBe("Runs");
  });

  it("renders every fetched run newest-first at desktop width", async () => {
    const fetchMock = stubRuns(FIVE_RUNS);
    const { container } = mountPipelinePage("/runs");
    await flush();
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/pipeline/runs?limit=${PIPELINE_RUNS_LIMIT}`,
      expect.anything(),
    );
    expect(
      runCards(container).map((el) => el.getAttribute("data-conversation-id")),
    ).toEqual(["a", "b", "c", "d", "e"]);
    expect(
      container.querySelector('[data-testid="pipeline-run-elision"]'),
    ).toBeNull();
  });

  it("routes selection to /runs/:conversationId", async () => {
    stubRuns(FIVE_RUNS);
    const { container } = mountPipelinePage("/runs");
    await flush();
    act(() => {
      runCard(container, "c").click();
    });
    await flush();
    expect(
      container.querySelector('[data-testid="location-probe"]')?.textContent,
    ).toBe("/runs/c");
    expect(runCard(container, "c").getAttribute("data-current")).toBe("true");
    expect(runCard(container, "c").getAttribute("aria-current")).toBe("true");
  });

  it("marks the run named in the route as selected", async () => {
    stubRuns(FIVE_RUNS);
    const { container } = mountPipelinePage("/runs/d");
    await flush();
    expect(runCard(container, "d").getAttribute("data-current")).toBe("true");
    expect(runCard(container, "a").getAttribute("data-current")).toBeNull();
  });

  it("draws the selected run's sequence at desktop width", async () => {
    const fetchMock = stubRuns(FIVE_RUNS, {
      c: {
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
        tokenTotal: 184_420,
      },
    });
    const { container } = mountPipelinePage("/runs/c");
    await flush();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/pipeline/runs/c",
      expect.anything(),
    );
    const diagram = container.querySelector(
      '[data-testid="run-sequence-diagram"]',
    );
    expect(diagram?.getAttribute("data-layout")).toBe("desktop");
    expect(diagram?.getAttribute("data-condition")).toBe("completed");
    expect(container.textContent).toContain("human replied");
    const desktopHeader = sequencePaneHeader(container);
    expect(desktopHeader.getAttribute("data-layout")).toBe("desktop");
    expect(desktopHeader.querySelector("h2")?.textContent).toBe("Sequence");
    expect(
      container.querySelector('[data-testid="run-sequence-token-total"]')
        ?.textContent,
    ).toBe("184k tokens");
    expect(
      container.querySelector('[data-testid="pipeline-run-sequence-placeholder"]'),
    ).toBeNull();
    expect(
      document.querySelector('[data-testid="pipeline-run-sequence-sheet"]'),
    ).toBeNull();
  });

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

  it("shows the recovered marker beside the condition chip on recovered runs only", async () => {
    stubRuns([
      {
        ...recentRun("clean", "completed", "2026-08-28T15:00:00.000Z"),
      },
      {
        ...recentRun("recovered", "completed", "2026-08-28T14:00:00.000Z"),
        recoveredErrors: 2,
      },
    ]);
    const { container } = mountPipelinePage("/runs");
    await flush();

    const clean = runCard(container, "clean");
    expect(clean.querySelector('[data-condition="completed"]')?.textContent).toBe(
      "done",
    );
    expect(
      clean.querySelector('[data-testid="pipeline-run-recovered-marker"]'),
    ).toBeNull();

    const recovered = runCard(container, "recovered");
    expect(
      recovered.querySelector('[data-condition="completed"]')?.textContent,
    ).toBe("done");
    const marker = recovered.querySelector(
      '[data-testid="pipeline-run-recovered-marker"]',
    );
    expect(marker?.textContent).toBe("↻2");
    expect(marker?.className).toContain("hsl(var(--warn))");
  });

  it("uses the current treatment for a selected failed run the same as a completed one", async () => {
    stubRuns([
      recentRun("done-run", "completed", "2026-08-28T15:00:00.000Z"),
      recentRun("fail-run", "failed", "2026-08-28T14:00:00.000Z"),
    ]);
    const { container } = mountPipelinePage("/runs/fail-run");
    await flush();
    const selectedFailed = runCard(container, "fail-run");
    const unselectedDone = runCard(container, "done-run");
    expect(selectedFailed.getAttribute("data-current")).toBe("true");
    expect(unselectedDone.getAttribute("data-current")).toBeNull();
    expect(selectedFailed.className).toContain("hsl(var(--current))");
    expect(unselectedDone.className).not.toContain("hsl(var(--current))");

    act(() => {
      unselectedDone.click();
    });
    await flush();
    const selectedDone = runCard(container, "done-run");
    const unselectedFailed = runCard(container, "fail-run");
    expect(selectedDone.getAttribute("data-current")).toBe("true");
    expect(unselectedFailed.getAttribute("data-current")).toBeNull();
    expect(selectedDone.className).toContain("hsl(var(--current))");
    expect(unselectedFailed.className).not.toContain("hsl(var(--current))");
    expect(unselectedFailed.getAttribute("data-condition")).toBe("failed");
    expect(selectedDone.getAttribute("data-condition")).toBe("completed");
  });

  it("shows pending while the step source is in flight", async () => {
    vi.stubGlobal("fetch", () => new Promise(() => {}));
    const { container } = mountPipelinePage("/pipelines?step=grill");
    await flush();
    const panel = sourcePanel(container);
    expect(panel.textContent).toContain("Loading step source…");
    expect(panel.textContent).toContain("skills/issue-tracker-plan/SKILL.md");
    expect(panel.querySelector("h1")).toBeNull();
  });

  it("fetches and renders the selected step's markdown", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        source: "skills/issue-tracker-plan/SKILL.md",
        markdown: "# Grill-me protocol\n\nA selected step's defining prose.",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { container } = mountPipelinePage("/pipelines");
    act(() => {
      nodeEl(container, "grill").click();
    });
    expect(nodeEl(container, "grill").getAttribute("data-current")).toBe("true");
    expect(container.textContent).toContain("Loading step source…");

    await flush();

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/pipeline/steps/grill/source",
      expect.anything(),
    );
    const panel = sourcePanel(container);
    expect(panel.textContent).toContain("skills/issue-tracker-plan/SKILL.md");
    expect(panel.textContent).toContain("A selected step's defining prose.");
    expect(panel.querySelector("h1")?.textContent).toBe("Grill-me protocol");
    expect(
      container.querySelector('[data-testid="location-probe"]')?.textContent,
    ).toBe("/pipelines?step=grill");
  });

  it("shows a failed fetch and dismisses back to the undecorated diagram", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ error: "pipeline step not found: grill" }, 404),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { container } = mountPipelinePage("/pipelines?step=grill");
    await flush();

    const panel = sourcePanel(container);
    expect(panel.textContent).toContain("pipeline step not found: grill");
    expect(panel.textContent).toContain("Check the server, then try again.");
    expect(nodeEl(container, "grill").getAttribute("data-current")).toBe("true");

    const close = panel.querySelector('[aria-label="Close"]');
    if (!(close instanceof HTMLElement)) {
      throw new Error("Missing close");
    }
    act(() => {
      close.click();
    });

    expect(
      container.querySelector('[data-testid="pipeline-step-source-panel"]'),
    ).toBeNull();
    expect(nodeEl(container, "grill").getAttribute("data-current")).toBeNull();
    expect(
      container.querySelector('[data-testid="location-probe"]')?.textContent,
    ).toBe("/pipelines");
  });

  it("opens a top sheet with a pinned header at phone width", async () => {
    mockViewport(390);
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        source: "skills/issue-tracker-plan/SKILL.md",
        markdown: "Phone sheet prose.",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { container } = mountPipelinePage("/pipelines?step=grill");
    await flush();
    expect(
      container.querySelector('[data-testid="pipeline-step-source-panel"]'),
    ).toBeNull();
    const sheet = document.querySelector(
      '[data-testid="pipeline-step-source-sheet"]',
    );
    if (!(sheet instanceof HTMLElement)) {
      throw new Error("Missing step source sheet");
    }
    expect(sheet.className).toMatch(/\btop-0\b/);
    expect(sheet.querySelector('[data-testid="pipeline-step-source-header"]'))
      .toBeTruthy();
    expect(sheet.textContent).toContain("Phone sheet prose.");
    expect(sheet.textContent).toContain("skills/issue-tracker-plan/SKILL.md");
    expect(sheet.querySelector("button")?.className).toMatch(/\bmt-auto\b/);
  });

  it("links the selected run root issue from the sequence pane header", async () => {
    stubRuns(FIVE_RUNS, {
      c: {
        condition: "completed",
        lifelines: [
          { id: "human", label: "human", kind: "human" },
          { id: "coordinator", label: "planning", kind: "coordinator" },
        ],
        sections: [],
        beats: [],
        rootIssue: {
          id: "root-task",
          kind: "task",
          title: "First task",
          projectId: "issue-tracker",
        },
      },
    });
    const { container } = mountPipelinePage("/runs/c");
    await flush();

    const link = container.querySelector(
      '[data-testid="run-sequence-root-issue-link"]',
    );
    expect(link).not.toBeNull();
    expect(link?.textContent).toBe("First task");
    expect(link?.getAttribute("href")).toBe(
      "/projects/issue-tracker/issues/root-task",
    );
    expect(container.textContent).toContain("Task");
  });

  it("renders no root issue link when the run has no root issue", async () => {
    stubRuns(FIVE_RUNS, {
      c: {
        condition: "completed",
        lifelines: [
          { id: "human", label: "human", kind: "human" },
          { id: "coordinator", label: "planning", kind: "coordinator" },
        ],
        sections: [],
        beats: [],
      },
    });
    const { container } = mountPipelinePage("/runs/c");
    await flush();

    expect(
      container.querySelector('[data-testid="run-sequence-root-issue-link"]'),
    ).toBeNull();
  });

  it("keeps the sequence pane header height when root issue is absent", async () => {
    const runs = [
      recentRun("with-root", "completed", "2026-08-28T15:00:00.000Z"),
      recentRun("no-root", "completed", "2026-08-28T14:00:00.000Z"),
    ];
    stubRuns(runs, {
      "with-root": {
        condition: "completed",
        lifelines: [
          { id: "human", label: "human", kind: "human" },
          { id: "coordinator", label: "planning", kind: "coordinator" },
        ],
        sections: [],
        beats: [],
        rootIssue: {
          id: "root-task",
          kind: "task",
          title: "First task",
          projectId: "issue-tracker",
        },
      },
      "no-root": {
        condition: "completed",
        lifelines: [
          { id: "human", label: "human", kind: "human" },
          { id: "coordinator", label: "planning", kind: "coordinator" },
        ],
        sections: [],
        beats: [],
      },
    });
    const withIssue = mountPipelinePage("/runs/with-root");
    await flush();
    const withHeight = sequencePaneHeader(withIssue.container).offsetHeight;

    const withoutIssue = mountPipelinePage("/runs/no-root");
    await flush();
    const withoutHeight = sequencePaneHeader(withoutIssue.container).offsetHeight;

    expect(withHeight).toBe(withoutHeight);

    act(() => {
      withIssue.root.unmount();
      withoutIssue.root.unmount();
    });
  });
});
