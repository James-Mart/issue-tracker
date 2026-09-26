import { FIELD_LABELS } from "@server/fields";
import {
  RUNTIME_PHASE_KEYS,
  type RuntimePhaseKey,
} from "@server/issue-constants";
import type { IssueDetail, IssuePatch, Runtime } from "@server/schemas";
import { useProjectSecretKeys } from "../api/queries";
import { useUpdateIssue } from "../api/mutations";
import { SETTINGS_HEADING_CLASS, SettingsCard } from "./detail-section";
import { InlineField } from "./inline-field";
import { MetaRow } from "./meta-row";

const SETTINGS_ROW_CLASS = "min-w-0 grid-cols-[7rem_minmax(0,1fr)]";

const PHASE_COPY: Record<RuntimePhaseKey, { label: string; helper: string }> = {
  build: {
    label: "Build",
    helper: "Compile before start.",
  },
  start: {
    label: "Start",
    helper: "Launch the long-running process. The harness owns it and stops it.",
  },
  readiness: {
    label: "Readiness",
    helper: "Exits 0 when the runtime is ready. Retried until it passes.",
  },
  seed: {
    label: "Seed",
    helper:
      "One-time initialization of a fresh data directory, such as boot, migrations, or fixtures.",
  },
  redeploy: {
    label: "Redeploy",
    helper:
      "Push rebuilt changes into the running instance. Empty when the runtime hot-reloads.",
  },
  baseUrl: {
    label: "Base URL",
    helper:
      "Template for where agents and the browser reach the runtime. Its subdomains are allowed.",
  },
};

export const RUNTIME_PHASE_FIELDS = RUNTIME_PHASE_KEYS.map((key) => ({
  key,
  ...PHASE_COPY[key],
}));

/** Names every phase receives, from the runtime declaration story. */
export const RUNTIME_ENV_VARS = [
  {
    name: "AGENT_STACK_PORT",
    detail: "Primary port; the base URL points at it.",
  },
  {
    name: "AGENT_STACK_AUX_PORT",
    detail: "A second free port, for a backend behind the primary one.",
  },
  {
    name: "AGENT_STACK_DATA_DIR",
    detail:
      "This stack's own data directory, created on start and removed on stop.",
  },
  {
    name: "AGENT_STACK_BASE_URL",
    detail:
      "baseUrl with the variables substituted; available to readiness, seed, and redeploy, not to start or to baseUrl itself.",
  },
] as const;

function runtimePatch(
  current: Runtime | undefined,
  key: RuntimePhaseKey,
  next: string,
): IssuePatch | null {
  const trimmed = next.trim();
  const stored = current?.[key] ?? "";
  if (trimmed === stored) return null;
  const merged: Runtime = { ...(current ?? {}) };
  if (trimmed === "") delete merged[key];
  else merged[key] = trimmed;
  return {
    runtime: Object.keys(merged).length === 0 ? null : merged,
  };
}

function RuntimePhaseField({
  issue,
  phase,
  label,
  helper,
}: {
  issue: Extract<IssueDetail, { kind: "project" }>;
  phase: RuntimePhaseKey;
  label: string;
  helper: string;
}) {
  const update = useUpdateIssue();
  const stored = issue.runtime?.[phase] ?? "";

  return (
    <MetaRow
      className={SETTINGS_ROW_CLASS}
      label={label}
      value={
        <div className="flex flex-col gap-0.5">
          <InlineField
            value={stored}
            issue={issue}
            emptyLabel={helper}
            placeholder={helper}
            multiline
            displayClassName={
              stored.trim()
                ? "max-w-full whitespace-pre-wrap break-all font-mono"
                : "max-w-full"
            }
            inputClassName="min-h-16 font-mono"
            onSave={async (next) => {
              const patch = runtimePatch(issue.runtime, phase, next);
              if (!patch) return;
              await update.mutateAsync({ id: issue.id, patch });
            }}
          />
          {stored.trim() ? (
            <p className="text-xs text-muted-foreground">{helper}</p>
          ) : null}
        </div>
      }
    />
  );
}

export function ProjectRuntimeCard({
  issue,
}: {
  issue: Extract<IssueDetail, { kind: "project" }>;
}) {
  const secrets = useProjectSecretKeys(issue.id);
  const secretKeys = secrets.data?.keys ?? [];

  return (
    <SettingsCard title={FIELD_LABELS.runtime}>
      <div className="flex min-w-0 flex-col gap-1.5">
        {RUNTIME_PHASE_FIELDS.map((phase) => (
          <RuntimePhaseField
            key={phase.key}
            issue={issue}
            phase={phase.key}
            label={phase.label}
            helper={phase.helper}
          />
        ))}
      </div>
      <div className="mt-3 flex flex-col gap-1.5 border-t border-border pt-3">
        <p className={SETTINGS_HEADING_CLASS}>Environment</p>
        <ul className="flex flex-col gap-1.5">
          {RUNTIME_ENV_VARS.map((variable) => (
            <li key={variable.name} className="min-w-0 text-sm">
              <span className="font-mono text-xs">{variable.name}</span>
              <span className="mt-0.5 block text-xs text-muted-foreground">
                {variable.detail}
              </span>
            </li>
          ))}
          {secretKeys.map((key) => (
            <li key={`secret:${key}`} className="font-mono text-xs">
              {key}
            </li>
          ))}
        </ul>
        {secrets.isError ? (
          <p className="text-sm text-destructive">Could not load secret names.</p>
        ) : null}
      </div>
    </SettingsCard>
  );
}
