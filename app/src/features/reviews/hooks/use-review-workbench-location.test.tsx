// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, useNavigate } from "react-router-dom";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { useReviewWorkbenchLocation } from "./use-review-workbench-location";

const SHA = "c1d7f88aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

let root: Root | undefined;
let location: ReturnType<typeof useReviewWorkbenchLocation>;
let navigate: ReturnType<typeof useNavigate>;

function Probe() {
  location = useReviewWorkbenchLocation([SHA]);
  navigate = useNavigate();
  return null;
}

function mount(search: string) {
  root = createRoot(document.createElement("div"));
  act(() => {
    root!.render(
      <MemoryRouter initialEntries={[`/review?${search}`]}>
        <Probe />
      </MemoryRouter>,
    );
  });
}

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
});

describe("useReviewWorkbenchLocation thread reveal", () => {
  it("asks to reveal a deep-linked thread until the Diff reports it revealed", () => {
    mount(`tab=diff&scope=${SHA}&thread=t1`);
    expect(location.threadReveal).toEqual({ threadId: "t1", request: 0 });

    act(() => location.markThreadRevealed({ threadId: "t1", request: 0 }));

    expect(location.threadReveal).toBeNull();
    expect(location.threadId).toBe("t1");
  });

  it("asks again when the same thread is opened again", () => {
    mount(`tab=diff&scope=${SHA}&thread=t1`);
    act(() => location.markThreadRevealed({ threadId: "t1", request: 0 }));

    act(() => location.openThreadInDiff("t1", SHA));

    expect(location.threadReveal).toEqual({ threadId: "t1", request: 1 });
  });

  it("asks for a different thread that arrives without an open", () => {
    mount(`tab=diff&scope=${SHA}&thread=t1`);
    act(() => location.markThreadRevealed({ threadId: "t1", request: 0 }));

    act(() => navigate(`/review?tab=diff&scope=${SHA}&thread=t2`));

    expect(location.threadReveal).toEqual({ threadId: "t2", request: 0 });
  });

  it("keeps one request while widening its scope", () => {
    mount(`tab=diff&scope=${SHA}&thread=t1`);

    act(() => location.retargetThreadScope("all"));

    expect(location.scope).toBe("all");
    expect(location.threadReveal).toEqual({ threadId: "t1", request: 0 });
  });

  it("asks nothing once the thread is closed", () => {
    mount(`tab=diff&scope=${SHA}&thread=t1`);

    act(() => location.setScope("all"));

    expect(location.threadId).toBeNull();
    expect(location.threadReveal).toBeNull();
  });
});
