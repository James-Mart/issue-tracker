import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowRight, GitCompare, Pencil } from "lucide-react";
import { PatchDiff } from "@pierre/diffs/react";
import type { IssueDetail } from "@server/schemas";
import { ShellInlineFault } from "@/app/shell-state";
import { APP_THEME } from "@/lib/theme/theme";
import { READING_MEASURE_CLASS } from "@/components/page-shell";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useUpdateIssue } from "../api/mutations";
import { useOutlineBodyQuery, useOutlineDiffQuery } from "../api/queries";
import { CopyTextButton } from "./copy-text-button";
import { Markdown } from "./markdown";
import { OutlineOpenDraftSentence } from "./outline-review-draft-note";

type OutlineDetail = Extract<IssueDetail, { kind: "outline" }>;

function versionChoices(latest: number): number[] {
  return Array.from({ length: latest }, (_, index) => index + 1);
}

function versionLabel(version: number, latest: number): string {
  return version === latest ? `v${version} · latest` : `v${version}`;
}

function OutlineVersionSelect({
  label,
  value,
  latest,
  testId,
  onChange,
}: {
  label: string;
  value: number;
  latest: number;
  testId: string;
  onChange: (version: number) => void;
}) {
  return (
    <Select value={String(value)} onValueChange={(next) => onChange(Number(next))}>
      <SelectTrigger
        aria-label={label}
        data-testid={testId}
        className="h-8 w-auto min-w-[8.5rem] gap-2 px-2.5 font-mono text-xs tabular-nums"
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {versionChoices(latest).map((version) => (
          <SelectItem key={version} value={String(version)}>
            {versionLabel(version, latest)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function OutlineMarkdown({ body }: { body: string }) {
  return (
    <div className={READING_MEASURE_CLASS} data-testid="outline-body">
      <Markdown>{body}</Markdown>
    </div>
  );
}

function outlineQueryPlaceholder(
  query: { isPending: boolean; error: Error | null },
  pending: string,
  hint: string,
): ReactNode | null {
  if (query.isPending) {
    return (
      <p role="status" className="font-mono text-[11px] text-muted-foreground">
        {pending}
      </p>
    );
  }
  if (query.error) {
    return <ShellInlineFault message={query.error.message} hint={hint} />;
  }
  return null;
}

function outlineQueryData<T>(data: T | undefined, pending: string): T {
  if (data === undefined) {
    throw new Error(`${pending} finished without a payload`);
  }
  return data;
}

function OutlineReadBody({
  id,
  version,
  latest,
  latestBody,
}: {
  id: string;
  version: number;
  latest: number;
  latestBody: string;
}) {
  const query = useOutlineBodyQuery(id, version, version !== latest);
  const placeholder =
    version === latest
      ? null
      : outlineQueryPlaceholder(
          query,
          "Loading version…",
          "Check the version, then reload.",
        );
  if (placeholder) return placeholder;
  const body =
    version === latest
      ? latestBody
      : outlineQueryData(query.data, "Loading version…").body;
  return (
    <>
      <OutlineMarkdown body={body} />
      <div className="mt-4 flex">
        <CopyTextButton
          text={body}
          label="Copy Markdown"
          testId="outline-copy-markdown"
          className="text-muted-foreground"
        />
      </div>
    </>
  );
}

function OutlineVersionDiff({
  id,
  from,
  to,
}: {
  id: string;
  from: number;
  to: number;
}) {
  const query = useOutlineDiffQuery(id, from, to);
  const placeholder = outlineQueryPlaceholder(
    query,
    "Loading diff…",
    "Check the versions, then reload.",
  );
  if (placeholder) return placeholder;
  const data = outlineQueryData(query.data, "Loading diff…");
  if (data.diff === "") {
    return (
      <p className="text-sm text-muted-foreground" data-testid="outline-diff-empty">
        No changes.
      </p>
    );
  }
  return (
    <div
      className="overflow-hidden rounded-lg border border-border"
      data-testid="outline-diff"
    >
      <PatchDiff
        patch={data.diff}
        options={{
          disableFileHeader: true,
          diffStyle: "unified",
          overflow: "wrap",
          themeType: APP_THEME,
        }}
      />
    </div>
  );
}

function OutlineEditSession({
  issue,
  onDone,
}: {
  issue: OutlineDetail;
  onDone: () => void;
}) {
  const nextVersion = issue.bodyVersion + 1;
  const [draft, setDraft] = useState(issue.description);
  const update = useUpdateIssue();
  const fieldRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    fieldRef.current?.focus();
  }, []);

  const save = async () => {
    try {
      await update.mutateAsync({ id: issue.id, patch: { description: draft } });
    } catch {
      // The mutation toasts. Edit stays open so the draft is not dropped.
      return;
    }
    onDone();
  };
  // Identical markdown does not advance the version.
  const unchanged = draft === issue.description;

  return (
    <div className={READING_MEASURE_CLASS}>
      <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2">
        <span
          id="outline-new-version"
          data-testid="outline-new-version"
          className="font-mono text-xs tabular-nums"
        >
          New version v{nextVersion}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            data-testid="outline-edit-cancel"
            disabled={update.isPending}
            onClick={onDone}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="current"
            size="sm"
            data-testid="outline-edit-save"
            disabled={update.isPending || unchanged}
            onClick={save}
          >
            Save as v{nextVersion}
          </Button>
        </div>
      </div>
      <Textarea
        ref={fieldRef}
        value={draft}
        aria-labelledby="outline-new-version"
        data-testid="outline-edit-body"
        spellCheck={false}
        disabled={update.isPending}
        className="min-h-[16rem] font-mono text-sm"
        onChange={(event) => setDraft(event.target.value)}
      />
    </div>
  );
}

export function OutlineBodyCard({
  issue,
  onEditingChange,
}: {
  issue: OutlineDetail;
  onEditingChange: (editing: boolean) => void;
}) {
  const latest = issue.bodyVersion;
  const pendingDraft = issue.pendingDraft;
  const reviewDraftOpen = pendingDraft !== undefined;
  const [mode, setMode] = useState<"read" | "diff" | "edit">("read");
  const [readVersion, setReadVersion] = useState(latest);
  const [diffFrom, setDiffFrom] = useState(Math.max(1, latest - 1));
  const [diffTo, setDiffTo] = useState(latest);
  const latestRef = useRef(latest);
  const onEditingChangeRef = useRef(onEditingChange);
  onEditingChangeRef.current = onEditingChange;

  // A publish while this card is mounted moves the selection that was on the
  // previous latest forward. An older version the reader picked stays put.
  useEffect(() => {
    const previous = latestRef.current;
    if (previous === latest) return;
    setReadVersion((current) => (current === previous ? latest : current));
    setDiffTo((current) => (current === previous ? latest : current));
    setDiffFrom((current) => Math.min(current, Math.max(1, latest - 1)));
    latestRef.current = latest;
  }, [latest]);

  const leaveEdit = useCallback(() => {
    setMode("read");
    onEditingChangeRef.current(false);
  }, []);

  const enterEdit = useCallback(() => {
    setMode("edit");
    onEditingChangeRef.current(true);
  }, []);

  // A review draft refuses the body save, so an edit already open cannot stay.
  useEffect(() => {
    if (!reviewDraftOpen || mode !== "edit") return;
    leaveEdit();
  }, [reviewDraftOpen, mode, leaveEdit]);

  // Navigation unmounts the card without Cancel or Save.
  useEffect(() => {
    return () => onEditingChangeRef.current(false);
  }, []);

  return (
    <section
      className="rounded-lg border border-border bg-card p-5"
      data-testid="outline-body-card"
    >
      <p className="mb-3 font-display text-[11px] font-semibold uppercase tracking-[0.22em] text-[hsl(var(--current))]">
        Outline body
      </p>
      {mode === "edit" ? (
        <OutlineEditSession issue={issue} onDone={leaveEdit} />
      ) : (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2">
            <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
              {mode === "read" ? "Version" : "Diff"}
            </span>
            {mode === "read" ? (
              <>
                <OutlineVersionSelect
                  label="Version"
                  value={readVersion}
                  latest={latest}
                  testId="outline-version"
                  onChange={setReadVersion}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  data-testid="outline-compare"
                  onClick={() => {
                    setDiffFrom(Math.max(1, latest - 1));
                    setDiffTo(latest);
                    setMode("diff");
                  }}
                >
                  <GitCompare />
                  Compare versions
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  data-testid="outline-edit"
                  disabled={reviewDraftOpen}
                  aria-describedby={reviewDraftOpen ? "outline-edit-held" : undefined}
                  onClick={enterEdit}
                >
                  <Pencil />
                  Edit
                </Button>
              </>
            ) : (
              <>
                <OutlineVersionSelect
                  label="From version"
                  value={diffFrom}
                  latest={latest}
                  testId="outline-diff-from"
                  onChange={setDiffFrom}
                />
                <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
                <OutlineVersionSelect
                  label="To version"
                  value={diffTo}
                  latest={latest}
                  testId="outline-diff-to"
                  onChange={setDiffTo}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  data-testid="outline-back-to-read"
                  onClick={() => setMode("read")}
                >
                  Back to read
                </Button>
              </>
            )}
          </div>
          {mode === "read" && pendingDraft ? (
            <OutlineOpenDraftSentence
              projectId={issue.partOf}
              reviewId={pendingDraft.review}
              lead="Edit is held for an open draft from"
              testId="outline-edit-held"
              id="outline-edit-held"
              className="mb-4 text-sm text-muted-foreground"
            />
          ) : null}
          {mode === "read" ? (
            <OutlineReadBody
              id={issue.id}
              version={readVersion}
              latest={latest}
              latestBody={issue.description}
            />
          ) : (
            <OutlineVersionDiff id={issue.id} from={diffFrom} to={diffTo} />
          )}
        </>
      )}
    </section>
  );
}
