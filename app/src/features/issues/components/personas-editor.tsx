import { useRef } from "react";
import { Plus, Trash2 } from "lucide-react";
import { FIELD_LABELS } from "@server/fields";
import { ShellInlineFault } from "@/app/shell-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils/cn";
import { newPersonaDraft, type PersonaDraft } from "../lib/personas";
import { SETTINGS_HEADING_CLASS, SettingsCard } from "./detail-section";

/** Name · Description · remove, shared by the heading row and each persona row. */
const PERSONA_ROW_CLASS =
  "grid grid-cols-1 gap-x-3 gap-y-1.5 lg:grid-cols-[minmax(7rem,1fr)_minmax(0,2.4fr)_1.75rem] lg:items-start lg:gap-y-0";

export function PersonasEditor({
  drafts,
  onChange,
  onCommit,
  error,
  disabled,
}: {
  drafts: PersonaDraft[];
  onChange: (drafts: PersonaDraft[]) => void;
  /** Persist after remove or text blur. */
  onCommit?: (drafts: PersonaDraft[]) => void;
  error?: string | null;
  disabled?: boolean;
}) {
  const draftsRef = useRef(drafts);
  draftsRef.current = drafts;

  const setDraft = (key: string, patch: Partial<PersonaDraft>) => {
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
      title={FIELD_LABELS.personas}
      action={
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled}
          onClick={() => {
            const next = [...draftsRef.current, newPersonaDraft()];
            draftsRef.current = next;
            onChange(next);
          }}
        >
          <Plus className="h-3.5 w-3.5" />
          Add persona
        </Button>
      }
    >
      {drafts.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No personas. Add a persona that informs this project.
        </p>
      ) : (
        <>
          <div
            className={cn(PERSONA_ROW_CLASS, "hidden pb-1 lg:grid")}
            aria-hidden="true"
          >
            <span className={SETTINGS_HEADING_CLASS}>Name</span>
            <span className={SETTINGS_HEADING_CLASS}>Description</span>
            <span />
          </div>

          <ul className="flex flex-col">
            {drafts.map((draft) => (
              <li
                key={draft.key}
                className={cn(PERSONA_ROW_CLASS, "border-t border-border py-2")}
              >
                <Input
                  value={draft.name}
                  disabled={disabled}
                  onChange={(e) => setDraft(draft.key, { name: e.target.value })}
                  onBlur={commit}
                  className="h-8 text-[13px]"
                  placeholder="Persona name"
                  aria-label="Persona name"
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
                  placeholder="What this persona is and why it matters"
                  aria-label="Persona description"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  title={`Remove ${draft.name || "persona"}`}
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
