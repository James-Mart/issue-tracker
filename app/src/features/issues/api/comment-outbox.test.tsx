// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Comment, CommentInput } from "@server/schemas";
import type { CommentThread } from "../lib/comment-threads";
import { humanComment } from "../lib/comments";
import {
  resetCommentOutboxStore,
  useCommentOutboxStore,
} from "../store/use-comment-outbox-store";
import { usePostComment, useResendComment } from "./mutations";
import { useCommentThreads } from "./queries";

const STORY = "story-1";

type PendingPost = {
  input: CommentInput;
  store: (id: string) => void;
  fail: () => void;
};

let stored: Comment[] = [];
let posts: PendingPost[] = [];

function respond(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function fakeFetch(url: string, init?: RequestInit): Promise<Response> {
  if (url !== `/api/issues/${STORY}/comments`) {
    throw new Error(`unexpected fetch ${url}`);
  }
  if (init?.method !== "POST") {
    return Promise.resolve(respond({ messages: stored, threads: [], problems: [] }));
  }
  const input = JSON.parse(String(init.body)) as CommentInput;
  return new Promise((resolve, reject) => {
    posts.push({
      input,
      store: (id) => {
        const message = { ...input, id, at: "2026-09-30T17:45:00.000Z" };
        stored = [...stored, message];
        resolve(respond(message, 201));
      },
      fail: () => reject(new TypeError("Failed to fetch")),
    });
  });
}

type Api = {
  threads: CommentThread[];
  post: (input: CommentInput) => void;
  resend: (clientId: string) => void;
};

function Probe({ onRender }: { onRender: (api: Api) => void }) {
  const { threads } = useCommentThreads(STORY);
  const post = usePostComment(STORY);
  const resend = useResendComment();
  onRender({ threads, post, resend });
  return null;
}

let root: Root | undefined;
let api!: Api;

async function mount(): Promise<void> {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  root = createRoot(document.createElement("div"));
  await act(async () => {
    root!.render(
      <QueryClientProvider client={client}>
        <Probe onRender={(next) => (api = next)} />
      </QueryClientProvider>,
    );
  });
}

async function settle(step: () => void): Promise<void> {
  await act(async () => {
    step();
  });
}

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  stored = [];
  posts = [];
  vi.stubGlobal("fetch", vi.fn(fakeFetch));
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  vi.unstubAllGlobals();
  resetCommentOutboxStore();
});

describe("comment outbox", () => {
  it("shows a question at once as sending and starting, then hands over to the stored record by client id", async () => {
    await mount();
    await settle(() => api.post(humanComment("Why add two?", "question")));

    expect(posts).toHaveLength(1);
    const clientId = posts[0]!.input.clientId!;
    expect(clientId).toEqual(expect.any(String));
    const [pending] = api.threads;
    expect(pending?.root).toMatchObject({
      id: clientId,
      clientId,
      body: "Why add two?",
      kind: "question",
      delivery: { status: "sending" },
    });
    expect(pending?.researcherRun).toEqual({ status: "starting" });
    expect(pending?.readyToTask).toBe(false);

    await settle(() => posts[0]!.store("stored-1"));
    await act(async () => {
      await vi.waitFor(() => expect(api.threads[0]?.root.id).toBe("stored-1"));
    });

    expect(api.threads).toHaveLength(1);
    expect(api.threads[0]?.root.delivery).toBeUndefined();
    expect(useCommentOutboxStore.getState().byClientId).toEqual({});
  });

  it("keeps a failed reply in its thread with the error, and resend posts the same body and client id", async () => {
    stored = [
      {
        id: "root",
        at: "2026-09-30T17:00:00.000Z",
        role: "human",
        body: "Rename this.",
      },
    ];
    await mount();
    await settle(() => api.post({ role: "human", body: "And here.", replyTo: "root" }));
    const first = posts.shift()!;

    await settle(() => first.fail());
    await act(async () => {
      await vi.waitFor(() =>
        expect(api.threads[0]?.replies[0]?.delivery).toEqual({
          status: "failed",
          error: "Failed to fetch",
        }),
      );
    });
    const failed = api.threads[0]!.replies[0]!;
    expect(failed.body).toBe("And here.");

    await settle(() => api.resend(failed.clientId!));
    expect(api.threads[0]?.replies[0]?.delivery).toEqual({ status: "sending" });
    const second = posts.shift()!;
    expect(second.input).toEqual(first.input);

    await settle(() => second.store("reply-1"));
    await act(async () => {
      await vi.waitFor(() => expect(api.threads[0]?.replies[0]?.id).toBe("reply-1"));
    });
    expect(api.threads[0]?.replies).toHaveLength(1);
    expect(useCommentOutboxStore.getState().byClientId).toEqual({});
  });
});
