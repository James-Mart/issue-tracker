import { useMemo, type ComponentPropsWithoutRef } from "react";
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
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

const markdownComponents = { a: IssueAwareLink };

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
    <div className="prose-issue">
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
