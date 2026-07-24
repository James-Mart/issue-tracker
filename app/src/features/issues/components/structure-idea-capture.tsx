import { useState } from "react";
import { Lightbulb } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useCreateIssue } from "../api/mutations";

type StructureIdeaCaptureProps = {
  projectId: string;
  /** True when the project has no visible Ideas — show first-run copy. */
  empty: boolean;
};

/**
 * Prominent Idea capture for the Structure lens. Creates via
 * `useCreateIssue` with `{ kind: "idea", partOf: projectId, title }`.
 */
export function StructureIdeaCapture({
  projectId,
  empty,
}: StructureIdeaCaptureProps) {
  const createIssue = useCreateIssue();
  const [title, setTitle] = useState("");

  const canSubmit = title.trim().length > 0 && !createIssue.isPending;

  const submit = () => {
    if (!canSubmit) return;
    createIssue.mutate(
      {
        kind: "idea",
        partOf: projectId,
        title: title.trim(),
      },
      {
        onSuccess: () => setTitle(""),
      },
    );
  };

  return (
    <section
      aria-labelledby="structure-idea-capture-heading"
      className="rounded-md border border-border bg-card px-4 py-4"
    >
      <div className="flex items-start gap-3">
        <div
          className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border text-[hsl(var(--current))]"
          aria-hidden
        >
          <Lightbulb className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <h2
            id="structure-idea-capture-heading"
            className="font-display text-[11px] font-semibold uppercase tracking-[0.22em] text-[hsl(var(--current))]"
          >
            Ideas
          </h2>
          {empty ? (
            <p className="mt-2 text-sm text-foreground">
              No ideas yet. Name what to plan next, then capture it here.
            </p>
          ) : null}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Input
              aria-label="Idea title"
              value={title}
              placeholder="Name the idea"
              className="min-w-[12rem] flex-1"
              disabled={createIssue.isPending}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  submit();
                }
              }}
            />
            <Button
              size="sm"
              variant="primary"
              disabled={!canSubmit}
              onClick={submit}
            >
              <Lightbulb className="h-4 w-4" />
              New idea
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
