/**
 * Fault surface for client bootstrap / mount failures that never reach the
 * React ErrorBoundary in Providers — the path that otherwise leaves #root
 * blank. Vanilla DOM so it can paint even when React never mounts.
 *
 * Class names match PageShell / ShellState / primary Button so the look
 * stays on the existing Fault surface. CSS is imported here so a failed
 * `main.tsx` load still has the Fault styles.
 */

import "@/styles/globals.css";

const PAGE_SHELL_CLASS =
  "flex min-h-svh w-full min-w-0 flex-col gap-4 px-4 py-8 shell:px-6 items-start py-16";

const CARD_CLASS =
  "rounded-lg border border-border bg-card text-card-foreground shadow-none px-6 py-10 text-center w-full";

const EYEBROW_CLASS =
  "font-display text-[11px] font-semibold uppercase tracking-[0.22em] text-[hsl(var(--blocked))]";

const TITLE_CLASS =
  "text-base font-semibold tracking-tight text-foreground mt-3";

const DETAIL_CLASS = "mx-auto mt-2 max-w-md text-sm text-muted-foreground";

const ACTION_ROW_CLASS = "mt-5 flex justify-center gap-2";

const PRIMARY_BUTTON_CLASS =
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 border border-transparent bg-primary text-primary-foreground hover:bg-primary/90 h-9 px-4 py-2 touch:h-11";

const COPY_LABEL = "Copy details";
const COPIED_LABEL = "Copied";
const COPY_FAILED_LABEL = "Copy failed";

let installed = false;
let scheduled: ReturnType<typeof setTimeout> | undefined;

export function describeUnknownError(error: unknown): {
  message: string;
  stack?: string;
} {
  if (error instanceof Error) {
    return {
      message: error.message || error.name,
      stack: error.stack,
    };
  }
  if (typeof error === "string" && error.length > 0) {
    return { message: error };
  }
  return { message: String(error) };
}

export function formatBootstrapFaultDetails(error: unknown): string {
  const { message, stack } = describeUnknownError(error);
  const lines = [
    "Issue Tracker bootstrap fault",
    `URL: ${typeof location === "undefined" ? "" : location.href}`,
    `Time: ${new Date().toISOString()}`,
    `User-Agent: ${typeof navigator === "undefined" ? "" : navigator.userAgent}`,
    `Error: ${message}`,
  ];
  if (stack) lines.push(`Stack: ${stack}`);
  return lines.join("\n");
}

function faultHost(): HTMLElement {
  return document.getElementById("root") ?? document.body;
}

function shellIsUsable(host: HTMLElement): boolean {
  if (host.querySelector("[data-bootstrap-fault]")) return false;
  const root = document.getElementById("root");
  if (root && host === root) return root.childElementCount > 0;
  return false;
}

function isBootstrapRelevantError(event: Event): boolean {
  if (event.type === "unhandledrejection") return true;
  if (event.target instanceof HTMLScriptElement) return true;
  if (!(event instanceof ErrorEvent)) return false;
  return Boolean(event.error || event.message);
}

function errorFromEvent(event: Event): unknown {
  if (event.type === "unhandledrejection") {
    return (event as PromiseRejectionEvent).reason;
  }
  if (event instanceof ErrorEvent) {
    if (event.error) return event.error;
    if (event.message) return event.message;
  }
  if (event.target instanceof HTMLScriptElement) {
    const src = event.target.src || "inline";
    return new Error(`Script failed to load: ${src}`);
  }
  return new Error("Uncaught error");
}

async function copyDetails(
  details: string,
  button: HTMLButtonElement,
): Promise<void> {
  try {
    const write = navigator.clipboard?.writeText;
    if (!write) throw new Error("clipboard unavailable");
    await write.call(navigator.clipboard, details);
    button.textContent = COPIED_LABEL;
  } catch {
    button.textContent = COPY_FAILED_LABEL;
  }
  window.setTimeout(() => {
    button.textContent = COPY_LABEL;
  }, 1500);
}

function renderFaultSurface(error: unknown): HTMLElement {
  const { message } = describeUnknownError(error);
  const details = formatBootstrapFaultDetails(error);

  const shell = document.createElement("div");
  shell.className = PAGE_SHELL_CLASS;
  shell.setAttribute("data-bootstrap-fault", "");

  const card = document.createElement("div");
  card.className = CARD_CLASS;
  card.setAttribute("role", "alert");
  card.setAttribute("aria-live", "assertive");

  const eyebrow = document.createElement("p");
  eyebrow.className = EYEBROW_CLASS;
  eyebrow.textContent = "Fault";

  const title = document.createElement("h2");
  title.className = TITLE_CLASS;
  title.textContent = "The app failed to start.";

  const detail = document.createElement("div");
  detail.className = DETAIL_CLASS;
  const messageEl = document.createElement("span");
  messageEl.className = "font-mono text-xs";
  messageEl.textContent = message;
  const hint = document.createElement("span");
  hint.className = "mt-2 block";
  hint.textContent =
    "Copy the details and paste them back so this can be diagnosed.";
  detail.append(messageEl, hint);

  const actions = document.createElement("div");
  actions.className = ACTION_ROW_CLASS;
  const button = document.createElement("button");
  button.type = "button";
  button.className = PRIMARY_BUTTON_CLASS;
  button.textContent = COPY_LABEL;
  button.addEventListener("click", () => {
    void copyDetails(details, button);
  });
  actions.append(button);

  card.append(eyebrow, title, detail, actions);
  shell.append(card);
  return shell;
}

/** Paint the Fault surface into #root when the shell is not already usable. */
export function showBootstrapFault(error: unknown): void {
  const host = faultHost();
  if (shellIsUsable(host)) return;
  if (host.querySelector("[data-bootstrap-fault]")) return;

  const surface = renderFaultSurface(error);
  const root = document.getElementById("root");
  if (root && host === root) {
    root.replaceChildren(surface);
    return;
  }
  host.append(surface);
}

function scheduleBootstrapFault(error: unknown): void {
  if (scheduled !== undefined) return;
  scheduled = setTimeout(() => {
    scheduled = undefined;
    showBootstrapFault(error);
  }, 0);
}

function onWindowError(event: Event): void {
  if (!isBootstrapRelevantError(event)) return;
  scheduleBootstrapFault(errorFromEvent(event));
}

function onUnhandledRejection(event: Event): void {
  scheduleBootstrapFault(errorFromEvent(event));
}

export function installBootstrapFaultHandling(): void {
  if (installed) return;
  installed = true;
  window.__showBootstrapFault = showBootstrapFault;
  window.addEventListener("error", onWindowError, true);
  window.addEventListener("unhandledrejection", onUnhandledRejection);
  const queued = window.__bootstrapFaultQueue;
  if (queued && queued.length > 0) {
    showBootstrapFault(queued[0]);
  }
}

export function resetBootstrapFaultHandlingForTests(): void {
  window.removeEventListener("error", onWindowError, true);
  window.removeEventListener("unhandledrejection", onUnhandledRejection);
  delete window.__showBootstrapFault;
  installed = false;
  if (scheduled !== undefined) {
    clearTimeout(scheduled);
    scheduled = undefined;
  }
}

/** Run a mount function; synchronous throws become the Fault surface. */
export function mountClient(mount: () => void): void {
  try {
    mount();
  } catch (error) {
    showBootstrapFault(error);
  }
}

if (!import.meta.env.VITEST) {
  installBootstrapFaultHandling();
}
