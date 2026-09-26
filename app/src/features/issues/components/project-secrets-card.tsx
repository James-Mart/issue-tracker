import { useId, useState } from "react";
import { KeyRound, Plus } from "lucide-react";
import { SECRET_KEY_RE } from "@server/issue-constants";
import type { IssueDetail } from "@server/schemas";
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
import { useDeleteProjectSecret, useSetProjectSecret } from "../api/mutations";
import { useProjectSecretKeys } from "../api/queries";
import { SETTINGS_HEADING_CLASS, SettingsCard } from "./detail-section";

const INTRO =
  "Write-only environment variables injected during verification. Agents see key names only — never stored values.";

type Draft =
  | { mode: "add"; key: string; value: string }
  | { mode: "replace"; key: string; value: string };

function secretKeyError(key: string): string | null {
  if (SECRET_KEY_RE.test(key)) return null;
  return `invalid secret key "${key}" (expected ^[A-Z_][A-Z0-9_]*$)`;
}

function SecretValueForm({
  draft,
  error,
  pending,
  onChange,
  onCancel,
  onSubmit,
}: {
  draft: Draft;
  error: string | null;
  pending: boolean;
  onChange: (draft: Draft) => void;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  const fieldId = useId();
  const replacing = draft.mode === "replace";

  return (
    <form
      className="flex flex-col gap-3 rounded-md border border-border p-3"
      data-testid={replacing ? "secret-replace-form" : "secret-add-form"}
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <p className={SETTINGS_HEADING_CLASS}>
        {replacing ? "Replace secret" : "Add secret"}
      </p>
      {replacing ? (
        <p className="flex min-w-0 items-center gap-2 font-mono text-xs">
          <KeyRound className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate">{draft.key}</span>
        </p>
      ) : (
        <div className="grid gap-1.5">
          <Label htmlFor={`${fieldId}-key`}>New key name</Label>
          <Input
            id={`${fieldId}-key`}
            data-testid="secret-key"
            value={draft.key}
            autoFocus
            className="font-mono"
            placeholder="STRIPE_SANDBOX_KEY"
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            onChange={(event) =>
              onChange({ ...draft, key: event.target.value })
            }
          />
        </div>
      )}
      <div className="grid gap-1.5">
        <Label htmlFor={`${fieldId}-value`}>
          {replacing ? "New value" : "Value"}
        </Label>
        <Input
          id={`${fieldId}-value`}
          data-testid="secret-value"
          type="password"
          value={draft.value}
          autoFocus={replacing}
          autoComplete="new-password"
          spellCheck={false}
          placeholder={replacing ? "Enter replacement" : "sk_test_…"}
          onChange={(event) =>
            onChange({ ...draft, value: event.target.value })
          }
        />
        <p className="text-xs text-muted-foreground">
          {replacing
            ? "The current value is not displayed. Saving overwrites it for future verification runs."
            : "Saved values are never shown again — only the key name remains in settings."}
        </p>
      </div>
      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button
          type="submit"
          variant="primary"
          size="sm"
          disabled={pending}
          data-testid="secret-save"
        >
          {replacing ? "Save replacement" : "Save secret"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={pending}
          onClick={onCancel}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}

/**
 * Write-only Project secrets. The card lists key names; a value exists only
 * in the open add/replace form and is cleared when that form closes.
 */
export function ProjectSecretsCard({
  issue,
}: {
  issue: Extract<IssueDetail, { kind: "project" }>;
}) {
  const secrets = useProjectSecretKeys(issue.id);
  const setSecret = useSetProjectSecret(issue.id);
  const removeSecret = useDeleteProjectSecret(issue.id);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingRemove, setPendingRemove] = useState<string | null>(null);

  const keys = secrets.data?.keys ?? [];
  const showEmpty =
    secrets.isSuccess && keys.length === 0 && draft?.mode !== "add";

  const closeDraft = () => {
    setDraft(null);
    setError(null);
  };

  const save = async () => {
    if (!draft) return;
    const invalid = secretKeyError(draft.key);
    if (invalid) {
      setError(invalid);
      return;
    }
    if (draft.value.length === 0) {
      setError("Enter a value.");
      return;
    }
    setError(null);
    try {
      await setSecret.mutateAsync({ key: draft.key, value: draft.value });
      closeDraft();
    } catch {
      // The mutation toasts the server message. Keep the form so the
      // value can be corrected; it is still cleared from the mutation cache.
    }
  };

  const confirmRemove = async () => {
    if (!pendingRemove) return;
    try {
      await removeSecret.mutateAsync(pendingRemove);
      if (draft?.mode === "replace" && draft.key === pendingRemove) closeDraft();
      setPendingRemove(null);
    } catch {
      // Toast already surfaced the failure; leave the confirm open.
    }
  };

  return (
    <SettingsCard
      title="Secrets"
      data-testid="secrets-card"
      action={
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={draft !== null}
          onClick={() => {
            setError(null);
            setDraft({ mode: "add", key: "", value: "" });
          }}
        >
          <Plus className="size-3.5" />
          Add secret
        </Button>
      }
    >
      <p className="mb-2.5 text-sm text-muted-foreground">{INTRO}</p>

      {secrets.isError ? (
        <p className="text-sm text-destructive">Could not load secret names.</p>
      ) : null}

      {showEmpty ? (
        <p className="rounded-md border border-dashed border-border px-3 py-3 text-sm text-muted-foreground">
          No secrets yet. Add keys like API tokens the runtime needs during
          verification.
        </p>
      ) : null}

      {keys.length > 0 ? (
        <ul className="flex flex-col">
          {keys.map((key) =>
            draft?.mode === "replace" && draft.key === key ? (
              <li key={key} className="border-t border-border py-2 first:border-t-0">
                <SecretValueForm
                  draft={draft}
                  error={error}
                  pending={setSecret.isPending}
                  onChange={setDraft}
                  onCancel={closeDraft}
                  onSubmit={() => void save()}
                />
              </li>
            ) : (
              <li
                key={key}
                className="flex items-center justify-between gap-2 border-t border-border py-2 first:border-t-0"
                data-testid={`secret-row-${key}`}
              >
                <span className="flex min-w-0 items-center gap-2 font-mono text-xs">
                  <KeyRound className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="truncate">{key}</span>
                </span>
                <span className="flex shrink-0 items-center">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    data-testid={`secret-replace-${key}`}
                    onClick={() => {
                      setError(null);
                      setDraft({ mode: "replace", key, value: "" });
                    }}
                  >
                    Replace
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="text-destructive"
                    data-testid={`secret-remove-${key}`}
                    onClick={() => setPendingRemove(key)}
                  >
                    Remove
                  </Button>
                </span>
              </li>
            ),
          )}
        </ul>
      ) : null}

      {draft?.mode === "add" ? (
        <div className={keys.length > 0 ? "mt-3" : undefined}>
          <SecretValueForm
            draft={draft}
            error={error}
            pending={setSecret.isPending}
            onChange={setDraft}
            onCancel={closeDraft}
            onSubmit={() => void save()}
          />
        </div>
      ) : null}

      <Dialog
        open={pendingRemove !== null}
        onOpenChange={(open) => {
          if (!open && !removeSecret.isPending) setPendingRemove(null);
        }}
      >
        <DialogContent data-testid="secret-remove-dialog">
          <DialogHeader>
            <DialogTitle>Remove secret?</DialogTitle>
            <DialogDescription>
              This deletes the stored value. Later verification runs will not
              receive this variable. The value is not shown.
            </DialogDescription>
          </DialogHeader>
          {pendingRemove ? (
            <code className="block min-w-0 truncate rounded-md border border-border bg-background px-3 py-2 font-mono text-[13px]">
              {pendingRemove}
            </code>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              disabled={removeSecret.isPending}
              onClick={() => setPendingRemove(null)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={removeSecret.isPending}
              data-testid="secret-remove-confirm"
              onClick={() => void confirmRemove()}
            >
              Remove secret
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SettingsCard>
  );
}
