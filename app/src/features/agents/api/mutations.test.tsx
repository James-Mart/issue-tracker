// @vitest-environment happy-dom
import { act, useRef, type MutableRefObject } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { agentsKeys } from "./keys";
import { useForkConversation } from "./mutations";

const forkConversation = vi.hoisted(() => vi.fn());

vi.mock("./client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./client")>();
  return {
    ...actual,
    forkConversation: (...args: unknown[]) => forkConversation(...args),
  };
});

vi.mock("sonner", () => ({
  toast: { error: vi.fn() },
}));

function testQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
}

function ForkProbe({
  hookRef,
}: {
  hookRef: MutableRefObject<ReturnType<typeof useForkConversation> | null>;
}) {
  const hook = useForkConversation();
  hookRef.current = hook;
  return null;
}

function mountForkHook(): {
  root: Root;
  client: QueryClient;
  invalidateSpy: ReturnType<typeof vi.spyOn>;
  hookRef: MutableRefObject<ReturnType<typeof useForkConversation> | null>;
} {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const client = testQueryClient();
  const invalidateSpy = vi.spyOn(client, "invalidateQueries");
  const hookRef: MutableRefObject<ReturnType<typeof useForkConversation> | null> =
    { current: null };
  act(() => {
    root.render(
      <QueryClientProvider client={client}>
        <ForkProbe hookRef={hookRef} />
      </QueryClientProvider>,
    );
  });
  return { root, client, invalidateSpy, hookRef };
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  forkConversation.mockReset();
  vi.mocked(toast.error).mockReset();
});

afterEach(() => {
  document.body.innerHTML = "";
});

describe("useForkConversation", () => {
  it("invalidates the conversations list on success", async () => {
    forkConversation.mockResolvedValue({ id: "conv-fork-1" });
    const { root, invalidateSpy, hookRef } = mountForkHook();

    await act(async () => {
      hookRef.current!.mutate({ id: "conv-source", seq: 2 });
    });
    await flush();

    expect(forkConversation).toHaveBeenCalledWith("conv-source", { seq: 2 });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: agentsKeys.conversationsPrefix(),
    });
    expect(toast.error).not.toHaveBeenCalled();

    act(() => {
      root.unmount();
    });
  });

  it("reports a failure through the toast path", async () => {
    forkConversation.mockRejectedValue(new Error("fork failed"));
    const { root, invalidateSpy, hookRef } = mountForkHook();

    await act(async () => {
      hookRef.current!.mutate({ id: "conv-source", seq: 1 });
    });
    await flush();

    expect(toast.error).toHaveBeenCalledWith("fork failed");
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: agentsKeys.conversationsPrefix(),
    });

    act(() => {
      root.unmount();
    });
  });
});
