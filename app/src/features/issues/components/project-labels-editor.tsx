import { useRef } from "react";
import { Plus, Trash2 } from "lucide-react";
import { FIELD_LABELS } from "@server/fields";
import { LABEL_COLOR_RE } from "@server/schemas";
import { ShellInlineFault } from "@/app/shell-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  LABEL_DESCRIPTION_MAX,
  newCatalogDraft,
  type CatalogDraft,
} from "../lib/project-labels";
import { DetailEyebrow } from "./detail-section";
import { ProjectLabelChip } from "./project-label-chip";

function ColorField({
  id,
  value,
  disabled,
  onChange,
  onCommit,
}: {
  id: string;
  value: string;
  disabled?: boolean;
  onChange: (value: string) => void;
  onCommit?: () => void;
}) {
  const pickerValue = LABEL_COLOR_RE.test(value) ? value : "#64748b";
  return (
    <div className="flex items-center gap-2">
      <input
        id={`${id}-picker`}
        type="color"
        value={pickerValue}
        disabled={disabled}
        onChange={(e) => {
          onChange(e.target.value.toLowerCase());
          onCommit?.();
        }}
        className="h-9 w-10 cursor-pointer rounded border border-border bg-transparent p-1"
        title="Pick color"
      />
      <Input
        id={id}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => onCommit?.()}
        className="font-mono"
        placeholder="#rrggbb"
        spellCheck={false}
      />
    </div>
  );
}

export function ProjectLabelsEditor({
  drafts,
  onChange,
  onCommit,
  error,
  disabled,
}: {
  drafts: CatalogDraft[];
  onChange: (drafts: CatalogDraft[]) => void;
  /** Persist after an atomic change (remove, color pick, or text blur). */
  onCommit?: (drafts: CatalogDraft[]) => void;
  error?: string | null;
  disabled?: boolean;
}) {
  const draftsRef = useRef(drafts);
  draftsRef.current = drafts;

  const setDraft = (key: string, patch: Partial<CatalogDraft>) => {
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
        <DetailEyebrow>{FIELD_LABELS.labels}</DetailEyebrow>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled}
          onClick={() => {
            const next = [...draftsRef.current, newCatalogDraft()];
            draftsRef.current = next;
            onChange(next);
          }}
        >
          <Plus className="h-3.5 w-3.5" />
          Add label
        </Button>
      </div>

      {drafts.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No labels in the catalog. Add a label to assign on issues.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {drafts.map((draft) => (
            <li
              key={draft.key}
              className="flex flex-col gap-2 rounded-md border border-border bg-muted/40 p-3"
            >
              <div className="flex items-center justify-between gap-2">
                {LABEL_COLOR_RE.test(draft.color.trim()) && draft.id.trim() ? (
                  <ProjectLabelChip
                    label={{
                      id: draft.id.trim() || "label",
                      color: draft.color.trim(),
                      ...(draft.description.trim()
                        ? { description: draft.description.trim() }
                        : {}),
                    }}
                  />
                ) : (
                  <span className="text-xs text-muted-foreground">
                    Preview appears after id and color are set.
                  </span>
                )}
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  title="Remove label"
                  disabled={disabled}
                  onClick={() => removeDraft(draft.key)}
                >
                  <Trash2 className="h-3.5 w-3.5 text-destructive" />
                </Button>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="grid gap-1.5">
                  <Label htmlFor={`label-id-${draft.key}`}>Id</Label>
                  <Input
                    id={`label-id-${draft.key}`}
                    value={draft.id}
                    disabled={disabled}
                    onChange={(e) => setDraft(draft.key, { id: e.target.value })}
                    onBlur={commit}
                    className="font-mono"
                    placeholder="kebab-case"
                    spellCheck={false}
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor={`label-color-${draft.key}`}>Color</Label>
                  <ColorField
                    id={`label-color-${draft.key}`}
                    value={draft.color}
                    disabled={disabled}
                    onChange={(color) => setDraft(draft.key, { color })}
                    onCommit={commit}
                  />
                </div>
              </div>

              <div className="grid gap-1.5">
                <Label htmlFor={`label-desc-${draft.key}`}>
                  Description (optional)
                </Label>
                <Input
                  id={`label-desc-${draft.key}`}
                  value={draft.description}
                  disabled={disabled}
                  onChange={(e) =>
                    setDraft(draft.key, { description: e.target.value })
                  }
                  onBlur={commit}
                  maxLength={LABEL_DESCRIPTION_MAX}
                  placeholder="Shown as chip tooltip"
                />
                <p className="font-mono text-[11px] tabular-nums text-muted-foreground">
                  {draft.description.length}/{LABEL_DESCRIPTION_MAX}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}

      {error ? (
        <ShellInlineFault
          className="mt-3"
          message={error}
          hint="Fix the label fields, then save again."
        />
      ) : null}
    </section>
  );
}
