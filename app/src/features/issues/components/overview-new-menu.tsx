import { ChevronDown, GitBranch, Layers, Lightbulb, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useIssueUiStore } from "../store/use-issue-ui-store";

const NEW_KIND_OPTIONS = [
  { kind: "epic" as const, label: "Epic", icon: Layers },
  { kind: "story" as const, label: "Story", icon: GitBranch },
  { kind: "idea" as const, label: "Idea", icon: Lightbulb },
];

/** Shared toolbar create menu — opens `NewIssueDialog` with preset kind/parent. */
export function OverviewNewMenu({ projectId }: { projectId: string }) {
  const openNew = useIssueUiStore((s) => s.openNew);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="primary"
          size="sm"
          className="shrink-0"
          aria-label="New"
        >
          <Plus className="h-4 w-4" />
          New
          <ChevronDown className="h-3.5 w-3.5 opacity-80" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {NEW_KIND_OPTIONS.map(({ kind, label, icon: Icon }) => (
          <DropdownMenuItem
            key={kind}
            onSelect={() =>
              openNew({ presetKind: kind, presetParent: projectId })
            }
          >
            <Icon className="h-4 w-4" />
            New {label.toLowerCase()}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
