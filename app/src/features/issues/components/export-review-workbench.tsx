import { useMemo, useState, type ReactNode } from "react";
import { ArrowLeft, ChevronDown, ChevronUp, Save } from "lucide-react";
import type { UseQueryResult } from "@tanstack/react-query";
import type { ChannelSessionListItem, Issue, IssueDetail } from "@server/schemas";
import { useConversationTranscriptQuery } from "@/features/agents/api/queries";
import { useSendConversationMessage } from "@/features/agents/api/mutations";
import { ConversationThread } from "@/features/agents/components/conversation-thread";
import { ShellInlineFault, ShellLoadingState } from "@/app/shell-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils/cn";
import { useOverwriteExportDraft } from "../api/mutations";
import {
  useAttachmentsQuery,
  useExportDraftTexts,
  useIssuesQuery,
} from "../api/queries";
import { exportSessionFailed, isExportDraftName } from "../lib/export-tab";
import {
  exportDraftBody,
  exportDraftIssueId,
  exportDraftKindLabel,
  exportDraftTitle,
  exportRunStripLabel,
  orderExportDraftNames,
  type ExportDraftOrderIssue,
} from "../lib/export-workbench";
import { DetailEyebrow } from "./detail-section";
import { Markdown } from "./markdown";

const EMPTY_ISSUES: Issue[] = [];

const PROMPT_PLACEHOLDER = "Ask for edits to any draft attachment...";

function toOrderIssue(issue: Issue): ExportDraftOrderIssue {
  return {
    id: issue.id,
    kind: issue.kind,
    order: issue.order,
    partOf: "partOf" in issue ? issue.partOf : undefined,
    stackedOn: issue.kind === "story" ? issue.stackedOn : undefined,
  };
}

function useExportRunStrip(
  session: ChannelSessionListItem | undefined,
  draftCount: number,
) {
  const needsOutcome = Boolean(session && !session.activeRun);
  const transcript = useConversationTranscriptQuery(
    needsOutcome ? session?.id : undefined,
  );
  const outcomePending =
    needsOutcome && !transcript.isFetched && !transcript.isError;
  const latestFailed =
    needsOutcome &&
    (transcript.isError ||
      (transcript.isFetched &&
        exportSessionFailed(transcript.data?.events ?? [])));
  const phase = session?.activeRun
    ? "running"
    : outcomePending
      ? "pending"
      : latestFailed
        ? "failed"
        : "complete";
  return {
    phase,
    label: exportRunStripLabel({
      activeRun: session?.activeRun ?? false,
      outcomePending,
      latestFailed,
      draftCount,
    }),
  };
}

function draftTitle(
  name: string,
  content: string | undefined,
  issues: readonly Issue[],
): string {
  const fromFile = content ? exportDraftTitle(content) : null;
  if (fromFile) return fromFile;
  const id = exportDraftIssueId(name);
  const match = id ? issues.find((issue) => issue.id === id) : undefined;
  return match?.title ?? name;
}

