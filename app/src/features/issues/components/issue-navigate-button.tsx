import type { MouseEvent } from "react";
import { ArrowUpRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useIssueLinkNavigate } from "./issue-link";

export function IssueNavigateButton({
  id,
  onClick,
}: {
  id: string;
  onClick?: (event: MouseEvent<HTMLButtonElement>) => void;
}) {
  const { go } = useIssueLinkNavigate();

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      title={`Open ${id}`}
      className="shrink-0 text-muted-foreground"
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onClick?.(event);
        go(id);
      }}
    >
      <ArrowUpRight className="h-3.5 w-3.5" />
    </Button>
  );
}
