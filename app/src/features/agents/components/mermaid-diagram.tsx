import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { Code, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";

type MermaidTheme = "dark" | "default";

function mermaidThemeFor(documentTheme: string | undefined): MermaidTheme {
  return documentTheme === "dark" ? "dark" : "default";
}

function readMermaidTheme(): MermaidTheme {
  if (typeof document === "undefined") return "default";
  return mermaidThemeFor(document.documentElement.dataset.theme);
}

function useDocumentMermaidTheme(): MermaidTheme {
  const [theme, setTheme] = useState(readMermaidTheme);
  useEffect(() => {
    const root = document.documentElement;
    const sync = () => setTheme(readMermaidTheme());
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(root, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    return () => observer.disconnect();
  }, []);
  return theme;
}

function parserErrorText(error: unknown): string {
  if (typeof error === "string" && error.trim()) return error.trim();
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  if (error && typeof error === "object") {
    const record = error as { message?: unknown; str?: unknown };
    if (typeof record.str === "string" && record.str.trim()) return record.str.trim();
    if (typeof record.message === "string" && record.message.trim()) {
      return record.message.trim();
    }
  }
  // A throw with no message still has to show a parser error, not a blank figure.
  return "Diagram failed to render";
}

async function renderMermaidDiagram(
  id: string,
  source: string,
  theme: MermaidTheme,
): Promise<string> {
  const { default: mermaid } = await import("mermaid");
  mermaid.initialize({
    securityLevel: "strict",
    startOnLoad: false,
    // Mermaid otherwise inserts its own error diagram. A thrown render
    // surfaces the parser message here instead.
    suppressErrorRendering: true,
    theme,
    fontFamily: '"IBM Plex Sans", ui-sans-serif, sans-serif',
    logLevel: "fatal",
  });
  const { svg } = await mermaid.render(id, source);
  return svg;
}

/** Scale to the message width and ignore clicks, including mermaid links. */
function fitDiagramHost(host: HTMLElement) {
  const svg = host.querySelector("svg");
  if (!svg) return;
  svg.removeAttribute("width");
  svg.removeAttribute("height");
  svg.style.display = "block";
  svg.style.width = "100%";
  svg.style.maxWidth = "100%";
  svg.style.height = "auto";
  svg.style.pointerEvents = "none";
  for (const link of svg.querySelectorAll("a")) {
    link.style.pointerEvents = "none";
    const href = link.getAttribute("href") ?? link.getAttribute("xlink:href");
    if (href && !href.startsWith("#")) {
      link.removeAttribute("href");
      link.removeAttribute("xlink:href");
    }
  }
}

function FenceBody({ source }: { source: string }) {
  return (
    <pre className="issue-md-pre" data-mermaid-source>
      <code>{source}</code>
    </pre>
  );
}

export function MermaidDiagram({ source }: { source: string }) {
  const theme = useDocumentMermaidTheme();
  const domId = useId().replace(/[^A-Za-z0-9]/g, "");
  const attempt = useRef(0);
  const hostRef = useRef<HTMLDivElement>(null);
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sourceOpen, setSourceOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const id = `mermaid-${domId}-${++attempt.current}`;
    void renderMermaidDiagram(id, source, theme).then(
      (next) => {
        if (cancelled) return;
        setError(null);
        setSvg(next);
      },
      (err: unknown) => {
        if (cancelled) return;
        setSvg(null);
        setError(parserErrorText(err));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [source, theme, domId]);

  useLayoutEffect(() => {
    if (!svg || !hostRef.current) return;
    fitDiagramHost(hostRef.current);
  }, [svg]);

  if (error) {
    return (
      <div className="mermaid-diagram-error my-3 min-w-0 max-w-full">
        <p
          role="alert"
          data-mermaid-error
          className="rounded-md border border-border bg-[hsl(var(--panel-2))] px-3 py-2 font-mono text-xs whitespace-pre-wrap text-foreground"
        >
          {error}
        </p>
        <FenceBody source={source} />
      </div>
    );
  }

  if (!svg) return null;

  return (
    <figure data-mermaid-diagram className="mermaid-diagram my-3 min-w-0 max-w-full">
      <div className="min-w-0 max-w-full rounded-md border border-border bg-card">
        <div className="flex justify-end px-1.5 pt-1.5">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 gap-1 px-2 font-mono text-[11px] text-muted-foreground [&_svg]:size-3"
            aria-expanded={sourceOpen}
            onClick={() => setSourceOpen((open) => !open)}
          >
            {sourceOpen ? <EyeOff /> : <Code />}
            {sourceOpen ? "Hide source" : "Show source"}
          </Button>
        </div>
        <div
          ref={hostRef}
          data-mermaid-host
          className="min-w-0 px-3 py-3"
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      </div>
      {sourceOpen ? <FenceBody source={source} /> : null}
    </figure>
  );
}
