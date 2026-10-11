import { afterEach, describe, expect, it, vi } from "vitest";
import { transcribeAudio } from "./client";

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify(body),
  } as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("transcribeAudio", () => {
  it("uploads only the viewed samples when given a subarray", async () => {
    const fetchMock = vi.fn((_input: string, init?: RequestInit) => {
      const form = init?.body as FormData;
      const blob = form.get("audio") as Blob;
      return blob.arrayBuffer().then((buf) => {
        expect(buf.byteLength).toBe(8);
        expect(Array.from(new Float32Array(buf))).toEqual([0.5, -0.25]);
        return jsonResponse({ text: "slice" });
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const backing = Float32Array.from([0, 0.5, -0.25, 0]);
    const view = backing.subarray(1, 3);
    await expect(transcribeAudio(view)).resolves.toBe("slice");
  });
});
