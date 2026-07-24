import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { IssueDetail } from "@server/schemas";
import { useExternalEditConflict } from "./use-external-edit-conflict";

export interface InlineEditSessionOptions {
  value: string;
  issue: IssueDetail;
  onSave: (next: string) => Promise<void>;
  validate?: (next: string) => string | null;
  multiline?: boolean;
}

export interface InlineEditSession {
  editing: boolean;
  draft: string;
  error: string | null;
  saving: boolean;
  hasConflict: boolean;
  beginEdit: () => void;
  setDraft: (next: string) => void;
  commit: () => Promise<void>;
  cancel: () => void;
  reload: () => void;
  acknowledge: () => void;
  onKeyDown: (e: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => void;
  onBlur: () => void;
}

export function useInlineEditSession({
  value,
  issue,
  onSave,
  validate,
  multiline = false,
}: InlineEditSessionOptions): InlineEditSession {
  const [editing, setEditing] = useState(false);
  const [draft, setDraftState] = useState(value);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const skipBlurCommit = useRef(false);
  const sessionRef = useRef(0);
  const draftRef = useRef(draft);

  const setDraft = (next: string) => {
    draftRef.current = next;
    setDraftState(next);
  };
  const valueRef = useRef(value);
  const savingRef = useRef(saving);
  const editingRef = useRef(editing);
  const onSaveRef = useRef(onSave);
  const validateRef = useRef(validate);
  const multilineRef = useRef(multiline);
  const { hasConflict, acknowledge } = useExternalEditConflict(issue, editing);
  const hasConflictRef = useRef(hasConflict);

  draftRef.current = draft;
  valueRef.current = value;
  savingRef.current = saving;
  editingRef.current = editing;
  onSaveRef.current = onSave;
  validateRef.current = validate;
  multilineRef.current = multiline;
  hasConflictRef.current = hasConflict;

  useEffect(() => {
    if (!editing) {
      draftRef.current = value;
      setDraftState(value);
      setError(null);
    }
  }, [value, editing]);

  const exit = () => {
    editingRef.current = false;
    setEditing(false);
    draftRef.current = valueRef.current;
    setDraftState(valueRef.current);
    setError(null);
  };

  const cancel = () => {
    skipBlurCommit.current = true;
    sessionRef.current += 1;
    exit();
  };

  const reload = () => {
    setDraft(valueRef.current);
    setError(null);
    acknowledge();
  };

  const beginEdit = () => {
    skipBlurCommit.current = false;
    sessionRef.current += 1;
    editingRef.current = true;
    setDraft(valueRef.current);
    setError(null);
    setEditing(true);
  };

  const commit = async () => {
    if (savingRef.current || hasConflictRef.current) return;

    const next = draftRef.current;
    const validationError = validateRef.current?.(next) ?? null;
    if (validationError) {
      setError(validationError);
      return;
    }

    if (next === valueRef.current) {
      exit();
      return;
    }

    const session = sessionRef.current;
    savingRef.current = true;
    setSaving(true);
    setError(null);
    try {
      await onSaveRef.current(next);
      if (session !== sessionRef.current) return;
      editingRef.current = false;
      setEditing(false);
      setError(null);
    } catch (err) {
      if (session !== sessionRef.current) return;
      setError(err instanceof Error ? err.message : "Request failed");
    } finally {
      if (session === sessionRef.current) {
        savingRef.current = false;
        setSaving(false);
      }
    }
  };

  const onKeyDown = (
    e: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) => {
    if (e.key === "Escape") {
      e.preventDefault();
      cancel();
      return;
    }
    if (e.key === "Enter" && !multilineRef.current) {
      e.preventDefault();
      void commit();
    }
  };

  const onBlur = () => {
    const session = sessionRef.current;
    window.setTimeout(() => {
      if (session !== sessionRef.current) return;
      if (skipBlurCommit.current) {
        skipBlurCommit.current = false;
        return;
      }
      if (!editingRef.current) return;
      void commit();
    }, 0);
  };

  return {
    editing,
    draft,
    error,
    saving,
    hasConflict,
    beginEdit,
    setDraft,
    commit,
    cancel,
    reload,
    acknowledge,
    onKeyDown,
    onBlur,
  };
}
