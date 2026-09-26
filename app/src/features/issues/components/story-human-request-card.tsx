import { useState, type FormEvent, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import type { IssueDetail } from "@server/schemas";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils/cn";
import { useHumanDone } from "../api/mutations";
import { useCommentsQuery } from "../api/queries";
import {
  type HumanRequestItem,
  humanHandoffView,
} from "../lib/human-request";
import { projectSecretsCardPath } from "../lib/links";

type StoryDetail = Extract<IssueDetail, { kind: "story" }>;

const DONE_CAPTION =
  "Done sends the Story back to Story review, which gives the verdict.";

const NOTE_PLACEHOLDER =
  "What you did or observed — helps the validator resume";

function formatCompletedAt(at: string): string {
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return at;
  return date.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function RequestItems({
  items,
  body,
  projectId,
}: {
  items: HumanRequestItem[];
  body: string;
  projectId: string;
}) {
  if (items.length === 0) {
    return (
      <p className="whitespace-pre-wrap text-sm leading-relaxed">{body}</p>
    );
  }

  return (
    <ul className="flex list-disc flex-col gap-1.5 pl-5 text-sm leading-relaxed">
      {items.map((item, index) => (
        <li key={`${item.kind}-${index}`}>
          <RequestItem item={item} projectId={projectId} />
        </li>
      ))}
    </ul>
  );
}

function RequestItem({
  item,
  projectId,
}: {
  item: HumanRequestItem;
  projectId: string;
}) {
  if (item.kind === "secret") {
    return (
      <>
        Secret{" "}
        <Link
          to={projectSecretsCardPath(projectId)}
          className="font-mono text-primary underline-offset-4 hover:underline"
          data-testid={`human-request-secret-${item.key}`}
        >
          {item.key}
        </Link>
        {item.detail ? `: ${item.detail}` : null}
      </>
    );
  }
  const label = item.kind === "input" ? "Input" : "Observation";
  return (
    <>
      {label}: {item.detail}
    </>
  );
}

function CardShell({
  state,
  children,
}: {
  state: "awaiting" | "completed";
  children: ReactNode;
}) {
  return (
    <section
      data-testid="human-request-card"
      data-state={state}
      className={cn(
        "flex flex-col gap-3 rounded-lg border bg-card px-4 py-3.5",
        state === "awaiting" ? "border-warning" : "border-border",
      )}
    >
      {children}
    </section>
  );
}

function AwaitingRequest({
  projectId,
  storyId,
  items,
  body,
}: {
  projectId: string;
  storyId: string;
  items: HumanRequestItem[];
  body: string;
}) {
  const done = useHumanDone(storyId);
  const [note, setNote] = useState("");

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (done.isPending) return;
    const trimmed = note.trim();
    done.mutate(trimmed ? { note: trimmed } : {});
  };

  return (
    <CardShell state="awaiting">
      <h2 className="text-sm font-semibold">Validator needs you</h2>
      <RequestItems items={items} body={body} projectId={projectId} />
      <form className="flex flex-col gap-2" onSubmit={submit}>
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="text-muted-foreground">Note (optional)</span>
          <Textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder={NOTE_PLACEHOLDER}
            aria-label="Note (optional)"
            data-testid="human-request-note"
          />
        </label>
        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="submit"
            variant="primary"
            data-testid="human-request-done"
            disabled={done.isPending}
          >
            Done
          </Button>
          <p className="max-w-[46ch] text-sm text-muted-foreground">
            {DONE_CAPTION}
          </p>
        </div>
      </form>
    </CardShell>
  );
}

export function StoryHumanRequestCard({ issue }: { issue: StoryDetail }) {
  const { projectId = "" } = useParams();
  const comments = useCommentsQuery(issue.id);

  if (comments.isLoading) return null;

  const view = humanHandoffView(issue.review, comments.data?.messages ?? []);
  if (!view) {
    if (issue.review === "awaiting-human" && comments.isError) {
      return (
        <CardShell state="awaiting">
          <h2 className="text-sm font-semibold">Validator needs you</h2>
          <p className="text-sm text-destructive">Could not load the request.</p>
        </CardShell>
      );
    }
    return null;
  }

  if (view.mode === "completed") {
    const noteText = view.response.body.trim();
    return (
      <CardShell state="completed">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-sm font-semibold">Human step completed</h2>
          <time
            dateTime={view.response.at}
            data-testid="human-request-completed-time"
            className="shrink-0 text-xs text-muted-foreground"
          >
            {formatCompletedAt(view.response.at)}
          </time>
        </div>
        <RequestItems
          items={view.items}
          body={view.request.body}
          projectId={projectId}
        />
        {noteText ? (
          <div className="rounded-md border border-border bg-background/40 px-3 py-2">
            <p className="text-xs text-muted-foreground">Your note</p>
            <p
              data-testid="human-request-completed-note"
              className="mt-1 whitespace-pre-wrap text-sm leading-relaxed"
            >
              {noteText}
            </p>
          </div>
        ) : null}
      </CardShell>
    );
  }

  return (
    <AwaitingRequest
      projectId={projectId}
      storyId={issue.id}
      items={view.items}
      body={view.request.body}
    />
  );
}
