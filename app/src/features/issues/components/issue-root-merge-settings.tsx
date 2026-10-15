import { FIELD_LABELS, MERGE_POLICY_LABELS } from "@server/fields";
import { isArchived } from "@server/services/archived-visibility";
import type {
  DerivedState,
  IssueDetail,
  IssueRecord,
  MergePolicy,
  MergeSettingsLock,
} from "@server/schemas";
import { useUpdateIssue } from "../api/mutations";
import { useIssuePatchAction } from "../hooks/use-issue-patch-action";
import { useIssuesWithArchived } from "../hooks/use-issues-with-archived";
import { InlineField } from "./inline-field";
import { MergePolicySelect } from "./merge-policy-select";
import { MetaRow } from "./meta-row";

/** Label beside the value on wide viewports; stacked, full-width controls below `sm`. */
const ROOT_MERGE_ROW_CLASS =
  "grid-cols-1 gap-y-1 sm:grid-cols-[9rem_minmax(0,1fr)]";

const CONTROL_WIDTH_CLASS = "w-full sm:max-w-[13rem]";

type RootIssue = Extract<IssueDetail, { kind: "epic" | "story" }>;

function trunkPlaceholder(trunk: string): string {
  return `${trunk} (project trunk)`;
}

function inheritOptionLabel(policy: MergePolicy): string {
  return `Inherit (${MERGE_POLICY_LABELS[policy]})`;
}

type IssuesSnapshot = {
  issues: IssueRecord[];
  derived: Record<string, DerivedState>;
};

/**
 * Row inputs for an Epic or project-level root Story. Missing lock or a
 * missing project parent means the rows are not shown.
 */
export function rootMergeSettingsFor(
  issue: RootIssue,
  data: IssuesSnapshot | undefined,
): {
  trunk: string;
  inheritedPolicy: MergePolicy;
  lock: MergeSettingsLock;
} | null {
  const lock = data?.derived[issue.id]?.mergeSettingsLock;
  if (!data || !lock) return null;
  const parent = data.issues.find((item) => item.id === issue.partOf);
  if (parent?.kind !== "project") return null;
  return { trunk: parent.trunk, inheritedPolicy: parent.mergePolicy, lock };
}

function MergeBaseControl({
  issue,
  placeholder,
  locked,
}: {
  issue: RootIssue;
  placeholder: string;
  locked: boolean;
}) {
  const update = useUpdateIssue();

  if (locked) {
    const override = issue.mergeBaseOverride ?? "";
    const empty = override.trim() === "";
    return (
      <span
        className={
          empty
            ? "font-mono text-[13px] tabular-nums text-muted-foreground"
            : "font-mono text-[13px] tabular-nums"
        }
      >
        {empty ? placeholder : override}
      </span>
    );
  }

  return (
    <InlineField
      value={issue.mergeBaseOverride ?? ""}
      issue={issue}
      emptyLabel={placeholder}
      placeholder={placeholder}
      displayClassName="font-mono text-[13px] tabular-nums"
      inputClassName="font-mono text-[13px] tabular-nums"
      onSave={async (next) => {
        const trimmed = next.trim();
        const current = issue.mergeBaseOverride ?? "";
        if (trimmed === current) return;
        await update.mutateAsync({
          id: issue.id,
          patch: {
            mergeBaseOverride: trimmed === "" ? null : trimmed,
          },
        });
      }}
    />
  );
}

function MergePolicyControl({
  issue,
  inheritedPolicy,
  locked,
}: {
  issue: RootIssue;
  inheritedPolicy: MergePolicy;
  locked: boolean;
}) {
  const update = useUpdateIssue();
  const { error, saving, run } = useIssuePatchAction();
  const selected = issue.mergePolicy ?? "inherit";

  const onChange = (value: MergePolicy | "inherit") => {
    if (value === selected) return;
    void run(async () => {
      await update.mutateAsync({
        id: issue.id,
        patch: { mergePolicy: value === "inherit" ? null : value },
      });
    });
  };

  return (
    <div className="flex min-w-0 flex-col gap-1" data-testid="merge-policy-field">
      <div className={CONTROL_WIDTH_CLASS}>
        <MergePolicySelect
          value={selected}
          inheritLabel={inheritOptionLabel(inheritedPolicy)}
          disabled={locked || saving}
          onChange={onChange}
        />
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </div>
  );
}

/** Editable merge-base and merge-policy rows for one root issue. */
export function RootMergeSettingsRows({
  issue,
  trunk,
  inheritedPolicy,
  lock,
}: {
  issue: RootIssue;
  trunk: string;
  inheritedPolicy: MergePolicy;
  lock: MergeSettingsLock;
}) {
  const placeholder = trunkPlaceholder(trunk);

  return (
    <>
      <MetaRow
        className={ROOT_MERGE_ROW_CLASS}
        label={FIELD_LABELS.mergeBase}
        value={
          <div className="flex min-w-0 flex-col gap-1" data-testid="merge-base-field">
            <div className={CONTROL_WIDTH_CLASS}>
              <MergeBaseControl
                issue={issue}
                placeholder={placeholder}
                locked={lock.locked}
              />
            </div>
            {lock.locked ? (
              <p
                data-testid="merge-settings-lock-reason"
                className="text-sm text-muted-foreground"
              >
                {lock.reason}
              </p>
            ) : null}
          </div>
        }
      />
      <MetaRow
        className={ROOT_MERGE_ROW_CLASS}
        label={FIELD_LABELS.mergePolicy}
        value={
          <MergePolicyControl
            issue={issue}
            inheritedPolicy={inheritedPolicy}
            locked={lock.locked}
          />
        }
      />
    </>
  );
}

/**
 * Merge base and merge policy on Epic and project-level root Story detail.
 * Other issues omit `mergeSettingsLock`, and this renders nothing for them.
 */
export function RootMergeSettingsMeta({ issue }: { issue: RootIssue }) {
  const { data } = useIssuesWithArchived(isArchived(issue));
  const settings = rootMergeSettingsFor(issue, data);
  if (!settings) return null;
  return <RootMergeSettingsRows issue={issue} {...settings} />;
}
