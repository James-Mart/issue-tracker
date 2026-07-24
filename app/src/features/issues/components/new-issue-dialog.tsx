import { useEffect, useMemo, useState } from "react";
import { FIELD_LABELS } from "@server/fields";
import { KINDS, PARENT_KINDS, type IssueKind } from "@server/schemas";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useCreateIssue } from "../api/mutations";
import { useIssuesQuery } from "../api/queries";
import { useIssueUiStore } from "../store/use-issue-ui-store";
import { KIND_LABEL } from "../lib/kind";
import { PartOfTargetSelect } from "./part-of-target-select";

// Projects are created from the sidebar, not this dialog.
const SELECTABLE_KINDS = KINDS.filter((kind) => kind !== "project");

function descriptionFor(kind: IssueKind): string {
  switch (kind) {
    case "idea":
      return "Name the idea and capture it under this project.";
    case "epic":
      return "Add an Epic under this project.";
    case "story":
      return "Add a Story under a project or epic.";
    case "task":
      return "Add a Task under its Story.";
    default:
      return "Add it under its parent in the plan.";
  }
}

export function NewIssueDialog() {
  const target = useIssueUiStore((s) => s.newIssue);
  const closeNew = useIssueUiStore((s) => s.closeNew);
  const { data } = useIssuesQuery();
  const createIssue = useCreateIssue();

  const [kind, setKind] = useState<IssueKind>("epic");
  const [title, setTitle] = useState("");
  const [parent, setParent] = useState<string>("");
  const [stackedOn, setStackedOn] = useState<string>("");

  const kindLocked = Boolean(target?.presetKind);
  const parentLocked = Boolean(target?.presetParent);

  useEffect(() => {
    if (!target) return;
    setKind(target.presetKind ?? "epic");
    setParent(target.presetParent ?? "");
    setStackedOn(target.presetStackedOn ?? "");
    setTitle("");
  }, [target]);

  const parentKinds = PARENT_KINDS[kind];
  const parentOptions = useMemo(
    () =>
      (data?.issues ?? []).filter((issue) =>
        parentKinds.includes(issue.kind),
      ),
    [data?.issues, parentKinds],
  );

  const needsParent = parentKinds.length > 0;
  const parentKindLabel = parentKinds.map((k) => KIND_LABEL[k]).join(" / ");
  const canSubmit =
    title.trim().length > 0 &&
    (!needsParent || parent.length > 0) &&
    !createIssue.isPending;

  const submit = () => {
    if (!canSubmit) return;
    createIssue.mutate(
      {
        kind,
        title: title.trim(),
        partOf: needsParent ? parent : undefined,
        stackedOn: stackedOn || undefined,
      },
      { onSuccess: () => closeNew() },
    );
  };

  return (
    <Dialog open={Boolean(target)} onOpenChange={(open) => !open && closeNew()}>
      <DialogContent data-testid="new-issue-dialog">
        <DialogHeader>
          <DialogTitle>New {KIND_LABEL[kind].toLowerCase()}</DialogTitle>
          <DialogDescription>{descriptionFor(kind)}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          {!kindLocked ? (
            <div className="grid gap-1.5">
              <Label>Kind</Label>
              <Select
                value={kind}
                onValueChange={(v) => {
                  setKind(v as IssueKind);
                  setParent("");
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SELECTABLE_KINDS.map((option) => (
                    <SelectItem key={option} value={option}>
                      {KIND_LABEL[option]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}

          <div className="grid gap-1.5">
            <Label htmlFor="new-issue-title">{FIELD_LABELS.title}</Label>
            <Input
              id="new-issue-title"
              value={title}
              autoFocus
              placeholder={`Name the ${KIND_LABEL[kind].toLowerCase()}`}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submit()}
            />
          </div>

          {needsParent && !parentLocked ? (
            <div className="grid gap-1.5">
              <Label>
                {FIELD_LABELS.partOf} ({parentKindLabel})
              </Label>
              <PartOfTargetSelect
                value={parent}
                onValueChange={setParent}
                options={parentOptions}
                placeholder={`Select a ${parentKindLabel.toLowerCase()}`}
              />
            </div>
          ) : null}

          {parentLocked ? (
            <p className="text-xs text-muted-foreground">
              {FIELD_LABELS.partOf}{" "}
              <span className="font-mono">{parent}</span>
            </p>
          ) : null}

          {target?.presetStackedOn ? (
            <p className="text-xs text-muted-foreground">
              {FIELD_LABELS.stackedOn}{" "}
              <span className="font-mono">{stackedOn}</span>
            </p>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => closeNew()}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit} disabled={!canSubmit}>
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
