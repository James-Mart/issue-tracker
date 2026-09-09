import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { Mic } from "lucide-react";
import type { IssueDetail } from "@server/schemas";
import { READING_MEASURE_CLASS } from "@/components/page-shell";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils/cn";
import { insertTextAtCaret } from "@/lib/insert-text-at-caret";
import { transcribeAudio } from "@/features/agents/api/client";
import { useTranscriptionCapabilityQuery } from "@/features/agents/api/queries";
import {
  VoiceErrorBar,
  VoiceRecordingBar,
  VoiceTranscribingField,
} from "@/features/agents/components/voice-chrome";
import { useVoiceRecording } from "@/features/agents/hooks/use-voice-recording";
import {
  release,
  tryAcquire,
  useVoiceSessionActiveOwner,
} from "@/features/agents/lib/voice-session-lock";
import { useUpdateIssue } from "../api/mutations";
import { useDescriptionEditorUpload } from "../hooks/use-description-editor-upload";
import type { UploadAttachmentMutation } from "../hooks/use-issue-detail-file-upload";
import { DESCRIPTION_EDITOR_ATTR } from "../lib/attachment-files";
import { supportsAttachments } from "../lib/attachments";
import {
  clearDescriptionDraft,
  readDescriptionDraft,
  writeDescriptionDraft,
} from "../lib/description-draft-storage";
import { transcriptTextForCaret } from "../lib/description-voice-insert";
import { InlineField } from "./inline-field";
import { Markdown } from "./markdown";

const DRAFT_PERSIST_DEBOUNCE_MS = 300;

