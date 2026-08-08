import { useMemo, useState, type ComponentPropsWithoutRef } from "react";
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

function MarkdownPre({
  className,
  children,
  node: _node,
  ...props
}: ComponentPropsWithoutRef<"pre"> & { node?: unknown }) {
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

  const label = alt?.trim() ? alt : "Image";

  return (
    <>
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
    </>
  );
}

const markdownComponents = {
  a: IssueAwareLink,
  code: MarkdownCode,
  pre: MarkdownPre,
  img: MarkdownImage,
};

export function Markdown({
  children,
  issueId,
}: {
  children: string;
  /** When set, relative Markdown links resolve to this issue's attachments. */
  issueId?: string;
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

  return (
    <div className={cn("prose-issue min-w-0", READING_MEASURE_CLASS)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        urlTransform={urlTransform}
        components={markdownComponents}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
