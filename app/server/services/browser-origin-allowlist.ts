import { existsSync, readFileSync } from "node:fs";
import type { Page } from "@playwright/test";
import {
  agentStackStatePath,
  agentStackStateSchema,
  isStackLive,
} from "./agent-stack.js";

/**
 * Env var on the Playwright MCP process. Its value is the absolute path of
 * this conversation's agent-stack `state.json`. The browser reads that file
 * on every navigation, so a stack that starts or stops mid-session changes
 * what the already-running browser may open.
 */
export const BROWSER_ORIGIN_STATE_ENV = "ISSUE_TRACKER_AGENT_STACK_STATE";

export const NO_LIVE_STACK_NAVIGATION_ERROR =
  "No live verification stack. Call agent_stack_start first.";

export type BrowserNavigationDecision =
  | { allowed: true }
  | { allowed: false; message: string };

export function browserOriginMcpEnv(
  conversationId: string,
): Record<string, string> {
  return {
    [BROWSER_ORIGIN_STATE_ENV]: agentStackStatePath(conversationId),
  };
}

/**
 * `AGENT_STACK_BASE_URL` of the conversation's live stack, or null when that
 * stack is absent or its processes are gone. Browser navigations call this
 * on each attempt; start writes the state file and stop removes it.
 */
export function liveBrowserOriginBaseUrl(
  statePath: string | undefined,
): string | null {
  if (statePath === undefined || statePath.length === 0) return null;
  if (!existsSync(statePath)) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(statePath, "utf8"));
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(
      `invalid agent-stack state at ${statePath}: ${detail}`,
    );
  }
  const parsed = agentStackStateSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(
      `invalid agent-stack state at ${statePath}: ${parsed.error.message}`,
    );
  }
  if (!isStackLive(parsed.data)) return null;
  return parsed.data.baseUrl;
}

function stackOrigin(baseUrl: string): URL {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch (err) {
    throw new Error(`live stack base URL is not a valid URL: ${baseUrl}`, {
      cause: err,
    });
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(
      `live stack base URL must be http or https, got ${baseUrl}`,
    );
  }
  return url;
}

function portOf(url: URL): string {
  if (url.port) return url.port;
  if (url.protocol === "http:") return "80";
  if (url.protocol === "https:") return "443";
  return "";
}

/** Root host, or a subdomain of it (`tokens.psibase.localhost` under `psibase.localhost`). */
function hostAllowed(hostname: string, baseHost: string): boolean {
  const host = hostname.toLowerCase();
  const base = baseHost.toLowerCase();
  if (host === base) return true;
  const suffix = `.${base}`;
  return host.endsWith(suffix) && host.length > suffix.length;
}

/**
 * Allow the live stack's origin and every subdomain of its host on the same
 * port. `baseUrl` null is the no-stack refusal.
 */
export function decideBrowserNavigation(
  target: string,
  baseUrl: string | null,
): BrowserNavigationDecision {
  if (baseUrl === null) {
    return { allowed: false, message: NO_LIVE_STACK_NAVIGATION_ERROR };
  }
  const allow = stackOrigin(baseUrl);
  let targetUrl: URL;
  try {
    targetUrl = new URL(target);
  } catch {
    return {
      allowed: false,
      message: `Navigation to ${target} is outside the live stack's origins (${allow.origin}).`,
    };
  }
  const sameOriginFamily =
    targetUrl.protocol === allow.protocol &&
    portOf(targetUrl) === portOf(allow) &&
    hostAllowed(targetUrl.hostname, allow.hostname);
  if (sameOriginFamily) return { allowed: true };
  return {
    allowed: false,
    message: `Navigation to ${targetUrl.href} is outside the live stack's origins (${allow.origin}).`,
  };
}

function assertBrowserNavigation(target: string, baseUrl: string | null): void {
  const decision = decideBrowserNavigation(target, baseUrl);
  if (!decision.allowed) throw new Error(decision.message);
}

function readBaseUrlFromEnv(): string | null {
  return liveBrowserOriginBaseUrl(process.env[BROWSER_ORIGIN_STATE_ENV]);
}

const guardedContexts = new WeakSet<object>();

/**
 * Refuse navigations that are not on the live stack. Re-reads the stack on
 * every call so start and stop apply without restarting the browser.
 */
export async function installBrowserOriginGuard(
  page: Page,
  readBaseUrl: () => string | null = readBaseUrlFromEnv,
): Promise<void> {
  const originalGoto = page.goto.bind(page);
  page.goto = (async (url, options) => {
    assertBrowserNavigation(url, readBaseUrl());
    return originalGoto(url, options);
  }) as Page["goto"];

  for (const method of ["goBack", "goForward", "reload"] as const) {
    const original = page[method].bind(page);
    page[method] = (async (options) => {
      if (readBaseUrl() === null) {
        throw new Error(NO_LIVE_STACK_NAVIGATION_ERROR);
      }
      return original(options);
    }) as Page[typeof method];
  }

  const context = page.context();
  if (guardedContexts.has(context)) return;
  guardedContexts.add(context);
  await context.route("**/*", async (route) => {
    assertBrowserNavigation(route.request().url(), readBaseUrl());
    await route.continue();
  });
}
