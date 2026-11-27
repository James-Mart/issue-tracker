import { useMemo } from "react";
import { FIELD_LABELS } from "@server/fields";
import type { ConversationChannel, IssueDetail, IssueRecord } from "@server/schemas";
import { useIssuesWithArchived } from "../hooks/use-issues-with-archived";
import { issuesById } from "../lib/build-tree";
import { IssueLink } from "./issue-link";
import { MetaRow } from "./meta-row";

type IdeaDetail = Extract<IssueDetail, { kind: "idea" }>;

function IssueTitleLinkList({
  ids,
  byId,
  channel,
}: {
  ids: string[];
  byId: Map<string, IssueRecord>;
  channel?: ConversationChannel;
}) {
  return (
    <span className="flex flex-col gap-1">
      {ids.map((id) => {
        const record = byId.get(id);
        const title = record?.title ?? id;
        return (
          <IssueLink
            key={id}
            id={id}
            channel={channel}
            className="text-primary hover:underline"
          >
            {title}
          </IssueLink>
        );
      })}
    </span>
  );
}

export function IssueGeneratedIssuesField({ issue }: { issue: IdeaDetail }) {
  const { data } = useIssuesWithArchived(true);
  const derived = data?.derived?.[issue.id];
  const generatedOutlines = derived?.generatedOutlines ?? [];
  const planRoots = derived?.planRoots ?? [];
  const issues = data?.issues ?? [];
  const byId = useMemo(() => issuesById(issues), [issues]);

  if (generatedOutlines.length > 0) {
    return (
      <MetaRow
        label={FIELD_LABELS.generatedOutline}
        value={
          <IssueTitleLinkList
            ids={generatedOutlines}
            byId={byId}
            channel="planning"
          />
        }
      />
    );
  }

  if (planRoots.length === 0) return null;

  return (
    <MetaRow
      label={FIELD_LABELS.generatedIssues}
      value={<IssueTitleLinkList ids={planRoots} byId={byId} />}
    />
  );
}
