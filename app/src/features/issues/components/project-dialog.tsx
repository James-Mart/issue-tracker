import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FIELD_LABELS } from "@server/fields";
import type { MergePolicy } from "@server/schemas";
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
import { useCreateIssue, useUpdateIssue } from "../api/mutations";
import { useIssueUiStore } from "../store/use-issue-ui-store";
import { projectPath } from "../lib/links";
import { MergePolicySelect } from "./merge-policy-select";
import { WorkspacePathInput } from "./workspace-path-input";

function descriptionFor(isRename: boolean): string {
  return isRename
    ? "Update the project name shown across the plan."
    : "Name the project and group related epics.";
}

export function ProjectDialog() {
  const navigate = useNavigate();
  const target = useIssueUiStore((s) => s.projectDialog);
  const close = useIssueUiStore((s) => s.closeProjectDialog);
  const createIssue = useCreateIssue();
  const updateIssue = useUpdateIssue();

  const isRename = Boolean(target?.id);
  const [title, setTitle] = useState("");
  const [workspace, setWorkspace] = useState("");
  const [mergePolicy, setMergePolicy] = useState<MergePolicy>("manual");

  useEffect(() => {
    if (target) {
      setTitle(target.title ?? "");
      setWorkspace("");
      setMergePolicy("manual");
    }
  }, [target]);

  const pending = createIssue.isPending || updateIssue.isPending;
  const canSubmit = title.trim().length > 0 && !pending;

  const submit = () => {
    if (!canSubmit) return;
    const name = title.trim();
    if (isRename && target?.id) {
      updateIssue.mutate(
        { id: target.id, patch: { title: name } },
        { onSuccess: () => close() },
      );
    } else {
      const trimmedWorkspace = workspace.trim();
      createIssue.mutate(
        {
          kind: "project",
          title: name,
          mergePolicy,
          ...(trimmedWorkspace ? { workspace: trimmedWorkspace } : {}),
        },
        {
          onSuccess: (project) => {
            navigate(projectPath(project.id));
            close();
          },
        },
      );
    }
  };

  return (
    <Dialog open={Boolean(target)} onOpenChange={(open) => !open && close()}>
      <DialogContent data-testid="project-dialog">
        <DialogHeader>
          <DialogTitle>{isRename ? "Rename project" : "New project"}</DialogTitle>
          <DialogDescription>{descriptionFor(isRename)}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="project-title">{FIELD_LABELS.title}</Label>
            <Input
              id="project-title"
              value={title}
              autoFocus
              placeholder="Name the project"
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submit()}
            />
          </div>

          {!isRename ? (
            <>
              <div className="grid gap-1.5">
                <Label htmlFor="project-workspace">{FIELD_LABELS.workspace}</Label>
                <WorkspacePathInput
                  id="project-workspace"
                  value={workspace}
                  optional
                  onChange={setWorkspace}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="project-merge-policy">
                  {FIELD_LABELS.mergePolicy}
                </Label>
                <MergePolicySelect
                  id="project-merge-policy"
                  value={mergePolicy}
                  onChange={setMergePolicy}
                />
              </div>
            </>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => close()}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit} disabled={!canSubmit}>
            {isRename ? "Save" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
