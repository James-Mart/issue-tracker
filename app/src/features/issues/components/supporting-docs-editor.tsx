import { useRef } from "react";
import { FIELD_LABELS } from "@server/fields";
import {
  SUPPORTING_DOC_KEYS,
  type SupportingDocKey,
} from "@server/schemas";
import type { Attachment } from "@server/services/attachments";
import { ShellInlineFault } from "@/app/shell-state";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils/cn";
import { useAttachmentsQuery } from "../api/queries";
import {
  SUPPORTING_DOC_KEY_LABELS,
  supportingDocDraftForMode,
  type SupportingDocDraft,
  type SupportingDocMode,
  type SupportingDocsDraft,
} from "../lib/supporting-docs";
import { SETTINGS_HEADING_CLASS, SettingsCard } from "./detail-section";

/** Doc · Source · Target, shared by the heading row and each doc row. */
const DOC_ROW_CLASS =
  "grid grid-cols-1 gap-x-3 gap-y-1.5 sm:grid-cols-[minmax(6rem,9rem)_9rem_minmax(0,1fr)] sm:items-center sm:gap-y-0";

function DocTarget({
  label,
  draft,
  attachments,
  attachmentsLoading,
  disabled,
  onChange,
  onCommit,
}: {
  label: string;
  draft: SupportingDocDraft;
  attachments: Attachment[];
  attachmentsLoading: boolean;
  disabled?: boolean;
  onChange: (draft: SupportingDocDraft) => void;
  onCommit: (draft: SupportingDocDraft) => void;
}) {
  if (draft.mode === "absent") {
    return <p className="text-sm text-muted-foreground">Not linked</p>;
  }

  if (draft.mode === "workspace") {
    return (
      <Input
        value={draft.path}
        disabled={disabled}
        onChange={(e) => onChange({ mode: "workspace", path: e.target.value })}
        onBlur={(e) => onCommit({ mode: "workspace", path: e.target.value })}
        className="h-8 font-mono text-[13px]"
        placeholder="relative/path.md"
        spellCheck={false}
        aria-label={`${label} workspace path`}
      />
    );
  }

  if (attachmentsLoading) {
    return (
      <p className="font-mono text-[11px] text-muted-foreground">
        Loading attachments…
      </p>
    );
  }

  if (attachments.length === 0) {
    return (
      <div className="flex flex-col gap-1">
        <Input
          value={draft.name}
          disabled={disabled}
          onChange={(e) => onChange({ mode: "attachment", name: e.target.value })}
          onBlur={(e) => onCommit({ mode: "attachment", name: e.target.value })}
          className="h-8 font-mono text-[13px]"
          placeholder="attachment basename"
          spellCheck={false}
          aria-label={`${label} attachment`}
        />
        <p className="text-xs text-muted-foreground">
          No attachments yet. Upload one first, or type a basename.
        </p>
      </div>
    );
  }

  return (
    <Select
      value={draft.name || undefined}
      disabled={disabled}
      onValueChange={(name) => {
        const next: SupportingDocDraft = { mode: "attachment", name };
        onChange(next);
        onCommit(next);
      }}
    >
      <SelectTrigger className="h-8 font-mono text-[13px]" aria-label={`${label} attachment`}>
        <SelectValue placeholder="Select attachment" />
      </SelectTrigger>
      <SelectContent>
        {attachments.map((item) => (
          <SelectItem key={item.name} value={item.name}>
            {item.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function DocRow({
  docKey,
  draft,
  attachments,
  attachmentsLoading,
  disabled,
  onChange,
  onCommit,
}: {
  docKey: SupportingDocKey;
  draft: SupportingDocDraft;
  attachments: Attachment[];
  attachmentsLoading: boolean;
  disabled?: boolean;
  onChange: (draft: SupportingDocDraft) => void;
  onCommit: (draft: SupportingDocDraft) => void;
}) {
  const label = SUPPORTING_DOC_KEY_LABELS[docKey];

  return (
    <li className={cn(DOC_ROW_CLASS, "border-t border-border py-2")}>
      <span className="text-sm text-foreground">{label}</span>
      <Select
        value={draft.mode}
        disabled={disabled}
        onValueChange={(value) => {
          const next = supportingDocDraftForMode(value as SupportingDocMode);
          onChange(next);
          onCommit(next);
        }}
      >
        <SelectTrigger className="h-8 text-[13px]" aria-label={`${label} source`}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="absent">Absent</SelectItem>
          <SelectItem value="attachment">Attachment</SelectItem>
          <SelectItem value="workspace">Workspace path</SelectItem>
        </SelectContent>
      </Select>
      <DocTarget
        label={label}
        draft={draft}
        attachments={attachments}
        attachmentsLoading={attachmentsLoading}
        disabled={disabled}
        onChange={onChange}
        onCommit={onCommit}
      />
    </li>
  );
}

export function SupportingDocsEditor({
  issueId,
  draft,
  onChange,
  onCommit,
  disabled,
  error,
}: {
  issueId: string;
  draft: SupportingDocsDraft;
  onChange: (draft: SupportingDocsDraft) => void;
  /** Persist after mode/attachment select or path blur. */
  onCommit: (draft: SupportingDocsDraft) => void;
  disabled?: boolean;
  error?: string | null;
}) {
  const { data, isLoading, error: loadError } = useAttachmentsQuery(issueId);
  const attachments = data ?? [];
  const draftRef = useRef(draft);
  draftRef.current = draft;

  return (
    <SettingsCard title={FIELD_LABELS.supportingDocs}>
      {loadError ? (
        <ShellInlineFault
          className="mb-2"
          message={loadError.message}
          hint="Check the server, then retry the attachments list."
        />
      ) : null}
      {error ? (
        <ShellInlineFault
          className="mb-2"
          message={error}
          hint="Fix the pointer, then save again."
        />
      ) : null}

      <div className={cn(DOC_ROW_CLASS, "hidden pb-1 sm:grid")} aria-hidden="true">
        <span className={SETTINGS_HEADING_CLASS}>Doc</span>
        <span className={SETTINGS_HEADING_CLASS}>Source</span>
        <span className={SETTINGS_HEADING_CLASS}>Target</span>
      </div>

      <ul className="flex flex-col">
        {SUPPORTING_DOC_KEYS.map((key) => (
          <DocRow
            key={key}
            docKey={key}
            draft={draft[key]}
            attachments={attachments}
            attachmentsLoading={isLoading}
            disabled={disabled}
            onChange={(next) => {
              const updated = { ...draftRef.current, [key]: next };
              draftRef.current = updated;
              onChange(updated);
            }}
            onCommit={(next) => {
              const updated = { ...draftRef.current, [key]: next };
              draftRef.current = updated;
              onCommit(updated);
            }}
          />
        ))}
      </ul>
    </SettingsCard>
  );
}
