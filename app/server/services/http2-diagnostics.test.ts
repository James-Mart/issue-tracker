import {
  connect,
  constants,
  createServer,
  type ClientHttp2Session,
  type Http2Server,
  type ServerHttp2Stream,
} from "node:http2";
import { afterEach, describe, expect, it } from "vitest";
import {
  attachSessionDiagnostics,
  installHttp2Diagnostics,
} from "./http2-diagnostics.js";

type ServerBehavior = "ok" | "enhance-your-calm";

let server: Http2Server | undefined;
let session: ClientHttp2Session | undefined;

afterEach(async () => {
  session?.close();
  await new Promise<void>((resolve) => {
    if (!server) return resolve();
    server.close(() => resolve());
  });
  server = undefined;
  session = undefined;
});

async function startServer(behavior: ServerBehavior): Promise<number> {
  server = createServer();
  server.on("stream", (stream: ServerHttp2Stream) => {
    // Closing with a non-zero code makes the server side emit too; it is the
    // client's view this test is about.
    stream.on("error", () => {});
    // Wait for the whole request body so `sent` reflects a complete upload.
    stream.on("data", () => {});
    stream.on("end", () => {
      if (behavior === "enhance-your-calm") {
        stream.close(constants.NGHTTP2_ENHANCE_YOUR_CALM);
        return;
      }
      stream.respond({ ":status": 200 });
      stream.end("pong");
    });
  });
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  return (server!.address() as { port: number }).port;
}

/** Send one POST through a traced session and resolve with the log lines. */
async function traceOneRequest(
  behavior: ServerBehavior,
  body: string,
): Promise<string[]> {
  const port = await startServer(behavior);
  const lines: string[] = [];
  session = connect(`http://127.0.0.1:${port}`);
  attachSessionDiagnostics(session, "session#1", (line) => lines.push(line));

  await new Promise<void>((resolve) => {
    const stream = session!.request({ ":method": "POST", ":path": "/Run" });
    stream.on("error", () => {});
    // Drain, so the response completes the way the SDK's would.
    stream.on("data", () => {});
    stream.on("close", () => resolve());
    stream.end(body);
  });
  return lines;
}

describe("attachSessionDiagnostics", () => {
  it("says nothing about a stream that ends cleanly", async () => {
    const lines = await traceOneRequest("ok", "x".repeat(3 * 1048576));

    expect(lines).toEqual([]);
  });

  it("surfaces the peer refusing an oversized request", async () => {
    const body = "x".repeat(3 * 1048576);
    const lines = await traceOneRequest("enhance-your-calm", body);

    expect(lines).toHaveLength(1);
    // 11 is NGHTTP2_ENHANCE_YOUR_CALM — the signal that a turn was rejected
    // outright rather than lost to a flaky network.
    expect(lines[0]).toContain(
      `rstCode=${constants.NGHTTP2_ENHANCE_YOUR_CALM}`,
    );
    // Enough to identify the turn and its size without a reproduction.
    expect(lines[0]).toContain("POST /Run");
    expect(lines[0]).toContain("sent=3.00MiB");
    expect(lines[0]).toContain("response=none");
  });
});

describe("installHttp2Diagnostics", () => {
  /**
   * This file imports node:http2 at the top, so the ESM namespace is already
   * built by the time the patch lands — exactly the case the guard exists for.
   * The patched path is covered by `attachSessionDiagnostics` above; what
   * matters here is that a patch which cannot work says so instead of leaving
   * the impression that failures will be explained.
   */
  it("reports itself inactive when http2 was imported first", async () => {
    const lines: string[] = [];

    await expect(installHttp2Diagnostics((l) => lines.push(l))).resolves.toBe(
      false,
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("wire diagnostics are inactive");
  });
});
