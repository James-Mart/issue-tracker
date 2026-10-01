// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { CommentMessage, CommentsResponse } from "@server/schemas";
import {
  resetCommentEditStore,
  useCommentEditStore,
} from "../store/use-comment-edit-store";
import { useEditComment } from "./mutations";
import { issuesKeys } from "./keys";

const STORY = "story-1";
const COMMENT: CommentMessage = {
  id: "c1",
  at: "2026-09-28T16:43:00.000Z",
  role: "human",
  body: "Original",
  editable: true,
};

const REFUSAL = 'cannot edit comment "c1": submitted';

let storedBody = COMMENT.body;

type PendingPatch = {
  body: string;
  succeed: () => void;
  refuse: () => void;
};

let patch: PendingPatch | undefined;
let client: QueryClient;
let root: Root | undefined;
let edit!: (body: string) => Promise<CommentMessage>;

function respond(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function comments(): CommentsResponse {
  return {
    messages: [{ ...COMMENT, body: storedBody }],
    threads: [],
    problems: [],
  };
}

function fakeFetch(url: string, init?: RequestInit): Promise<Response> {
  if (url !== `/api/issues/${STORY}/comments` && url !== `/api/issues/${STORY}/comments/c1`) {
    throw new Error(`unexpected fetch ${url}`);
  }
  if (init?.method === "PATCH") {
    const sent = JSON.parse(String(init.body)) as { body: string };
    return new Promise((resolve) => {
      patch = {
        body: sent.body,
        succeed: () => {
          storedBody = sent.body;
          resolve(respond({ ...COMMENT, body: sent.body }));
        },
        refuse: () => resolve(respond({ error: REFUSAL }, 409)),
      };
    });
  }
  return Promise.resolve(respond(comments()));
}

function cachedBody(): string | undefined {
  return client.getQueryData<CommentsResponse>(issuesKeys.comments(STORY))
    ?.messages[0]?.body;
}

function Probe() {
  const mutation = useEditComment(STORY);
  edit = (body) => mutation.mutateAsync({ commentId: "c1", body });
  return null;
}

async function mount(): Promise<void> {
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  client.setQueryData(issuesKeys.comments(STORY), comments());
  root = createRoot(document.createElement("div"));
  await act(async () => {
    root!.render(
      <QueryClientProvider client={client}>
        <Probe />
      </QueryClientProvider>,
    );
  });
}

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  storedBody = COMMENT.body;
  patch = undefined;
  vi.stubGlobal("fetch", vi.fn(fakeFetch));
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  vi.unstubAllGlobals();
  resetCommentEditStore();
});

describe("useEditComment", () => {
  it("shows the new body at once and keeps it when the save lands", async () => {
    await mount();
    let pending!: Promise<CommentMessage>;
    await act(async () => {
      pending = edit("Revised");
      await vi.waitFor(() => expect(patch?.body).toBe("Revised"));
    });
    expect(cachedBody()).toBe("Revised");
    expect(useCommentEditStore.getState().pending.c1).toBe(true);

    await act(async () => {
      patch!.succeed();
      await pending;
    });
    expect(cachedBody()).toBe("Revised");
    expect(useCommentEditStore.getState().errors.c1).toBeUndefined();
    expect(useCommentEditStore.getState().pending.c1).toBeUndefined();
  });

  it("reverts the body and records the refusal when the save is refused", async () => {
    await mount();
    let pending!: Promise<unknown>;
    await act(async () => {
      pending = edit("Revised");
      await vi.waitFor(() => expect(patch?.body).toBe("Revised"));
    });
    expect(cachedBody()).toBe("Revised");

    await act(async () => {
      patch!.refuse();
      await pending.catch(() => undefined);
    });
    expect(cachedBody()).toBe("Original");
    expect(useCommentEditStore.getState().errors.c1).toBe(REFUSAL);
    expect(useCommentEditStore.getState().pending.c1).toBeUndefined();
  });
});
