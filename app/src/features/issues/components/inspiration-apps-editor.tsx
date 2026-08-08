import { useRef } from "react";
import { Plus, Trash2 } from "lucide-react";
import { FIELD_LABELS } from "@server/fields";
import { ShellInlineFault } from "@/app/shell-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils/cn";
import {
  newInspirationAppDraft,
  type InspirationAppDraft,
} from "../lib/inspiration-apps";
import { SETTINGS_HEADING_CLASS, SettingsCard } from "./detail-section";

/** Name · URL · Description · remove, shared by the heading row and each app row. */
const APP_ROW_CLASS =
  "grid grid-cols-1 gap-x-3 gap-y-1.5 lg:grid-cols-[minmax(7rem,1fr)_minmax(10rem,1.3fr)_minmax(0,2.4fr)_1.75rem] lg:items-start lg:gap-y-0";

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
    <SettingsCard
      title={FIELD_LABELS.inspirationApps}
      action={
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
      }
    >
      {drafts.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No inspiration apps. Add an app that informs this project.
        </p>
      ) : (
        <>
          <div
            className={cn(APP_ROW_CLASS, "hidden pb-1 lg:grid")}
            aria-hidden="true"
          >
            <span className={SETTINGS_HEADING_CLASS}>Name</span>
            <span className={SETTINGS_HEADING_CLASS}>URL</span>
            <span className={SETTINGS_HEADING_CLASS}>Description</span>
            <span />
          </div>

          <ul className="flex flex-col">
            {drafts.map((draft) => (
              <li
                key={draft.key}
                className={cn(APP_ROW_CLASS, "border-t border-border py-2")}
              >
                <Input
                  value={draft.name}
                  disabled={disabled}
                  onChange={(e) => setDraft(draft.key, { name: e.target.value })}
                  onBlur={commit}
                  className="h-8 text-[13px]"
                  placeholder="App name"
                  aria-label="App name"
                />
                <Input
                  value={draft.url}
                  disabled={disabled}
                  onChange={(e) => setDraft(draft.key, { url: e.target.value })}
                  onBlur={commit}
                  className="h-8 font-mono text-[13px]"
                  placeholder="https://…"
                  spellCheck={false}
                  aria-label="App URL"
                  title={draft.url}
                />
                <Textarea
                  value={draft.description}
                  disabled={disabled}
                  onChange={(e) =>
                    setDraft(draft.key, { description: e.target.value })
                  }
                  onBlur={commit}
                  rows={2}
                  className="min-h-8 py-1.5 text-[13px] leading-snug"
                  placeholder="What this app is and why it matters"
                  aria-label="App description"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  title={`Remove ${draft.name || "app"}`}
                  className="justify-self-end"
                  disabled={disabled}
                  onClick={() => removeDraft(draft.key)}
                >
                  <Trash2 className="h-3.5 w-3.5 text-destructive" />
                </Button>
              </li>
            ))}
          </ul>
        </>
      )}

      {error ? (
        <ShellInlineFault
          className="mt-2"
          message={error}
          hint="Fix the fields, then save again."
        />
      ) : null}
    </SettingsCard>
  );
}
