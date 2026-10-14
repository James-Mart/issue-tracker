import { useMemo, type ComponentProps, type KeyboardEvent } from "react";
import { parseDiffFromFile } from "@pierre/diffs";
import { FileDiff } from "@pierre/diffs/react";

/** Added lines read as editable text when the card offers an edit. */
const EDITABLE_ADDITION_CSS = `
[data-line-type="change-addition"] { cursor: text; }
`;

/** Both sides end in a newline, so a shared last line diffs as context rather than as a missing-newline change. */
function docContents(text: string): string {
  return text === "" || text.endsWith("\n") ? text : `${text}\n`;
}

/**
 * A proposal's before → after as a Pierre diff, rendered like the Diff tab.
 * Line numbers are left off: the excerpt does not carry the doc's real ones.
 */
export function StandardsProposalDiff({
  fileName,
  before,
  after,
  onEditAdded,
}: {
  fileName: string;
  before: string;
  after: string;
  /** Click on an added line opens the inline editor. */
  onEditAdded?: () => void;
}) {
  const fileDiff = useMemo(
    () =>
      parseDiffFromFile(
        { name: fileName, contents: docContents(before) },
        { name: fileName, contents: docContents(after) },
      ),
    [after, before, fileName],
  );
  const options = useMemo<ComponentProps<typeof FileDiff>["options"]>(
    () => ({
      disableFileHeader: true,
      disableLineNumbers: true,
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
    [onEditAdded],
  );
  return (
    <div
      className="min-w-0 overflow-hidden rounded-md border border-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      data-testid="standards-proposal-diff"
      {...(onEditAdded
        ? {
            role: "button",
            tabIndex: 0,
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
