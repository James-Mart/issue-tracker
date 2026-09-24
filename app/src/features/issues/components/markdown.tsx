import {
  Children,
  isValidElement,
  useMemo,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
  type ReactNode,
} from "react";
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import { READING_MEASURE_CLASS } from "@/components/page-shell";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils/cn";
import {
  attachmentDownloadName,
  attachmentLinkHref,
} from "../lib/attachments";
import { ISSUE_LINK_PREFIX, parseIssueLink } from "../lib/links";
import { remarkImageGallery } from "../lib/remark-image-gallery";
import { MermaidDiagram } from "@/features/agents/components/mermaid-diagram";
import { IssueLink } from "./issue-link";

function IssueAwareLink({
  href,
  children,
  node: _node,
  ...props
}: ComponentPropsWithoutRef<"a"> & { node?: unknown }) {
  const targetId = parseIssueLink(href);
  if (targetId !== null) {
    return (
      <IssueLink id={targetId} className={cn("issue-md-link", props.className)}>
        {children}
      </IssueLink>
    );
  }
  const downloadName = attachmentDownloadName(href);
  if (downloadName !== null) {
    return (
      <a href={href} download={downloadName} {...props}>
        {children}
      </a>
    );
  }
  return (
    <a href={href} target="_blank" rel="noreferrer" {...props}>
      {children}
    </a>
  );
}

function MarkdownCode({
  className,
  children,
  node: _node,
  ...props
}: ComponentPropsWithoutRef<"code"> & { node?: unknown }) {
  const languageClass =
    typeof className === "string" &&
    className.split(/\s+/).some((part) => part.startsWith("language-"));
  return (
    <code
      className={cn(!languageClass && "issue-md-inline-code", className)}
      {...props}
    >
      {children}
    </code>
  );
}

function nodeText(children: ReactNode): string {
  if (typeof children === "string" || typeof children === "number") {
    return String(children);
  }
  if (Array.isArray(children)) return children.map(nodeText).join("");
  if (isValidElement<{ children?: ReactNode }>(children)) {
    return nodeText(children.props.children);
  }
  return "";
}

function fenceOffsets(
  node: unknown,
): { start: number; end: number } | null {
  if (!node || typeof node !== "object" || !("position" in node)) return null;
  const position = (
    node as {
      position?: { start?: { offset?: unknown }; end?: { offset?: unknown } };
    }
  ).position;
  const start = position?.start?.offset;
  const end = position?.end?.offset;
  if (typeof start !== "number" || typeof end !== "number") return null;
  return { start, end };
}