function RunStrip({
  session,
  draftCount,
}: {
  session: ChannelSessionListItem | undefined;
  draftCount: number;
}) {
  const { phase, label } = useExportRunStrip(session, draftCount);
  const [expanded, setExpanded] = useState(false);
  const [prompt, setPrompt] = useState("");
  const send = useSendConversationMessage();
  const dot =
    phase === "running"
      ? "bg-[hsl(var(--current))] motion-safe:animate-live-dot"
      : phase === "failed"
        ? "bg-[hsl(var(--blocked))]"
        : phase === "pending"
          ? "bg-muted-foreground"
          : "bg-[hsl(var(--success))]";

  return (
    <section
      className="shrink-0 overflow-hidden rounded-lg border border-border bg-card"
      data-testid="export-run-strip"
      data-phase={phase}
    >
      <button
        type="button"
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm"
        aria-expanded={expanded}
        data-testid="export-run-strip-toggle"
        onClick={() => setExpanded((open) => !open)}
      >
        <span className={cn("h-2 w-2 shrink-0 rounded-full", dot)} />
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {expanded ? (
          <ChevronUp className="h-4 w-4 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
        )}
      </button>
      {expanded ? (
        <div className="border-t border-border" data-testid="export-run-transcript">
          <div className="flex h-72 min-h-0 flex-col">
            {session ? (
              <ConversationThread
                conversationId={session.id}
                meta={{ title: session.title, model: session.model }}
                hideComposer
              />
            ) : (
              <p className="p-4 text-sm text-muted-foreground">
                No export session.
              </p>
            )}
          </div>
          <form
            className="flex items-center gap-2 border-t border-border p-3"
            onSubmit={(event) => {
              event.preventDefault();
              const text = prompt.trim();
              if (!session || !text || send.isPending) return;
              send.mutate(
                { id: session.id, body: { prompt: text } },
                { onSuccess: () => setPrompt("") },
              );
            }}
          >
            <Input
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder={PROMPT_PLACEHOLDER}
              disabled={!session || send.isPending}
              data-testid="export-run-prompt"
              aria-label="Message the export session"
            />
            <Button
              type="submit"
              size="sm"
              className="shrink-0"
              disabled={!session || send.isPending || prompt.trim().length === 0}
              data-testid="export-run-send"
            >
              {send.isPending ? "Sending…" : "Send"}
            </Button>
          </form>
        </div>
      ) : null}
    </section>
  );
}

