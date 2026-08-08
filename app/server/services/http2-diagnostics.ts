import { createRequire } from "node:module";
import type {
  ClientHttp2Session,
  ClientHttp2Stream,
  IncomingHttpStatusHeader,
  OutgoingHttpHeaders,
} from "node:http2";

/**
 * Wire tracing for the HTTP/2 sessions the Cursor SDK's agent stream runs over.
 *
 * The SDK reports a failed turn as the single string "Connection failed
 * repeatedly", and that string is all the app ever sees: the underlying error
 * is thrown and converted deep inside the SDK, `run.wait()` resolves with only
 * the message, and the run store records only the message too. So a turn that
 * dies on the wire is indistinguishable from a flaky network — which cost a
 * long investigation to tell apart once, when the real cause was the server
 * answering an 18 MiB request with RST_STREAM / NGHTTP2_ENHANCE_YOUR_CALM.
 *
 * This runs unconditionally so that the next occurrence is already explained in
 * the log, with no flag to have known about in advance and nothing to
 * reproduce. Being always on is what dictates the shape of everything below:
 *
 * - A stream that ends cleanly logs nothing. Output means something went wrong.
 * - Nothing is measured per chunk. Response size in particular is deliberately
 *   not counted, because that needs a `data` listener on every token delta of
 *   every run — on the very stream the SDK is reading, where adding one also
 *   risks flipping it into flowing mode. The response is summarised by its
 *   `:status`, which arrives once. Request size is counted, because it is the
 *   number that diagnoses an oversized turn and the upload is a handful of
 *   chunks rather than a stream of them.
 *
 * Silence therefore means healthy. The one thing that would make silence a lie
 * — the patch failing to land — is reported when it happens.
 */

const NO_ERROR = 0;

export type DiagnosticLog = (line: string) => void;

const defaultLog: DiagnosticLog = (line) => console.error(line);

function mib(bytes: number): string {
  return `${(bytes / 1048576).toFixed(2)}MiB`;
}

/** Buffers answer in O(1); only strings have to be scanned. */
function byteLength(chunk: unknown): number {
  if (Buffer.isBuffer(chunk)) return chunk.length;
  if (typeof chunk === "string") return Buffer.byteLength(chunk);
  return 0;
}

/** http2 also accepts headers as a flat array; only the object form is named. */
function describeRequest(
  headers: OutgoingHttpHeaders | readonly string[] | undefined,
): string {
  if (headers === undefined || Array.isArray(headers)) return "(request)";
  const { ":method": method, ":path": path } = headers as OutgoingHttpHeaders;
  return `${String(method ?? "?")} ${String(path ?? "?")}`;
}

/**
 * Wire one session's lifecycle to `log`, reporting only failures.
 *
 * `session.request` is wrapped rather than the socket watched, because the
 * question worth answering is per-request ("how big was this turn, and did the
 * peer reject it?"), and a session multiplexes many.
 */
export function attachSessionDiagnostics(
  session: ClientHttp2Session,
  label: string,
  log: DiagnosticLog = defaultLog,
): void {
  // A GOAWAY carrying NO_ERROR is an ordinary graceful shutdown.
  session.on("goaway", (code, lastStreamID) => {
    if (code === NO_ERROR) return;
    log(`[h2 ${label}] GOAWAY code=${code} lastStreamID=${lastStreamID}`);
  });
  session.on("error", (err) => log(`[h2 ${label}] session error: ${err.message}`));

  const request = session.request.bind(session);
  let streamSeq = 0;
  session.request = ((
    headers?: OutgoingHttpHeaders | readonly string[],
    options?: Parameters<ClientHttp2Session["request"]>[1],
  ) => {
    const stream: ClientHttp2Stream = request(headers, options);
    const tag = `${label}/stream#${++streamSeq}`;
    const startedAt = Date.now();
    let sent = 0;
    let status: number | undefined;
    let failure: string | undefined;

    const write = stream.write.bind(stream);
    stream.write = ((chunk: unknown, ...rest: unknown[]) => {
      sent += byteLength(chunk);
      return (write as (...a: unknown[]) => boolean)(chunk, ...rest);
    }) as typeof stream.write;

    const end = stream.end.bind(stream);
    stream.end = ((chunk?: unknown, ...rest: unknown[]) => {
      sent += byteLength(chunk);
      return (end as (...a: unknown[]) => ClientHttp2Stream)(chunk, ...rest);
    }) as typeof stream.end;

    stream.on("response", (headers: IncomingHttpStatusHeader) => {
      status = headers[":status"];
    });
    stream.on("error", (err: NodeJS.ErrnoException) => {
      failure = `${err.code ?? ""} ${err.message}`.trim();
    });

    // Reported from `close` rather than from `error` so that one line carries
    // everything: `rstCode` is only settled here, and it is the whole point —
    // a peer refusing an oversized turn shows up as 11 (ENHANCE_YOUR_CALM) and
    // nowhere else.
    stream.on("close", () => {
      if (stream.rstCode === NO_ERROR && failure === undefined) return;
      log(
        `[h2 ${tag}] ${describeRequest(headers)} failed: ` +
          `rstCode=${stream.rstCode} after ${Date.now() - startedAt}ms ` +
          `sent=${mib(sent)} response=${status ?? "none"}` +
          (failure ? ` :: ${failure}` : ""),
      );
    });

    return stream;
  }) as typeof session.request;
}

/**
 * Patch `http2.connect` so every session the SDK opens is traced.
 *
 * Node builds a module's ESM namespace once, snapshotting the CommonJS exports,
 * and `@connectrpc/connect-node` reaches http2 through `import * as http2`. So
 * the patch has to land on the CommonJS object *before* that snapshot is taken,
 * and this then forces the snapshot itself — otherwise whether the patch is
 * visible would depend on whether anything happened to import http2 first.
 *
 * Returns whether tracing is active.
 */
export async function installHttp2Diagnostics(
  log: DiagnosticLog = defaultLog,
): Promise<boolean> {
  const require = createRequire(import.meta.url);
  const http2 = require("node:http2") as typeof import("node:http2");
  const connect = http2.connect;
  let sessionSeq = 0;

  http2.connect = ((authority, options, listener) => {
    const session = connect(
      authority as Parameters<typeof connect>[0],
      options as Parameters<typeof connect>[1],
      listener as Parameters<typeof connect>[2],
    );
    attachSessionDiagnostics(session, `session#${++sessionSeq}`, log);
    return session;
  }) as typeof http2.connect;

  const namespace = await import("node:http2");
  if (namespace.connect !== http2.connect) {
    log(
      "[h2] http2 was imported before diagnostics were installed; " +
        "wire diagnostics are inactive and a failed turn will go unexplained.",
    );
    return false;
  }

  return true;
}