export function IssueDescriptionField({
  issue,
  upload,
}: {
  issue: IssueDetail;
  upload?: UploadAttachmentMutation;
}) {
  const update = useUpdateIssue();
  const attach = supportsAttachments(issue.kind);
  const [draft, setDraft] = useState(issue.description);
  const [editing, setEditing] = useState(false);
  const setDraftRef = useRef<((next: string) => void) | null>(null);
  const beginEditRef = useRef<(() => void) | null>(null);
  const skipDraftPersistRef = useRef(true);
  const caretPositionRef = useRef<number | null>(null);
  const pendingVoiceStartRef = useRef(false);
  const pendingSelectionRef = useRef<number | null>(null);
  const draftRef = useRef(draft);
  draftRef.current = draft;

  const {
    data: transcriptionCapability,
    isError: transcriptionCapabilityError,
  } = useTranscriptionCapabilityQuery();

  const applyDraft = useCallback((next: string) => {
    setDraft(next);
    setDraftRef.current?.(next);
  }, []);

  const { textareaRef, textareaProps, isUploading } = useDescriptionEditorUpload(
    upload,
    draft,
    applyDraft,
  );

  const onTranscript = useCallback(
    (text: string) => {
      const caret =
        caretPositionRef.current ?? draftRef.current.length;
      const insert = transcriptTextForCaret(draftRef.current, caret, text);
      const inserted = insertTextAtCaret(
        draftRef.current,
        insert,
        caret,
        caret,
      );
      caretPositionRef.current = inserted.selectionStart;
      pendingSelectionRef.current = inserted.selectionStart;
      applyDraft(inserted.value);
    },
    [applyDraft],
  );

  const voice = useVoiceRecording({
    transcribe: transcribeAudio,
    onTranscript,
  });

  const remoteVoiceOwner = useVoiceSessionActiveOwner();
  const peerHoldsVoiceSession =
    remoteVoiceOwner !== null && remoteVoiceOwner !== "description";

  const voiceState = voice.state;
  const showRecordingBar =
    voiceState === "recording" || voiceState === "review";
  const showVoiceError = voiceState === "error";
  const voiceSessionActive = voiceState !== "idle";

  const transcriptionUnavailable =
    transcriptionCapability?.available === false ||
    transcriptionCapabilityError;
  const micUnavailableReason = transcriptionCapabilityError
    ? "Speech model unavailable"
    : transcriptionCapability?.reason;
  const micDisabled =
    transcriptionUnavailable || voiceSessionActive || peerHoldsVoiceSession;

  const saveCaretAndStart = useCallback(() => {
    if (!tryAcquire("description")) return;
    const el = textareaRef.current;
    caretPositionRef.current =
      el && typeof el.selectionStart === "number"
        ? el.selectionStart
        : draftRef.current.length;
    voice.start();
  }, [textareaRef, voice]);

  const handleVoiceStart = useCallback(() => {
    if (micDisabled) return;
    if (!editing) {
      pendingVoiceStartRef.current = true;
      beginEditRef.current?.();
      return;
    }
    saveCaretAndStart();
  }, [editing, micDisabled, saveCaretAndStart]);

  useEffect(() => {
    if (!pendingVoiceStartRef.current || !editing) return;
    pendingVoiceStartRef.current = false;
    const end = draftRef.current.length;
    caretPositionRef.current = end;
    queueMicrotask(() => {
      const el = textareaRef.current;
      if (el) {
        el.focus();
        el.setSelectionRange(end, end);
      }
      if (!tryAcquire("description")) return;
      voice.start();
    });
  }, [editing, textareaRef, voice]);

  const prevVoiceStateRef = useRef(voiceState);
  useEffect(() => {
    const prev = prevVoiceStateRef.current;
    prevVoiceStateRef.current = voiceState;
    if (prev !== "idle" && voiceState === "idle") {
      release("description");
    }
  }, [voiceState]);

  useEffect(() => {
    return () => {
      release("description");
    };
  }, []);

  const resolveEditDraft = useCallback(
    (saved: string) => {
      skipDraftPersistRef.current = true;
      const stored = readDescriptionDraft(issue.id);
      if (stored === "") return saved;
      if (stored === saved) {
        clearDescriptionDraft(issue.id);
        return saved;
      }
      return stored;
    },
    [issue.id],
  );

  const onEditCancel = useCallback(() => {
    clearDescriptionDraft(issue.id);
  }, [issue.id]);

  const beforeKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key !== "Escape" || voiceState === "idle") return false;
      e.preventDefault();
      voice.cancel();
      return true;
    },
    [voice, voiceState],
  );

  useEffect(() => {
    if (!editing || pendingSelectionRef.current === null) return;
    const selection = pendingSelectionRef.current;
    pendingSelectionRef.current = null;
    const el = textareaRef.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(selection, selection);
  }, [draft, editing, textareaRef]);

  useEffect(() => {
    if (!editing) return;
    if (skipDraftPersistRef.current) {
      skipDraftPersistRef.current = false;
      return;
    }
    const handle = window.setTimeout(() => {
      writeDescriptionDraft(issue.id, draft, issue.description);
    }, DRAFT_PERSIST_DEBOUNCE_MS);
    return () => window.clearTimeout(handle);
  }, [issue.id, issue.description, draft, editing]);

  return (
    <section className="rounded-lg border border-border bg-card p-5">
      <div className={cn("mb-3 min-w-0", READING_MEASURE_CLASS)}>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <p className="font-display text-[11px] font-semibold uppercase tracking-[0.22em] text-[hsl(var(--current))]">
            Description
          </p>
          {showRecordingBar ? (
            <VoiceRecordingBar
              elapsedSeconds={voice.elapsedSeconds}
              live={voiceState === "recording"}
              onDiscard={voice.cancel}
              onConfirm={voice.confirm}
            />
          ) : showVoiceError ? (
            <VoiceErrorBar
              reason={voice.errorReason ?? "Something went wrong"}
              onRetry={voice.retry}
            />
          ) : voiceState === "transcribing" ? (
            <VoiceTranscribingField />
          ) : (
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="h-9 w-9 shrink-0 bg-[hsl(var(--panel))] hover:border-[hsl(var(--rail-lit))]"
              title={
                transcriptionUnavailable && micUnavailableReason
                  ? micUnavailableReason
                  : "Dictate description"
              }
              aria-label="Dictate description"
              disabled={micDisabled}
              data-testid="voice-mic-button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={handleVoiceStart}
            >
              <Mic className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>
      <div className={cn("min-w-0", READING_MEASURE_CLASS)}>
        <InlineField
          value={issue.description}
          issue={issue}
          multiline
          richDisplay
          inputClassName="min-h-[280px] text-[13px] leading-relaxed"
          textareaRef={textareaRef}
          textareaProps={textareaProps}
          textareaAttrs={{ [DESCRIPTION_EDITOR_ATTR]: "" }}
          shouldDeferBlurCommit={() => isUploading || voiceSessionActive}
          beforeKeyDown={beforeKeyDown}
          beginEditRef={beginEditRef}
          onDraftChange={setDraft}
          setDraftRef={setDraftRef}
          resolveEditDraft={resolveEditDraft}
          onEditCancel={onEditCancel}
          onEditingChange={setEditing}
          onSave={async (next) => {
            if (next === issue.description) return;
            await update.mutateAsync({
              id: issue.id,
              patch: { description: next },
            });
            clearDescriptionDraft(issue.id);
          }}
          renderDisplayContent={(value) =>
            value.trim() ? (
              <Markdown issueId={attach ? issue.id : undefined}>{value}</Markdown>
            ) : (
              <p className="text-[15px] leading-[1.55] text-muted-foreground">
                Add a description.
              </p>
            )
          }
        />
      </div>
    </section>
  );
}
