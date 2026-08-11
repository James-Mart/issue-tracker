import type { ReactNode } from "react";
import { MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * Compact channel chrome control: session switcher, Retro, and New run live
 * in one overflow surface instead of a permanent header row.
 */
export function ChannelSessionOverflowMenu({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="shrink-0 text-muted-foreground"
          title="Session actions"
          aria-label="Session actions"
          data-testid="channel-session-overflow-menu"
        >
          <MoreHorizontal className="h-3.5 w-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-72 p-2"
        data-testid="channel-session-overflow-content"
      >
        <div className="flex min-w-0 flex-col gap-2">{children}</div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
