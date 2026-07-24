import {
  Archive,
  GitBranch,
  Layers,
  Lightbulb,
  Search,
  Tags,
} from "lucide-react";
import type { ProjectLabel } from "@server/schemas";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import type { BoardKindFilter } from "../lib/board-kind-filter";
import { toggleAssignmentId } from "../lib/project-labels";
import { useIssueUiStore } from "../store/use-issue-ui-store";
import { ProjectLabelChip } from "./project-label-chip";

const BOARD_FILTER_OPTIONS: {
  value: BoardKindFilter;
  label: string;
  icon: typeof Layers;
}[] = [
  { value: "both", label: "All", icon: Layers },
  { value: "epic", label: "Epics", icon: Layers },
  { value: "idea", label: "Ideas", icon: Lightbulb },
  { value: "story", label: "Stories", icon: GitBranch },
];

function LabelFilterControl({
  catalog,
  selected,
  onChange,
}: {
  catalog: ProjectLabel[];
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  const selectedInCatalog = selected.filter((id) =>
    catalog.some((label) => label.id === id),
  );
  const active = selectedInCatalog.length > 0;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant={active ? "secondary" : "outline"}
          size="sm"
          className="shrink-0"
          disabled={catalog.length === 0}
          aria-label="Filter by label"
          title={
            catalog.length === 0
              ? "No labels in project catalog"
              : "Filter by label"
          }
        >
          <Tags className="h-4 w-4" />
          Labels
          {active ? (
            <span className="ml-1 tabular-nums text-muted-foreground">
              ({selectedInCatalog.length})
            </span>
          ) : null}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>Filter by label (OR)</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {catalog.map((label) => (
          <DropdownMenuCheckboxItem
            key={label.id}
            checked={selected.includes(label.id)}
            onCheckedChange={() =>
              onChange(toggleAssignmentId(selected, label.id))
            }
            onSelect={(event) => event.preventDefault()}
          >
            <ProjectLabelChip label={label} />
          </DropdownMenuCheckboxItem>
        ))}
        {active ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => onChange([])}>
              Clear labels
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Search / label / kind / show-archived controls for the project Flow lens. */
export function OverviewFlowFilters({
  catalog,
}: {
  catalog: ProjectLabel[];
}) {
  const search = useIssueUiStore((s) => s.search);
  const setSearch = useIssueUiStore((s) => s.setSearch);
  const labelFilter = useIssueUiStore((s) => s.labelFilter);
  const setLabelFilter = useIssueUiStore((s) => s.setLabelFilter);
  const boardKindFilter = useIssueUiStore((s) => s.boardKindFilter);
  const setBoardKindFilter = useIssueUiStore((s) => s.setBoardKindFilter);
  const showArchived = useIssueUiStore((s) => s.showArchived);
  const setShowArchived = useIssueUiStore((s) => s.setShowArchived);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative min-w-[12rem] flex-1">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by title or id"
          className="pl-9"
          aria-label="Search flow"
        />
      </div>
      <LabelFilterControl
        catalog={catalog}
        selected={labelFilter}
        onChange={setLabelFilter}
      />
      <div
        className="flex shrink-0 items-center rounded-md border p-0.5"
        role="group"
        aria-label="Filter by kind"
      >
        {BOARD_FILTER_OPTIONS.map(({ value, label, icon: Icon }) => (
          <Button
            key={value}
            type="button"
            variant={boardKindFilter === value ? "secondary" : "ghost"}
            size="sm"
            className="h-7 px-2"
            aria-pressed={boardKindFilter === value}
            onClick={() => setBoardKindFilter(value)}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </Button>
        ))}
      </div>
      <Button
        type="button"
        variant={showArchived ? "secondary" : "outline"}
        size="sm"
        className="shrink-0"
        aria-pressed={showArchived}
        title={
          showArchived ? "Hide archived issues" : "Show archived issues"
        }
        onClick={() => setShowArchived(!showArchived)}
      >
        <Archive className="h-4 w-4" />
        Show archived
      </Button>
    </div>
  );
}
