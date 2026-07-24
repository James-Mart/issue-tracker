import { useEffect, useMemo, useState } from "react";
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
import { useCreateConversation } from "../api/mutations";
import { useAgentModelsQuery } from "../api/queries";
import { useIssuesQuery } from "@/features/issues/api/queries";
import { listProjects } from "@/features/issues/lib/build-tree";
import { useAgentsUiStore } from "../store/use-agents-ui-store";

export function CreateConversationDialog() {
  const open = useAgentsUiStore((s) => s.createDialogOpen);
  const close = useAgentsUiStore((s) => s.closeCreateDialog);
  const setSelectedConversationId = useAgentsUiStore(
    (s) => s.setSelectedConversationId,
  );
  const { data: issuesData } = useIssuesQuery();
  const { data: modelsData, isLoading: modelsLoading } = useAgentModelsQuery();
  const createConversation = useCreateConversation();

  const [projectId, setProjectId] = useState("");
  const [model, setModel] = useState("");
  const [title, setTitle] = useState("");

  const projects = useMemo(
    () => listProjects(issuesData?.issues ?? []),
    [issuesData?.issues],
  );

  const models = modelsData?.models ?? [];

  useEffect(() => {
    if (!open) return;
    setProjectId("");
    setModel("");
    setTitle("");
  }, [open]);

  useEffect(() => {
    if (!open || model || modelsLoading) return;
    const first = modelsData?.models?.[0]?.id;
    if (first) setModel(first);
  }, [open, model, modelsLoading, modelsData?.models]);

  const selectedProject = projects.find((p) => p.id === projectId);
  const projectHasWorkspace = Boolean(selectedProject?.workspace?.trim());

  const canSubmit =
    projectId.length > 0 &&
    projectHasWorkspace &&
    model.length > 0 &&
    !createConversation.isPending &&
    !modelsLoading;

  const submit = () => {
    if (!canSubmit) return;
    const trimmedTitle = title.trim();
    createConversation.mutate(
      {
        projectId,
        model,
        ...(trimmedTitle ? { title: trimmedTitle } : {}),
      },
      {
        onSuccess: (meta) => {
          setSelectedConversationId(meta.id);
          close();
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && close()}>
      <DialogContent data-testid="create-conversation-dialog">
        <DialogHeader>
          <DialogTitle>New conversation</DialogTitle>
          <DialogDescription>
            Pick a workspace-backed project and model to start an agent
            session.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="conversation-project">Project</Label>
            <Select value={projectId} onValueChange={setProjectId}>
              <SelectTrigger id="conversation-project">
                <SelectValue placeholder="Select a project" />
              </SelectTrigger>
              <SelectContent>
                {projects.map((project) => {
                  const hasWorkspace = Boolean(project.workspace?.trim());
                  return (
                    <SelectItem
                      key={project.id}
                      value={project.id}
                      disabled={!hasWorkspace}
                    >
                      {project.title}
                      {!hasWorkspace ? " (no workspace)" : ""}
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="conversation-model">Model</Label>
            <Select
              value={model}
              onValueChange={setModel}
              disabled={modelsLoading || models.length === 0}
            >
              <SelectTrigger id="conversation-model">
                <SelectValue
                  placeholder={
                    modelsLoading ? "Loading models…" : "Select a model"
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {models.map((entry) => (
                  <SelectItem key={entry.id} value={entry.id}>
                    {entry.displayName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="conversation-title">Title (optional)</Label>
            <Input
              id="conversation-title"
              value={title}
              placeholder="New conversation"
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submit()}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => close()}>
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
