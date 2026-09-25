import {
  request as httpRequest,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { connect, type Socket } from "node:net";
import type { NextFunction, Request, Response } from "express";
import { isMockupStackLive } from "../services/mockup-stack.js";
import { readMockupStackState, readSessionOutcome } from "../services/mockup-scratch.js";
import { mockupFallbackHtml } from "./mockup-fallback-page.js";

const PREFIX = "/mockups/";

function requestUrl(req: IncomingMessage): string {
  const withOriginal = req as IncomingMessage & { originalUrl?: string };
  return withOriginal.originalUrl ?? req.url ?? "/";
}

function conversationIdFromPath(pathname: string): string | null {
  if (!pathname.startsWith(PREFIX)) return null;
  const id = pathname.slice(PREFIX.length).split("/")[0];
  return id ? id : null;
}

/**
 * HTTP is stripped onto Storybook's loopback root. The HMR upgrade stays on
 * the public prefix, which is the path Storybook's client is started with.
 */
export function forwardedMockupPath(
  pathname: string,
  search: string,
  conversationId: string,
  upgrade: boolean,
): string {
  const base = `/mockups/${conversationId}`;
  const exact = pathname === base || pathname === `${base}/`;
  if (upgrade && exact) return `${pathname}${search}`;
  let rest = pathname.startsWith(base) ? pathname.slice(base.length) : pathname;
  if (rest === "" || !rest.startsWith("/")) rest = `/${rest}`;
  return `${rest}${search}`;
}

function liveBaseUrl(conversationId: string): string | null {
  let state;
  try {
    state = readMockupStackState(conversationId);
  } catch {
    return null;
  }
  if (!state || !isMockupStackLive(state)) return null;
  return state.baseUrl;
}

function isServerResponse(
  value: ServerResponse | Socket,
): value is ServerResponse {
  return typeof (value as ServerResponse).writeHead === "function";
}

function emptyStatus(res: ServerResponse, status: number): void {
  res.statusCode = status;
  res.setHeader("Content-Length", "0");
  res.end();
}

function sendFallback(res: ServerResponse, conversationId: string): void {
  const outcome = readSessionOutcome(conversationId);
  const kind = outcome === "ended" ? "session-ended" : "stack-down";
  const html = mockupFallbackHtml(kind, conversationId);
  res.statusCode = 200;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.end(html);
}

function rejectUpgrade(socket: Socket): void {
  socket.end(
    "HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
  );
}

function publicLocation(
  location: string,
  baseUrl: string,
  conversationId: string,
): string {
  const prefix = `/mockups/${conversationId}`;
  if (location.startsWith(baseUrl)) {
    const rest = location.slice(baseUrl.length);
    const path = rest.startsWith("/") ? rest : `/${rest}`;
    return `${prefix}${path === "/" ? "/" : path}`;
  }
  if (location.startsWith("/") && !location.startsWith(`${prefix}/`) && location !== prefix) {
    return `${prefix}${location}`;
  }
  return location;
}

function proxyHttp(
  req: IncomingMessage,
  res: ServerResponse,
  target: URL,
  path: string,
  conversationId: string,
): void {
  const headers = { ...req.headers, host: target.host };
  delete headers.connection;
  const upstream = httpRequest(
    {
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port,
      method: req.method,
      path,
      headers,
    },
    (upstreamRes) => {
      const location = upstreamRes.headers.location;
      if (typeof location === "string") {
        upstreamRes.headers.location = publicLocation(
          location,
          target.origin,
          conversationId,
        );
      }
      res.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.headers);
      upstreamRes.pipe(res);
    },
  );
  upstream.on("error", () => {
    if (!res.headersSent) emptyStatus(res, 502);
    else res.end();
  });
  req.pipe(upstream);
}

function proxyUpgrade(
  req: IncomingMessage,
  socket: Socket,
  head: Buffer,
  target: URL,
  path: string,
): void {
  const upstream = connect(Number(target.port), target.hostname);
  const fail = () => {
    socket.destroy();
    upstream.destroy();
  };
  upstream.on("error", fail);
  socket.on("error", fail);
  upstream.on("connect", () => {
    const headers = { ...req.headers, host: target.host };
    const lines = [`${req.method ?? "GET"} ${path} HTTP/1.1`];
    for (const [key, value] of Object.entries(headers)) {
      if (value === undefined) continue;
      const list = Array.isArray(value) ? value : [value];
      for (const item of list) lines.push(`${key}: ${item}`);
    }
    upstream.write(`${lines.join("\r\n")}\r\n\r\n`);
    if (head.length > 0) upstream.write(head);
    socket.pipe(upstream);
    upstream.pipe(socket);
  });
}

/**
 * Reverse-proxy one conversation's loopback Storybook. HTTP and the websocket
 * upgrade on `/mockups/:conversationId/` share this handler. A conversation
 * with no live stack is never sent to another port: HTTP gets the session-ended
 * page when the outcome is ended, and the loud-failure page otherwise.
 */
export function mockupStackProxy(
  req: IncomingMessage,
  resOrSocket: ServerResponse | Socket,
  nextOrHead: NextFunction | Buffer,
): void {
  const url = new URL(requestUrl(req), "http://127.0.0.1");
  const upgrade = !isServerResponse(resOrSocket);
  const conversationId = conversationIdFromPath(url.pathname);
  if (!conversationId) {
    if (upgrade) rejectUpgrade(resOrSocket);
    else if (typeof nextOrHead === "function") nextOrHead();
    else emptyStatus(resOrSocket, 404);
    return;
  }

  const baseUrl = liveBaseUrl(conversationId);
  if (!baseUrl) {
    if (upgrade) rejectUpgrade(resOrSocket);
    else sendFallback(resOrSocket, conversationId);
    return;
  }

  const target = new URL(baseUrl);
  const path = forwardedMockupPath(
    url.pathname,
    url.search,
    conversationId,
    upgrade,
  );
  if (upgrade) {
    proxyUpgrade(req, resOrSocket, Buffer.isBuffer(nextOrHead) ? nextOrHead : Buffer.alloc(0), target, path);
    return;
  }
  proxyHttp(req, resOrSocket, target, path, conversationId);
}

export function mockupStackMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  mockupStackProxy(req, res, next);
}

export function attachMockupStackProxy(server: Server): void {
  server.on("upgrade", (req, socket, head) => {
    if (!(req.url ?? "").startsWith(PREFIX)) return;
    mockupStackProxy(req, socket, head);
  });
}
