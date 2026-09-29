import type { FileDiffMetadata } from "@pierre/diffs/react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils/cn";
import { fileLineCounts } from "../lib/issue-change-file-diffs";
import { changedFileRowClass, DiffLineCounts } from "./changed-file-row";

export function IssueChangeFileNavigator({
  files,
  matched,
  filter,
  onFilterChange,
  selectedName,
  onSelect,
}: {
  files: FileDiffMetadata[];
  matched: FileDiffMetadata[];
  filter: string;
  onFilterChange: (value: string) => void;
  selectedName: string;
  onSelect: (name: string) => void;
}) {
  return (
    <nav
      className="flex min-w-0 flex-col gap-2 shell:w-64 shell:shrink-0"
      data-testid="issue-change-file-navigator"
      aria-label="Changed files"
    >
      <div className="flex items-center gap-2">
        <Input
          value={filter}
          onChange={(event) => onFilterChange(event.target.value)}
          placeholder="Filter files..."
          aria-label="Filter files"
          data-testid="issue-change-file-filter"
          className="h-8 font-mono text-[12px]"
        />
        <span
          className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground"
          data-testid="issue-change-file-match-count"
        >
          {matched.length} of {files.length}
        </span>
      </div>
      <ul
        className="flex gap-2 overflow-x-auto pb-0.5 shell:max-h-[min(32rem,70vh)] shell:flex-col shell:overflow-y-auto"
        role="listbox"
        aria-label="Changed files"
      >
        {matched.map((file) => {
          const { additions, deletions } = fileLineCounts(file);
          const selected = file.name === selectedName;
          return (
            <li key={file.name} className="shrink-0 shell:min-w-0 shell:w-full">
              <button
                type="button"
                role="option"
                aria-selected={selected}
                title={file.name}
                data-testid="issue-change-file"
                data-file-name={file.name}
                onClick={() => onSelect(file.name)}
                className={cn(
                  "flex max-w-[14rem] items-baseline gap-2 shell:w-full shell:max-w-none",
                  changedFileRowClass(selected),
                )}
              >
                <span className="min-w-0 truncate">{file.name}</span>
                <DiffLineCounts
                  additions={additions}
                  deletions={deletions}
                  className="ml-auto shrink-0"
                />
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
