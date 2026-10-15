import { useMemo, type ComponentProps, type KeyboardEvent } from "react";
import { parseDiffFromFile } from "@pierre/diffs";
import { FileDiff } from "@pierre/diffs/react";
import { resolveStandardsProposalDiff } from "@server/standards-proposal-anchor";
import { ShellInlineFault } from "@/app/shell-state";
import { ReviewPathScroll } from "./review-path-scroll";

/** Added lines read as editable text when the card offers an edit. */
const EDITABLE_ADDITION_CSS = `
[data-line-type="change-addition"] { cursor: text; }
`;

/** Both sides end in a newline, so a shared last line diffs as context rather than as a missing-newline change. */
function docContents(text: string): string {
  return text === "" || text.endsWith("\n") ? text : `${text}\n`;
}

function StandardsFileName({ fileName }: { fileName: string }) {
  return (
    <div
      className="flex min-w-0 items-center border-b border-border px-2 py-1.5"
      data-testid="standards-proposal-diff-file"
    >
      <ReviewPathScroll
        pathKey={fileName}
        title={fileName}
        className="font-mono text-[12px] text-foreground"
      >
        {fileName}
      </ReviewPathScroll>
    </div>
  );
}

/**
 * A proposal diff against the live standards file when the edit anchors
 * there: real line numbers, a little unchanged context, and the same
 * expand controls as the Diff tab. An edit that does not anchor is the
 * excerpt alone, with the file name and no line numbers.
 */
export function StandardsProposalDiff({
  fileName,
  section,
  before,
  after,
  fileText,
  fileLoading = false,
  fileError,
  onEditAdded,
}: {
  fileName: string;
  section: string;
  before: string;
  after: string;
  /** Live standards file, once loaded. */
  fileText?: string;
  fileLoading?: boolean;
  /** Set when the standards file could not be read. */
  fileError?: string;
  /** Click on an added line opens the inline editor. */
  onEditAdded?: () => void;
}) {
  const phase = fileLoading
    ? ({ kind: "loading" } as const)
    : fileError !== undefined
      ? ({ kind: "error", message: fileError } as const)
      : ({ kind: "ready" } as const);
  const anchored = useMemo(() => {
    if (phase.kind !== "ready" || fileText === undefined) return undefined;
    const resolution = resolveStandardsProposalDiff({ section, before, after, fileText });
    return resolution.kind === "anchored" ? resolution : undefined;
  }, [after, before, fileText, phase.kind, section]);
  const fileDiff = useMemo(() => {
    if (phase.kind !== "ready") return undefined;
    return parseDiffFromFile(
      {
        name: fileName,
        contents: docContents(anchored ? anchored.oldText : before),
      },
      {
        name: fileName,
        contents: docContents(anchored ? anchored.newText : after),
      },
    );
  }, [after, anchored, before, fileName, phase.kind]);
  const options = useMemo<ComponentProps<typeof FileDiff>["options"]>(
    () => ({
      disableFileHeader: true,
      disableLineNumbers: !anchored,
      diffStyle: "unified",
      overflow: "wrap",
      ...(onEditAdded
        ? {
            unsafeCSS: EDITABLE_ADDITION_CSS,
            onLineClick: ({ lineType }) => {
              if (lineType === "change-addition") onEditAdded();
            },
          }
        : {}),
    }),
    [anchored, onEditAdded],
  );
  const anchor =
    phase.kind === "loading"
      ? "loading"
      : phase.kind === "error"
        ? "error"
        : anchored
          ? "file"
          : "excerpt";
  let body;
  if (phase.kind === "loading") {
    body = (
      <p
        className="border-b border-border px-3 py-1.5 font-mono text-[11px] text-muted-foreground"
        role="status"
        data-testid="standards-proposal-diff-loading"
      >
        Loading standards file…
      </p>
    );
  } else if (phase.kind === "error") {
    body = (
      <ShellInlineFault className="m-2" message={phase.message} hint="Reload the review." />
    );
  } else if (!fileDiff) {
    throw new Error("Standards proposal diff resolved without a parsed file.");
  } else {
    body = (
      <div
        {...(onEditAdded
          ? {
              role: "button",
              tabIndex: 0,
              className:
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              "aria-label": "Edit proposed wording",
              onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => {
                if (event.key !== "Enter" && event.key !== " ") return;
                event.preventDefault();
                onEditAdded();
              },
            }
          : {})}
      >
        <FileDiff fileDiff={fileDiff} options={options} />
      </div>
    );
  }
  return (
    <div
      className="min-w-0 overflow-hidden rounded-md border border-border"
      data-testid="standards-proposal-diff"
      data-anchor={anchor}
    >
      <StandardsFileName fileName={fileName} />
      {body}
    </div>
  );
}
