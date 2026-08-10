import { useMemo, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import type { ConversationChannel, IssueDetail, IssueKind } from "@server/schemas";
import { RosterActiveRunIndicator } from "@/features/agents/components/conversation-list-item";
import { cn } from "@/lib/utils/cn";
import { useChannelTabIndicator } from "../hooks/use-channel-tab-indicator";
import {
  resolveIssueDetailTab,
  tabsForIssueDetail,
  writeIssueDetailTabParam,
  type IssueDetailTab,
  type IssueDetailTabKey,
} from "../lib/issue-detail-tabs";
import type { ChannelTabIndicator } from "../lib/channel-tab-indicator";
import type { SupportingDocPreviewTab } from "../lib/supporting-docs";
import { ChannelTranscriptPanel } from "./channel-transcript-panel";
import { SupportingDocPreview } from "./supporting-doc-preview";

function isDocTab(tab: IssueDetailTab): tab is SupportingDocPreviewTab {
  return "ref" in tab;
}

function isChannelTab(
  tab: IssueDetailTab,
): tab is Extract<IssueDetailTab, { channel: string }> {
  return "channel" in tab;
}

/**
 * Page-level tab bar below the persistent header. Overview always; optional
 * channel from `channelForIssue`; Project keeps supporting-doc preview tabs.
 * With Overview alone, no bar renders.
 */
export function IssueDetailTabs({
  issue,
  projectId,
  parentKind,
  overview,
}: {
  issue: IssueDetail;
  projectId: string;
  parentKind?: IssueKind;
  overview: ReactNode;
}) {
  const tabs = useMemo(
    () => tabsForIssueDetail(issue, parentKind),
    [issue, parentKind],
  );
  const [searchParams, setSearchParams] = useSearchParams();
  const active = resolveIssueDetailTab(searchParams.get("tab"), tabs);

  const setActive = (next: IssueDetailTabKey) => {
    setSearchParams((prev) => writeIssueDetailTabParam(prev, next), {
      replace: true,
    });
  };

  const channelTabs = tabs.filter(isChannelTab);
  const docTabs = tabs.filter(isDocTab);
  const showBar = tabs.length > 1;
  const overviewSelected = active === "overview";

  if (!showBar) {
    return (
      <div className="min-h-0 flex-1 overflow-y-auto">{overview}</div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div
        role="tablist"
        aria-label="Issue detail"
        className="flex shrink-0 flex-wrap gap-1 border-b border-border shell:flex-nowrap"
      >
        {tabs.map((tab) =>
          isChannelTab(tab) ? (
            <ChannelTabButton
              key={tab.key}
              issueId={issue.id}
              channel={tab.channel}
              selected={active === tab.key}
              onClick={() => setActive(tab.key)}
            >
              {tab.label}
            </ChannelTabButton>
          ) : (
            <TabButton
              key={tab.key}
              selected={active === tab.key}
              onClick={() => setActive(tab.key)}
            >
              {tab.label}
            </TabButton>
          ),
        )}
      </div>

      <div
        role="tabpanel"
        className={cn(
          "flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto",
          !overviewSelected && "hidden",
        )}
        {...tabPanelVisibility(overviewSelected)}
      >
        {overview}
      </div>

      {channelTabs.map((tab) => {
        const selected = active === tab.key;
        return (
          <div
            key={tab.key}
            role="tabpanel"
            className={cn(
              "flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden",
              !selected && "hidden",
            )}
            {...tabPanelVisibility(selected)}
          >
            <ChannelTranscriptPanel
              issueId={issue.id}
              issue={issue}
              channel={tab.channel}
              label={tab.label}
            />
          </div>
        );
      })}

      {docTabs.map((tab) => {
        const selected = active === tab.key;
        const fillsReadingArea = tab.format === "html";
        return (
          <div
            key={tab.key}
            role="tabpanel"
            className={cn(
              "min-h-0 min-w-0 flex-1",
              fillsReadingArea ? "flex flex-col" : "overflow-y-auto",
              !selected && "hidden",
            )}
            {...tabPanelVisibility(selected)}
          >
            <SupportingDocPreview projectId={projectId} tab={tab} />
          </div>
        );
      })}
    </div>
  );
}

/** Keep panels mounted; freeze inactive ones. `inert` cast: React 18 DOM types omit it. */
function tabPanelVisibility(selected: boolean): Record<string, unknown> {
  return selected ? {} : { inert: "" };
}

function ChannelTabButton({
  issueId,
  channel,
  selected,
  onClick,
  children,
}: {
  issueId: string;
  channel: ConversationChannel;
  selected: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  const indicator = useChannelTabIndicator(issueId, channel);
  return (
    <TabButton
      selected={selected}
      onClick={onClick}
      indicator={indicator}
    >
      {children}
    </TabButton>
  );
}

function TabButton({
  selected,
  onClick,
  children,
  indicator = null,
}: {
  selected: boolean;
  onClick: () => void;
  children: ReactNode;
  indicator?: ChannelTabIndicator | null;
}) {
  const awaiting = indicator === "awaiting-human";
  const activeRun = indicator === "active-run";

  return (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      onClick={onClick}
      data-channel-tab-indicator={indicator ?? undefined}
      className={cn(
        "-mb-px inline-flex items-center gap-1.5 border-b-2 px-3 py-2 font-display text-[11px] font-semibold uppercase tracking-[0.14em] transition-colors",
        awaiting
          ? selected
            ? "border-[hsl(var(--warning))] [color:hsl(var(--warning))]"
            : "border-transparent [color:hsl(var(--warning))] hover:[color:hsl(var(--warning))]"
          : selected
            ? "border-[hsl(var(--current))] text-[hsl(var(--current))]"
            : "border-transparent text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
      <RosterActiveRunIndicator activeRun={activeRun} />
    </button>
  );
}