/** True when this fence's closing delimiter is not in the source span. */
function mermaidFenceStillOpen(markdown: string, node: unknown): boolean {
  const offsets = fenceOffsets(node);
  if (!offsets) return false;
  const slice = markdown.slice(offsets.start, offsets.end);
  const firstBreak = slice.indexOf("\n");
  const opener = firstBreak === -1 ? slice : slice.slice(0, firstBreak);
  const marker = /^(?: {0,3})([`~]{3,})/.exec(opener)?.[1];
  if (!marker) return false;
  const lastBreak = slice.lastIndexOf("\n");
  const lastLine = lastBreak === -1 ? slice : slice.slice(lastBreak + 1);
  const tick = marker[0] === "`" ? "`" : "~";
  const closer = new RegExp(`^ {0,3}${tick}{${marker.length},}[ \\t]*$`);
  return !closer.test(lastLine);
}

/** Fence body for a `language-mermaid` block, including one remark left unclosed. */
function mermaidSourceFromPre(children: ReactNode): string | null {
  for (const node of Children.toArray(children)) {
    if (!isValidElement<{ className?: unknown; children?: ReactNode }>(node)) {
      continue;
    }
    const className = node.props.className;
    if (
      typeof className !== "string" ||
      !className.split(/\s+/).includes("language-mermaid")
    ) {
      continue;
    }
    return nodeText(node.props.children).replace(/\n$/, "");
  }
  return null;
}

function MarkdownPre({
  className,
  children,
  node,
  renderMermaid = false,
  mermaidStreaming = false,
  markdown = "",
  ...props
}: ComponentPropsWithoutRef<"pre"> & {
  node?: unknown;
  renderMermaid?: boolean;
  mermaidStreaming?: boolean;
  markdown?: string;
}) {
  if (renderMermaid) {
    const source = mermaidSourceFromPre(children);
    const holdOpen =
      mermaidStreaming &&
      source !== null &&
      mermaidFenceStillOpen(markdown, node);
    if (source !== null && !holdOpen) return <MermaidDiagram source={source} />;
  }
  return (
    <pre className={cn("issue-md-pre", className)} {...props}>
      {children}
    </pre>
  );
}

function MarkdownImage({
  src,
  alt,
  className,
  node: _node,
  ...props
}: ComponentPropsWithoutRef<"img"> & { node?: unknown }) {
  const [open, setOpen] = useState(false);
  if (!src) return null;

  const caption = alt?.trim() ?? "";
  const label = caption || "Image";

  return (
    <figure className="issue-md-figure">
      <button
        type="button"
        data-markdown-image
        className="issue-md-image-trigger"
        onClick={() => setOpen(true)}
        aria-label={`View larger: ${label}`}
      >
        <img
          src={src}
          alt={alt ?? ""}
          className={cn("issue-md-image", className)}
          {...props}
        />
      </button>
      {caption ? (
        <figcaption className="issue-md-image-caption">{caption}</figcaption>
      ) : null}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="w-auto max-w-[min(96vw,80rem)] p-3">
          <DialogTitle className="sr-only">{label}</DialogTitle>
          <img
            src={src}
            alt={alt ?? ""}
            className="max-h-[85vh] w-auto max-w-full rounded-md"
          />
        </DialogContent>
      </Dialog>
    </figure>
  );
}

function isFigureElement(child: ReactNode): boolean {
  return isValidElement(child) && child.type === "figure";
}

function MarkdownParagraph({
  children,
  node: _node,
  ...props
}: ComponentPropsWithoutRef<"p"> & { node?: unknown }) {
  const items = Children.toArray(children).filter((child) => {
    if (typeof child === "string") return child.trim().length > 0;
    return true;
  });
  if (items.length > 0 && items.every(isFigureElement)) {
    return <>{items}</>;
  }
  return <p {...props}>{children}</p>;
}

function markdownComponents(
  renderMermaid: boolean,
  mermaidStreamingRef: { current: boolean },
  markdownRef: { current: string },
) {
  return {
    a: IssueAwareLink,
    code: MarkdownCode,
    pre: (props: ComponentPropsWithoutRef<"pre"> & { node?: unknown }) => (
      <MarkdownPre
        {...props}
        renderMermaid={renderMermaid}
        mermaidStreaming={mermaidStreamingRef.current}
        markdown={markdownRef.current}
      />
    ),
    img: MarkdownImage,
    p: MarkdownParagraph,
  };
}

export function Markdown({
  children,
  issueId,
  renderMermaid = false,
  mermaidStreaming = false,
}: {
  children: string;
  /** When set, relative Markdown links resolve to this issue's attachments. */
  issueId?: string;
  /** Render `language-mermaid` fences as diagrams. Default leaves them as code. */
  renderMermaid?: boolean;
  /**
   * While streaming, an unclosed `language-mermaid` fence stays source.
   * Closed fences in the same message still render.
   */
  mermaidStreaming?: boolean;
}) {
  const markdownRef = useRef(children);
  const mermaidStreamingRef = useRef(mermaidStreaming);
  markdownRef.current = children;
  mermaidStreamingRef.current = mermaidStreaming;
  const urlTransform = useMemo(() => {
    return (url: string): string => {
      if (url.startsWith(ISSUE_LINK_PREFIX)) return url;
      if (issueId !== undefined) {
        const attachment = attachmentLinkHref(url, issueId);
        if (attachment !== null) return attachment;
      }
      return defaultUrlTransform(url);
    };
  }, [issueId]);
  const components = useMemo(
    () => markdownComponents(renderMermaid, mermaidStreamingRef, markdownRef),
    [renderMermaid],
  );

  return (
    <div className={cn("prose-issue min-w-0", READING_MEASURE_CLASS)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkImageGallery]}
        urlTransform={urlTransform}
        components={components}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
