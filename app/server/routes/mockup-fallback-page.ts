import { chatConversationPath } from "@/features/agents/lib/links";

/**
 * Bare centered fallback for a conversation whose Storybook is not live.
 * Markup follows ShellState: eyebrow, title, detail, one quiet link.
 */

export type MockupFallbackKind = "session-ended" | "stack-down";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function pageCopy(kind: MockupFallbackKind): {
  eyebrow: string;
  title: string;
  detail: string;
  tone: "current" | "blocked";
  role: "status" | "alert";
} {
  if (kind === "session-ended") {
    return {
      eyebrow: "Mockup session",
      title: "This mockup session has ended.",
      detail:
        "Live Storybook is no longer served at this link. Review the captures already posted in the conversation.",
      tone: "current",
      role: "status",
    };
  }
  return {
    eyebrow: "Fault",
    title: "Mockup preview is unavailable.",
    detail:
      "Storybook stack is not running. Return to the conversation and review the captures already posted there.",
    tone: "blocked",
    role: "alert",
  };
}

export function mockupFallbackHtml(
  kind: MockupFallbackKind,
  conversationId: string,
): string {
  const copy = pageCopy(kind);
  const href = chatConversationPath(conversationId);
  const eyebrowClass = copy.tone === "blocked" ? "eyebrow eyebrow-blocked" : "eyebrow";
  return `<!doctype html>
<html lang="en" data-theme="dark">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(copy.title)}</title>
<style>
@font-face {
  font-family: "Martian Mono";
  font-style: normal;
  font-weight: 600;
  font-display: swap;
  src: url("/src/styles/fonts/martian-mono/martian-mono-600.woff2") format("woff2");
}
@font-face {
  font-family: "IBM Plex Sans";
  font-style: normal;
  font-weight: 400;
  font-display: swap;
  src: url("/src/styles/fonts/ibm-plex-sans/ibm-plex-sans-400.woff2") format("woff2");
}
@font-face {
  font-family: "IBM Plex Sans";
  font-style: normal;
  font-weight: 600;
  font-display: swap;
  src: url("/src/styles/fonts/ibm-plex-sans/ibm-plex-sans-600.woff2") format("woff2");
}
:root {
  --void: 217.5 25% 6.3%;
  --panel: 218.6 25.9% 10.6%;
  --rail: 216 19.6% 20%;
  --rail-lit: 216 20.5% 28.6%;
  --mut: 216 13.2% 55.3%;
  --ink: 220 23.1% 92.4%;
  --current: 180 65% 54.1%;
  --blocked: 352 68.5% 61.4%;
}
* { box-sizing: border-box; }
html, body { margin: 0; min-height: 100%; }
body {
  min-height: 100svh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 32px 16px;
  background: hsl(var(--void));
  color: hsl(var(--ink));
  font-family: "IBM Plex Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  font-size: 15px;
  line-height: 1.55;
}
.card {
  width: min(100%, 32rem);
  border: 1px solid hsl(var(--rail));
  border-radius: 0.5rem;
  background: hsl(var(--panel));
  padding: 40px 24px;
  text-align: center;
}
.eyebrow {
  margin: 0;
  font-family: "Martian Mono", ui-monospace, monospace;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: hsl(var(--current));
}
.eyebrow-blocked { color: hsl(var(--blocked)); }
h1 {
  margin: 12px 0 0;
  font-size: 16px;
  font-weight: 600;
  letter-spacing: -0.01em;
}
.detail {
  margin: 8px auto 0;
  max-width: 28rem;
  font-size: 14px;
  color: hsl(var(--mut));
}
.back {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  margin-top: 20px;
  height: 36px;
  padding: 0 16px;
  border: 1px solid hsl(var(--rail));
  border-radius: 0.375rem;
  background: hsl(var(--panel));
  color: hsl(var(--ink));
  font: inherit;
  font-size: 14px;
  font-weight: 500;
  text-decoration: none;
}
.back:hover { border-color: hsl(var(--rail-lit)); }
.back:focus-visible {
  outline: 2px solid hsl(var(--current));
  outline-offset: 2px;
}
</style>
</head>
<body>
  <div class="card" role="${copy.role}">
    <p class="${eyebrowClass}">${escapeHtml(copy.eyebrow)}</p>
    <h1>${escapeHtml(copy.title)}</h1>
    <p class="detail">${escapeHtml(copy.detail)}</p>
    <a class="back" href="${escapeHtml(href)}">Back to conversation</a>
  </div>
</body>
</html>
`;
}
