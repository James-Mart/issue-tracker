import { useRef } from "react";
import { Plus, Trash2 } from "lucide-react";
import { FIELD_LABELS } from "@server/fields";
import { ShellInlineFault } from "@/app/shell-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  newInspirationAppDraft,
  type InspirationAppDraft,
} from "../lib/inspiration-apps";
import { DetailEyebrow } from "./detail-section";

export function InspirationAppsEditor({
  drafts,
  onChange,
  onCommit,
  error,
  disabled,
}: {
  drafts: InspirationAppDraft[];
  onChange: (drafts: InspirationAppDraft[]) => void;
  /** Persist after remove or text blur. */
  onCommit?: (drafts: InspirationAppDraft[]) => void;
  error?: string | null;
  disabled?: boolean;
}) {
  const draftsRef = useRef(drafts);
  draftsRef.current = drafts;

  const setDraft = (key: string, patch: Partial<InspirationAppDraft>) => {
    const next = draftsRef.current.map((draft) =>
      draft.key === key ? { ...draft, ...patch } : draft,
    );
    draftsRef.current = next;
    onChange(next);
  };

  const removeDraft = (key: string) => {
    const next = draftsRef.current.filter((draft) => draft.key !== key);
    draftsRef.current = next;
    onChange(next);
    onCommit?.(next);
  };

  const commit = () => {
    onCommit?.(draftsRef.current);
  };

  return (
    <section className="rounded-lg border border-border bg-card p-5">
      <div className="mb-3 flex items-center justify-between gap-2">
        <DetailEyebrow>{FIELD_LABELS.inspirationApps}</DetailEyebrow>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled}
          onClick={() => {
            const next = [...draftsRef.current, newInspirationAppDraft()];
            draftsRef.current = next;
            onChange(next);
          }}
        >
          <Plus className="h-3.5 w-3.5" />
          Add app
        </Button>
      </div>

      {drafts.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No inspiration apps. Add an app that informs this project.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {drafts.map((draft) => (
            <li
              key={draft.key}
              className="flex flex-col gap-2 rounded-md border border-border bg-muted/40 p-3"
            >
              <div className="flex items-center justify-end">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  title="Remove app"
                  disabled={disabled}
                  onClick={() => removeDraft(draft.key)}
                >
                  <Trash2 className="h-3.5 w-3.5 text-destructive" />
                </Button>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="grid gap-1.5">
                  <Label htmlFor={`inspiration-name-${draft.key}`}>Name</Label>
                  <Input
                    id={`inspiration-name-${draft.key}`}
                    value={draft.name}
                    disabled={disabled}
                    onChange={(e) =>
                      setDraft(draft.key, { name: e.target.value })
                    }
                    onBlur={commit}
                    placeholder="App name"
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor={`inspiration-url-${draft.key}`}>URL</Label>
                  <Input
                    id={`inspiration-url-${draft.key}`}
                    value={draft.url}
                    disabled={disabled}
                    onChange={(e) =>
                      setDraft(draft.key, { url: e.target.value })
                    }
                    onBlur={commit}
                    className="font-mono"
                    placeholder="https://…"
                    spellCheck={false}
                  />
                </div>
              </div>

              <div className="grid gap-1.5">
                <Label htmlFor={`inspiration-desc-${draft.key}`}>
                  Description
                </Label>
                <Textarea
                  id={`inspiration-desc-${draft.key}`}
                  value={draft.description}
                  disabled={disabled}
                  onChange={(e) =>
                    setDraft(draft.key, { description: e.target.value })
                  }
                  onBlur={commit}
                  placeholder="What this app is and why it matters"
                  rows={2}
                />
              </div>
            </li>
          ))}
        </ul>
      )}

      {error ? (
        <ShellInlineFault
          className="mt-3"
          message={error}
          hint="Fix the fields, then save again."
        />
      ) : null}
    </section>
  );
}
