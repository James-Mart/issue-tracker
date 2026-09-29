import { ChevronDown, ChevronUp, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formControlSurface } from "@/components/ui/form-surfaces";
import { cn } from "@/lib/utils/cn";

export function ReviewDiffSearch({
  query,
  matchIndex,
  matchCount,
  onQueryChange,
  onPrevious,
  onNext,
}: {
  query: string;
  matchIndex: number;
  matchCount: number;
  onQueryChange: (value: string) => void;
  onPrevious: () => void;
  onNext: () => void;
}) {
  const searching = query.trim() !== "";
  const label = matchCount === 0 ? "0 of 0" : `${matchIndex + 1} of ${matchCount}`;
  return (
    <div
      className={cn(
        "flex min-w-0 shrink-0 items-center gap-1 rounded-md px-2",
        formControlSurface,
        "focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2",
      )}
      data-testid="review-diff-search-bar"
    >
      <Search className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
      <input
        value={query}
        onChange={(event) => onQueryChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== "Enter") return;
          event.preventDefault();
          if (event.shiftKey) onPrevious();
          else onNext();
        }}
        placeholder="Search diff"
        aria-label="Search diff"
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        data-testid="review-diff-search"
        className="h-8 min-w-0 flex-1 bg-transparent font-mono text-[12px] text-foreground outline-none placeholder:text-muted-foreground"
      />
      {searching ? (
        <span
          className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground"
          data-testid="review-diff-search-count"
          aria-live="polite"
        >
          {label}
        </span>
      ) : null}
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className="shrink-0 text-muted-foreground"
        aria-label="Previous match"
        data-testid="review-diff-search-previous"
        disabled={matchCount === 0}
        onClick={onPrevious}
      >
        <ChevronUp />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className="shrink-0 text-muted-foreground"
        aria-label="Next match"
        data-testid="review-diff-search-next"
        disabled={matchCount === 0}
        onClick={onNext}
      >
        <ChevronDown />
      </Button>
    </div>
  );
}
