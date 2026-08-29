import type { FileDiffMetadata } from "@pierre/diffs/react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils/cn";
import { fileLineCounts } from "../lib/issue-change-file-diffs";

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
                  "flex max-w-[14rem] items-baseline gap-2 rounded-md border px-2 py-1.5 text-left font-mono text-[12px] leading-snug shell:w-full shell:max-w-none",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                  selected
                    ? "border-primary bg-[color-mix(in_srgb,hsl(var(--current))_12%,hsl(var(--panel)))]"
                    : "border-border bg-card hover:border-[hsl(var(--rail-lit))]",
                )}
              >
                <span className="min-w-0 truncate">{file.name}</span>
                <span className="ml-auto shrink-0 tabular-nums">
                  <span className="text-success">+{additions}</span>{" "}
                  <span className="text-destructive">-{deletions}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
