import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { FIELD_LABELS } from "@server/fields";
import { KINDS, PARENT_KINDS } from "@server/issue-constants";
import type { IssueKind } from "@server/schemas";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogField,
  DialogFields,
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
import { useRouteProjectId } from "../hooks/use-route-project-id";
import { issuesById, projectIdOf } from "../lib/build-tree";
import {
  type IssueBackLocationState,
  issueBackNavigateState,
} from "../lib/issue-back";
import { issuePath } from "../lib/links";
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
  const navigate = useNavigate();
  const location = useLocation();
  const routeProjectId = useRouteProjectId();
  const target = useIssueUiStore((s) => s.newIssue);
  const closeNew = useIssueUiStore((s) => s.closeNew);
  const { data } = useIssuesQuery();
  const createIssue = useCreateIssue();
  const byId = useMemo(
    () => issuesById(data?.issues ?? []),
    [data?.issues],
  );

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
      {
        onSuccess: (issue) => {
          const withNew = new Map(byId);
          withNew.set(issue.id, issue);
          const projectId = projectIdOf(issue.id, withNew) ?? routeProjectId;
          if (projectId) {
            const navigateState = issueBackNavigateState(
              location.pathname,
              location.search,
              (location.state as IssueBackLocationState | null)?.issueBackStack,
            );
            navigate(
              issuePath(projectId, issue.id),
              navigateState ? { state: navigateState } : undefined,
            );
          }
          closeNew();
        },
      },
    );
  };

  return (
    <Dialog open={Boolean(target)} onOpenChange={(open) => !open && closeNew()}>
      <DialogContent data-testid="new-issue-dialog">
        <DialogHeader>
          <DialogTitle>New {KIND_LABEL[kind].toLowerCase()}</DialogTitle>
          <DialogDescription>{descriptionFor(kind)}</DialogDescription>
        </DialogHeader>

        <DialogFields>
          {!kindLocked ? (
            <DialogField>
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
            </DialogField>
          ) : null}

          <DialogField>
            <Label htmlFor="new-issue-title">{FIELD_LABELS.title}</Label>
            <Input
              id="new-issue-title"
              value={title}
              autoFocus
              placeholder={`Name the ${KIND_LABEL[kind].toLowerCase()}`}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submit()}
            />
          </DialogField>

          {needsParent && !parentLocked ? (
            <DialogField>
              <Label>
                {FIELD_LABELS.partOf} ({parentKindLabel})
              </Label>
              <PartOfTargetSelect
                value={parent}
                onValueChange={setParent}
                options={parentOptions}
                placeholder={`Select a ${parentKindLabel.toLowerCase()}`}
              />
            </DialogField>
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
        </DialogFields>

        <DialogFooter>
          <Button onClick={() => closeNew()}>Cancel</Button>
          <Button variant="primary" onClick={submit} disabled={!canSubmit}>
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
