import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
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
import { chatConversationPath } from "../lib/links";
import {
  visionSessionMessage,
  visionSessionTitle,
} from "../lib/vision-launch";
import {
  newConversationInitialFocusField,
  projectHasUsableWorkspace,
  resolveNewConversationSelection,
} from "../lib/create-conversation-defaults";
import { useAgentsUiStore } from "../store/use-agents-ui-store";

const CONVERSATION_TYPES = [
  { value: "general", label: "General" },
  { value: "vision-refinement", label: "Vision refinement" },
] as const;

type ConversationType = (typeof CONVERSATION_TYPES)[number]["value"];

export function buildCreateConversationBody(
  conversationType: ConversationType,
  fields: { projectId: string; model: string; title: string },
) {
  if (conversationType === "vision-refinement") {
    return {
      projectId: fields.projectId,
      model: fields.model,
      title: visionSessionTitle(),
      message: visionSessionMessage(fields.projectId),
    };
  }
  return {
    projectId: fields.projectId,
    model: fields.model,
    ...(fields.title.trim() ? { title: fields.title.trim() } : {}),
  };
}

export function CreateConversationDialog() {
  const open = useAgentsUiStore((s) => s.createDialogOpen);
  const close = useAgentsUiStore((s) => s.closeCreateDialog);
  const navigate = useNavigate();
  const { data: issuesData, isLoading: issuesLoading } = useIssuesQuery();
  const { data: modelsData, isLoading: modelsLoading } = useAgentModelsQuery();
  const createConversation = useCreateConversation();

  const [conversationType, setConversationType] =
    useState<ConversationType>("general");
  const [projectId, setProjectId] = useState("");
  const [model, setModel] = useState("");
  const [title, setTitle] = useState("");
  const titleRef = useRef<HTMLInputElement>(null);
  const projectTriggerRef = useRef<HTMLButtonElement>(null);
  const modelTriggerRef = useRef<HTMLButtonElement>(null);
  const initialFocusPlaced = useRef(false);

  const projects = useMemo(
    () => listProjects(issuesData?.issues ?? []),
    [issuesData?.issues],
  );

  const models = useMemo(
    () => modelsData?.models ?? [],
    [modelsData?.models],
  );

  useEffect(() => {
    if (open) return;
    setConversationType("general");
    setProjectId("");
    setModel("");
    setTitle("");
    initialFocusPlaced.current = false;
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const resolved = resolveNewConversationSelection(
      projectId,
      model,
      projects,
      models,
    );
    if (!projectId && resolved.projectId) setProjectId(resolved.projectId);
    if (!model && !modelsLoading && resolved.modelId) setModel(resolved.modelId);
  }, [open, projectId, model, modelsLoading, projects, models]);

  useLayoutEffect(() => {
    if (!open || initialFocusPlaced.current) return;
    if (issuesLoading || modelsLoading) return;

    const resolved = resolveNewConversationSelection(
      projectId,
      model,
      projects,
      models,
    );
    const field = newConversationInitialFocusField({
      projectId: resolved.projectId,
      modelId: resolved.modelId,
      titleAvailable: conversationType === "general",
    });
    if (!field) {
      initialFocusPlaced.current = true;
      return;
    }
    const node = {
      title: titleRef,
      project: projectTriggerRef,
      model: modelTriggerRef,
    }[field].current;
    if (!node) return;
    node.focus();
    initialFocusPlaced.current = true;
  }, [
    open,
    issuesLoading,
    modelsLoading,
    projectId,
    model,
    projects,
    models,
    conversationType,
  ]);

  const selectedProject = projects.find((p) => p.id === projectId);
  const projectHasWorkspace =
    selectedProject !== undefined &&
    projectHasUsableWorkspace(selectedProject);

  const canSubmit =
    projectId.length > 0 &&
    projectHasWorkspace &&
    model.length > 0 &&
    !createConversation.isPending &&
    !modelsLoading;

  const submit = () => {
    if (!canSubmit) return;
    createConversation.mutate(
      buildCreateConversationBody(conversationType, {
        projectId,
        model,
        title,
      }),
      {
        onSuccess: (meta) => {
          navigate(chatConversationPath(meta.id));
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
            <Label htmlFor="conversation-type">Conversation type</Label>
            <Select
              value={conversationType}
              onValueChange={(value) =>
                setConversationType(value as ConversationType)
              }
            >
              <SelectTrigger id="conversation-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CONVERSATION_TYPES.map((entry) => (
                  <SelectItem key={entry.value} value={entry.value}>
                    {entry.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="conversation-project">Project</Label>
            <Select value={projectId} onValueChange={setProjectId}>
              <SelectTrigger id="conversation-project" ref={projectTriggerRef}>
                <SelectValue placeholder="Select a project" />
              </SelectTrigger>
              <SelectContent>
                {projects.map((project) => {
                  const hasWorkspace = projectHasUsableWorkspace(project);
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
              // Empty catalogs stay enabled so initial focus can land on Model.
              disabled={modelsLoading}
            >
              <SelectTrigger id="conversation-model" ref={modelTriggerRef}>
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

          {conversationType === "general" ? (
            <div className="grid gap-1.5">
              <Label htmlFor="conversation-title">Title (optional)</Label>
              <Input
                id="conversation-title"
                ref={titleRef}
                value={title}
                placeholder="New conversation"
                onChange={(e) => setTitle(e.target.value)}
                onKeyDown={(event) => {
                  if (event.key !== "Enter") return;
                  event.preventDefault();
                  submit();
                }}
              />
            </div>
          ) : null}
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
