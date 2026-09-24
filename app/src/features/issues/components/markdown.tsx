import {
  Children,
  isValidElement,
  useMemo,
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
  node: _node,
  renderMermaid = false,
  ...props
}: ComponentPropsWithoutRef<"pre"> & {
  node?: unknown;
  renderMermaid?: boolean;
}) {
  if (renderMermaid) {
    const source = mermaidSourceFromPre(children);
    if (source !== null) return <MermaidDiagram source={source} />;
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

function markdownComponents(renderMermaid: boolean) {
  return {
    a: IssueAwareLink,
    code: MarkdownCode,
    pre: (props: ComponentPropsWithoutRef<"pre"> & { node?: unknown }) => (
      <MarkdownPre {...props} renderMermaid={renderMermaid} />
    ),
    img: MarkdownImage,
    p: MarkdownParagraph,
  };
}

export function Markdown({
  children,
  issueId,
  renderMermaid = false,
}: {
  children: string;
  /** When set, relative Markdown links resolve to this issue's attachments. */
  issueId?: string;
  /** Render `language-mermaid` fences as diagrams. Default leaves them as code. */
  renderMermaid?: boolean;
}) {
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
    () => markdownComponents(renderMermaid),
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
