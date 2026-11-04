import { useState } from "react";
import { MessageSquarePlus } from "lucide-react";
import { FIELD_LABELS } from "@server/fields";
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
import { useCreateAppendIdea } from "@/features/issues/lib/use-create-append-idea";
import { ADD_IDEA_HELPER } from "@/features/issues/lib/story-append-actions";

export function ReviewFollowUpIdeaButton({
  projectId,
  storyId,
  disabled,
}: {
  projectId: string;
  storyId: string;
  disabled?: boolean;
}) {
  const { createAppendIdea, isPending: pending } = useCreateAppendIdea(projectId);
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");

  const trimmedTitle = title.trim();

  const close = () => {
    setOpen(false);
    setTitle("");
  };

  const createFollowUpIdea = async () => {
    if (pending) return;
    await createAppendIdea(storyId, trimmedTitle);
    close();
  };

  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="shrink-0"
        disabled={disabled || pending}
        data-testid="review-follow-up-idea"
        aria-describedby="review-follow-up-idea-helper"
        onClick={() => setOpen(true)}
      >
        <MessageSquarePlus className="h-3.5 w-3.5" aria-hidden />
        Follow-up idea
      </Button>
      <p
        id="review-follow-up-idea-helper"
        className="sr-only"
      >
        {ADD_IDEA_HELPER}
      </p>
      <Dialog open={open} onOpenChange={(next) => (next ? setOpen(true) : close())}>
        <DialogContent data-testid="review-follow-up-idea-dialog">
          <DialogHeader>
            <DialogTitle>New follow-up idea</DialogTitle>
            <DialogDescription>{ADD_IDEA_HELPER}</DialogDescription>
          </DialogHeader>
          <DialogFields>
            <DialogField>
              <Label htmlFor="review-follow-up-idea-title">{FIELD_LABELS.title}</Label>
              <Input
                id="review-follow-up-idea-title"
                value={title}
                autoFocus
                data-testid="review-follow-up-idea-title"
                onChange={(event) => setTitle(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && trimmedTitle && !pending) {
                    event.preventDefault();
                    void createFollowUpIdea();
                  }
                }}
              />
            </DialogField>
            <p className="text-xs text-muted-foreground">
              {FIELD_LABELS.appendTo}{" "}
              <span className="font-mono">{storyId}</span>
            </p>
          </DialogFields>
          <DialogFooter>
            <Button type="button" onClick={close}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="primary"
              data-testid="review-follow-up-idea-confirm"
              disabled={!trimmedTitle || pending}
              onClick={() => void createFollowUpIdea()}
            >
              Create idea
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
