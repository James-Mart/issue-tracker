import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

export function ExternalEditConflictBanner({
  onReload,
  onKeep,
}: {
  onReload: () => void;
  onKeep: () => void;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">
      <div className="flex items-center gap-2 font-medium [color:hsl(var(--warning))]">
        <AlertTriangle className="h-4 w-4" />
        This issue changed on disk while you were editing.
      </div>
      <p className="text-muted-foreground">
        Reload to discard your edits and load the disk version, or keep your
        edits (saving will overwrite the disk changes).
      </p>
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="outline"
          onMouseDown={(e) => e.preventDefault()}
          onClick={onReload}
        >
          Reload from disk
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onMouseDown={(e) => e.preventDefault()}
          onClick={onKeep}
        >
          Keep my edits
        </Button>
      </div>
    </div>
  );
}
