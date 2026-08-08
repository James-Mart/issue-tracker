import { useId, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { FIELD_LABELS } from "@server/fields";
import { LABEL_COLOR_RE } from "@server/schemas";
import { ShellInlineFault } from "@/app/shell-state";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  LABEL_DESCRIPTION_MAX,
  newCatalogDraft,
  normalizeCatalogLabel,
  validateCatalogDraft,
  type CatalogDraft,
} from "../lib/project-labels";
import { SettingsCard } from "./detail-section";
import { ProjectLabelChip } from "./project-label-chip";

function ColorField({
  id,
  value,
  onChange,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const pickerValue = LABEL_COLOR_RE.test(value) ? value : "#64748b";
  return (
    <div className="flex items-center gap-2">
      <input
        id={`${id}-picker`}
        type="color"
        value={pickerValue}
        onChange={(e) => onChange(e.target.value.toLowerCase())}
        className="h-9 w-10 cursor-pointer rounded border border-border bg-transparent p-1"
        title="Pick color"
      />
      <Input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="font-mono"
        placeholder="#rrggbb"
        spellCheck={false}
      />
    </div>
  );
}

/** Focused editor for one catalog label; the chip row stays quiet behind it. */
function LabelDialog({
  draft,
  isNew,
  siblingIds,
  onCancel,
  onSave,
  onRemove,
}: {
  draft: CatalogDraft;
  isNew: boolean;
  siblingIds: string[];
  onCancel: () => void;
  onSave: (draft: CatalogDraft) => void;
  onRemove: () => void;
}) {
  const fieldId = useId();
  const [edited, setEdited] = useState(draft);
  const [error, setError] = useState<string | null>(null);

  const save = () => {
    const invalid = validateCatalogDraft(edited);
    if (invalid) {
      setError(invalid);
      return;
    }
    const id = edited.id.trim();
    if (siblingIds.includes(id)) {
      setError(`Duplicate label id "${id}"`);
      return;
    }
    onSave(edited);
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onCancel()}>
      <DialogContent data-testid="project-label-dialog">
        <DialogHeader>
          <DialogTitle>{isNew ? "New label" : "Edit label"}</DialogTitle>
          <DialogDescription>
            Labels in this catalog are the ones you can assign on epics, ideas,
            and stories.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor={`${fieldId}-id`}>Id</Label>
            <Input
              id={`${fieldId}-id`}
              value={edited.id}
              autoFocus
              className="font-mono"
              placeholder="kebab-case"
              spellCheck={false}
              onChange={(e) => setEdited({ ...edited, id: e.target.value })}
              onKeyDown={(e) => e.key === "Enter" && save()}
            />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor={`${fieldId}-color`}>Color</Label>
            <ColorField
              id={`${fieldId}-color`}
              value={edited.color}
              onChange={(color) => setEdited({ ...edited, color })}
            />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor={`${fieldId}-description`}>
              Description (optional)
            </Label>
            <Input
              id={`${fieldId}-description`}
              value={edited.description}
              maxLength={LABEL_DESCRIPTION_MAX}
              placeholder="Shown as chip tooltip"
              onChange={(e) =>
                setEdited({ ...edited, description: e.target.value })
              }
              onKeyDown={(e) => e.key === "Enter" && save()}
            />
          </div>

          <div className="flex items-center justify-between gap-3">
            {LABEL_COLOR_RE.test(edited.color.trim()) && edited.id.trim() ? (
              <ProjectLabelChip label={normalizeCatalogLabel(edited)} />
            ) : (
              <span className="text-xs text-muted-foreground">
                Preview appears after id and color are set.
              </span>
            )}
            <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
              {edited.description.length}/{LABEL_DESCRIPTION_MAX}
            </span>
          </div>

          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </div>

        <DialogFooter className="sm:justify-between">
          {isNew ? (
            <span />
          ) : (
            <Button variant="ghost" onClick={onRemove}>
              <Trash2 className="h-3.5 w-3.5 text-destructive" />
              Remove
            </Button>
          )}
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <Button variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
            <Button variant="primary" onClick={save}>
              Save
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The Project label catalog as a chip row: each chip opens a focused editor,
 * so the settings surface shows the labels themselves rather than a form per
 * label.
 */
export function ProjectLabelsEditor({
  drafts,
  onCommit,
  error,
  disabled,
}: {
  drafts: CatalogDraft[];
  /** Persist the whole catalog after an add, edit, or remove. */
  onCommit: (drafts: CatalogDraft[]) => void;
  error?: string | null;
  disabled?: boolean;
}) {
  const [editing, setEditing] = useState<{
    draft: CatalogDraft;
    isNew: boolean;
  } | null>(null);

  const close = () => setEditing(null);

  const save = (edited: CatalogDraft) => {
    onCommit(
      editing?.isNew
        ? [...drafts, edited]
        : drafts.map((draft) => (draft.key === edited.key ? edited : draft)),
    );
    close();
  };

  const remove = (key: string) => {
    onCommit(drafts.filter((draft) => draft.key !== key));
    close();
  };

  return (
    <SettingsCard
      title={FIELD_LABELS.labels}
      action={
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled}
          onClick={() => setEditing({ draft: newCatalogDraft(), isNew: true })}
        >
          <Plus className="h-3.5 w-3.5" />
          Add label
        </Button>
      }
    >
      {drafts.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No labels in the catalog. Add a label to assign on issues.
        </p>
      ) : (
        <ul className="flex flex-wrap items-center gap-1.5">
          {drafts.map((draft) => (
            <li key={draft.key}>
              <button
                type="button"
                disabled={disabled}
                aria-label={`Edit label ${draft.id}`}
                className="rounded-md transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card disabled:opacity-50"
                onClick={() => setEditing({ draft, isNew: false })}
              >
                <ProjectLabelChip label={normalizeCatalogLabel(draft)} />
              </button>
            </li>
          ))}
        </ul>
      )}

      {error ? (
        <ShellInlineFault
          className="mt-2"
          message={error}
          hint="Fix the label fields, then save again."
        />
      ) : null}

      {editing ? (
        <LabelDialog
          draft={editing.draft}
          isNew={editing.isNew}
          siblingIds={drafts
            .filter((draft) => draft.key !== editing.draft.key)
            .map((draft) => draft.id.trim())}
          onCancel={close}
          onSave={save}
          onRemove={() => remove(editing.draft.key)}
        />
      ) : null}
    </SettingsCard>
  );
}
