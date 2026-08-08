import { Filter, GitBranch, Layers, Lightbulb, Search } from "lucide-react";
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
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  BOARD_KIND_OPTIONS,
  toggleBoardKind,
  type BoardKindOption,
} from "../lib/board-kind-filter";
import { toggleAssignmentId } from "../lib/project-labels";
import { useIssueUiStore } from "../store/use-issue-ui-store";
import { ProjectLabelChip } from "./project-label-chip";

const KIND_OPTION_META: Record<
  BoardKindOption,
  { label: string; icon: typeof Layers }
> = {
  epic: { label: "Epics", icon: Layers },
  idea: { label: "Ideas", icon: Lightbulb },
  story: { label: "Stories", icon: GitBranch },
};

/** Shared search + filter popover (Type / Labels / Show archived) for overview lenses. */
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

  const selectedLabels = labelFilter.filter((id) =>
    catalog.some((label) => label.id === id),
  );
  const kindActive = boardKindFilter.length > 0;
  const labelsActive = selectedLabels.length > 0;
  const filterActive = kindActive || labelsActive || showArchived;
  const activeCount =
    boardKindFilter.length + selectedLabels.length + (showArchived ? 1 : 0);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative min-w-[12rem] flex-1">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by title or id"
          className="pl-9"
          aria-label="Search overview"
        />
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant={filterActive ? "secondary" : "outline"}
            size="sm"
            className="shrink-0"
            aria-label="Filters"
            title="Filters"
          >
            <Filter className="h-4 w-4" />
            Filters
            {activeCount > 0 ? (
              <span className="ml-1 tabular-nums text-muted-foreground">
                ({activeCount})
              </span>
            ) : null}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel>Type (OR)</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {BOARD_KIND_OPTIONS.map((kind) => {
            const { label, icon: Icon } = KIND_OPTION_META[kind];
            return (
              <DropdownMenuCheckboxItem
                key={kind}
                checked={boardKindFilter.includes(kind)}
                onCheckedChange={() =>
                  setBoardKindFilter(toggleBoardKind(boardKindFilter, kind))
                }
                onSelect={(event) => event.preventDefault()}
              >
                <span className="flex items-center gap-2">
                  <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                  {label}
                </span>
              </DropdownMenuCheckboxItem>
            );
          })}
          {kindActive ? (
            <DropdownMenuItem onSelect={() => setBoardKindFilter([])}>
              Clear type
            </DropdownMenuItem>
          ) : null}

          <DropdownMenuSeparator />
          <DropdownMenuLabel>Labels (OR)</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {catalog.length === 0 ? (
            <div className="px-2 py-1.5 text-sm text-muted-foreground">
              No labels in project catalog
            </div>
          ) : (
            catalog.map((label) => (
              <DropdownMenuCheckboxItem
                key={label.id}
                checked={labelFilter.includes(label.id)}
                onCheckedChange={() =>
                  setLabelFilter(toggleAssignmentId(labelFilter, label.id))
                }
                onSelect={(event) => event.preventDefault()}
              >
                <ProjectLabelChip label={label} />
              </DropdownMenuCheckboxItem>
            ))
          )}
          {labelsActive ? (
            <DropdownMenuItem onSelect={() => setLabelFilter([])}>
              Clear labels
            </DropdownMenuItem>
          ) : null}

          <DropdownMenuSeparator />
          <div
            className="flex items-center justify-between gap-3 px-2 py-1.5"
            onPointerDown={(event) => event.preventDefault()}
          >
            <Label
              htmlFor="overview-show-archived"
              className="cursor-pointer font-normal"
            >
              Show archived
            </Label>
            <Switch
              id="overview-show-archived"
              checked={showArchived}
              onCheckedChange={setShowArchived}
              aria-label="Show archived issues"
            />
          </div>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