function DraftList({
  ordered,
  texts,
  issues,
  selected,
  onSelect,
}: {
  ordered: readonly string[];
  texts: UseQueryResult<string, Error>[];
  issues: readonly Issue[];
  selected: string;
  onSelect: (name: string) => void;
}) {
  const noun = ordered.length === 1 ? "issue" : "issues";
  return (
    <section
      className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-border bg-card"
      data-testid="export-draft-list"
    >
      <header className="shrink-0 border-b border-border px-3 py-2">
        <DetailEyebrow>Drafts</DetailEyebrow>
        <p className="mt-1 text-xs text-muted-foreground">
          {ordered.length} {noun} · tracker order
        </p>
      </header>
      <ul className="min-h-0 flex-1 overflow-y-auto">
        {ordered.map((name, index) => {
          const id = exportDraftIssueId(name);
          const match = id ? issues.find((issue) => issue.id === id) : undefined;
          const kind = exportDraftKindLabel(match?.kind);
          const current = name === selected;
          return (
            <li key={name} className="border-b border-border last:border-b-0">
              <button
                type="button"
                className={cn(
                  "flex w-full items-start gap-2 px-3 py-2 text-left",
                  current && "bg-accent",
                )}
                aria-current={current ? "true" : undefined}
                data-testid="export-draft-row"
                data-draft-name={name}
                onClick={() => onSelect(name)}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">
                    {draftTitle(name, texts[index]?.data, issues)}
                  </span>
                  <span className="block truncate font-mono text-xs text-muted-foreground">
                    {name}
                  </span>
                </span>
                {kind ? (
                  <Badge variant={kind === "Epic" ? "current" : "todo"}>{kind}</Badge>
                ) : null}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function ViewToggle({
  mode,
  onMode,
  save,
  wide,
}: {
  mode: "preview" | "edit";
  onMode: (mode: "preview" | "edit") => void;
  save?: ReactNode;
  wide?: boolean;
}) {
  const tabClass = (selected: boolean) =>
    cn(
      "px-3 py-1 font-display text-[11px] font-semibold uppercase tracking-[0.14em]",
      wide && "flex-1",
      selected ? "bg-accent text-foreground" : "text-muted-foreground",
    );
  return (
    <div className={cn("flex shrink-0 items-center gap-2", wide && "w-full")}>
      <div
        className={cn(
          "inline-flex overflow-hidden rounded-md border border-border",
          wide && "min-w-0 flex-1",
        )}
      >
        <button
          type="button"
          className={tabClass(mode === "preview")}
          aria-pressed={mode === "preview"}
          data-testid="export-draft-preview"
          onClick={() => onMode("preview")}
        >
          Preview
        </button>
        <button
          type="button"
          className={cn(tabClass(mode === "edit"), "border-l border-border")}
          aria-pressed={mode === "edit"}
          data-testid="export-draft-edit"
          onClick={() => onMode("edit")}
        >
          Edit
        </button>
      </div>
      {save}
    </div>
  );
}

function DraftReader({
  issueId,
  name,
  issues,
  result,
  mode,
  onMode,
  editText,
  onEditText,
  pending,
  onSave,
  back,
}: {
  issueId: string;
  name: string;
  issues: readonly Issue[];
  result: UseQueryResult<string, Error> | undefined;
  mode: "preview" | "edit";
  onMode: (mode: "preview" | "edit") => void;
  editText: string;
  onEditText: (text: string) => void;
  pending: boolean;
  onSave: () => void;
  back?: ReactNode;
}) {
  const id = exportDraftIssueId(name);
  const match = id ? issues.find((issue) => issue.id === id) : undefined;
  const kind = exportDraftKindLabel(match?.kind);
  const title = draftTitle(name, result?.data, issues);
  const saveButton =
    mode === "edit" ? (
      <Button
        type="button"
        size="sm"
        disabled={pending || !result?.isSuccess}
        data-testid="export-draft-save"
        onClick={onSave}
      >
        <Save />
        {pending ? "Saving…" : "Save"}
      </Button>
    ) : null;

  return (
    <section
      className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-border bg-card"
      data-testid="export-draft-reader"
      data-mode={mode}
    >
      <header className="flex shrink-0 flex-col gap-2 border-b border-border px-3 py-2">
        <div className={cn("flex gap-3", back ? "flex-col" : "items-start justify-between")}>
          <div className="min-w-0">
            {back ? <div className="mb-2">{back}</div> : null}
            <div className="flex items-center gap-2">
              <h2 className="truncate text-sm font-medium">{title}</h2>
              {kind ? (
                <Badge variant={kind === "Epic" ? "current" : "todo"}>{kind}</Badge>
              ) : null}
            </div>
            <p className="truncate font-mono text-xs text-muted-foreground">{name}</p>
          </div>
          <ViewToggle mode={mode} onMode={onMode} save={saveButton} wide={Boolean(back)} />
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {result?.isError ? (
          <ShellInlineFault
            message={result.error?.message ?? "Could not load this draft."}
            hint="Check the server, then reload."
          />
        ) : !result?.isSuccess ? (
          <ShellLoadingState label="Loading draft…" />
        ) : mode === "preview" ? (
          <div data-testid="export-draft-preview-body">
            <Markdown issueId={issueId}>{exportDraftBody(result.data)}</Markdown>
          </div>
        ) : (
          <Textarea
            value={editText}
            onChange={(event) => onEditText(event.target.value)}
            className="min-h-64 font-mono text-sm"
            data-testid="export-draft-editor"
            aria-label={`Edit ${name}`}
          />
        )}
      </div>
    </section>
  );
}

/**
 * Export tab once any reserved draft exists. Desktop: run strip, tracker-order
 * list, and the selected draft. Phone: Transcript and Drafts inside this tab.
 */
export function ExportReviewWorkbench({
  issue,
  session,
  transcript,
}: {
  issue: IssueDetail;
  session: ChannelSessionListItem | undefined;
  transcript: ReactNode;
}) {
  const isMobile = useIsMobile();
  const attachments = useAttachmentsQuery(issue.id);
  const issuesQuery = useIssuesQuery();
  const issues = issuesQuery.data?.issues ?? EMPTY_ISSUES;
  const names = useMemo(
    () => (attachments.data ?? []).map((item) => item.name).filter(isExportDraftName),
    [attachments.data],
  );
  const ordered = useMemo(
    () =>
      orderExportDraftNames(
        { id: issue.id, kind: issue.kind },
        issues.map(toOrderIssue),
        names,
      ),
    [issue.id, issue.kind, issues, names],
  );
  const texts = useExportDraftTexts(issue.id, ordered);
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [mode, setMode] = useState<"preview" | "edit">("preview");
  const [phonePane, setPhonePane] = useState<"transcript" | "drafts">("drafts");
  const [phoneOpen, setPhoneOpen] = useState(false);
  const [editBuffer, setEditBuffer] = useState<{ name: string; text: string } | null>(
    null,
  );
  const save = useOverwriteExportDraft(issue.id);
  const selected = ordered.includes(selectedName ?? "")
    ? (selectedName as string)
    : ordered[0];
  const selectedIndex = selected ? ordered.indexOf(selected) : -1;
  const selectedResult = selectedIndex >= 0 ? texts[selectedIndex] : undefined;
  const editText =
    editBuffer?.name === selected
      ? editBuffer.text
      : (selectedResult?.data ?? "");

  const selectDraft = (name: string) => {
    setSelectedName(name);
    setMode("preview");
    if (isMobile) {
      setPhonePane("drafts");
      setPhoneOpen(true);
    }
  };

  const onSave = () => {
    if (!selected || !selectedResult?.isSuccess) return;
    save.mutate({ name: selected, content: editText });
  };

  if (attachments.isLoading && attachments.data === undefined) {
    return <ShellLoadingState label="Loading export…" />;
  }
  if (attachments.isError && !attachments.data) {
    return (
      <ShellInlineFault
        message={attachments.error?.message ?? "Could not load drafts."}
        hint="Check the server, then reload."
      />
    );
  }
  if (!selected) return <>{transcript}</>;

  const reader = (
    <DraftReader
      issueId={issue.id}
      name={selected}
      issues={issues}
      result={selectedResult}
      mode={mode}
      onMode={setMode}
      editText={editText}
      onEditText={(text) => setEditBuffer({ name: selected, text })}
      pending={save.isPending}
      onSave={onSave}
      back={
        isMobile ? (
          <button
            type="button"
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
            data-testid="export-draft-back"
            onClick={() => setPhoneOpen(false)}
          >
            <ArrowLeft className="h-4 w-4" />
            Drafts
          </button>
        ) : undefined
      }
    />
  );

  const list = (
    <DraftList
      ordered={ordered}
      texts={texts}
      issues={issues}
      selected={selected}
      onSelect={selectDraft}
    />
  );

  return (
    <div
      className={cn(
        "flex min-h-0 flex-1 flex-col gap-3",
        isMobile ? "overflow-y-auto" : "overflow-hidden",
      )}
      data-testid="export-review-workbench"
    >
      {isMobile ? (
        <div
          role="tablist"
          aria-label="Export"
          className="flex shrink-0 gap-1 border-b border-border"
          data-testid="export-phone-modes"
        >
          {(
            [
              ["transcript", "Transcript"],
              ["drafts", "Drafts"],
            ] as const
          ).map(([key, label]) => {
            const pressed = phonePane === key;
            return (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={pressed}
                data-testid={`export-phone-${key}`}
                className={cn(
                  "-mb-px border-b-2 px-3 py-2 font-display text-[11px] font-semibold uppercase tracking-[0.14em]",
                  pressed
                    ? "border-[hsl(var(--current))] text-foreground"
                    : "border-transparent text-muted-foreground",
                )}
                onClick={() => {
                  setPhonePane(key);
                  if (key === "drafts") setPhoneOpen(false);
                }}
              >
                {label}
              </button>
            );
          })}
        </div>
      ) : (
        <RunStrip session={session} draftCount={ordered.length} />
      )}

      {isMobile ? (
        phonePane === "transcript" ? (
          transcript
        ) : phoneOpen ? (
          reader
        ) : (
          list
        )
      ) : (
        <div className="grid min-h-0 flex-1 grid-cols-[minmax(16rem,22rem)_minmax(0,1fr)] gap-3">
          {list}
          {reader}
        </div>
      )}
    </div>
  );
}
