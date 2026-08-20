import { useMemo, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import type { ConversationChannel, IssueDetail, IssueKind } from "@server/schemas";
import { RosterActiveRunIndicator } from "@/features/agents/components/conversation-list-item";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils/cn";
import { useIssueAgentRunsQuery } from "../api/queries";
import { useChannelTabIndicator } from "../hooks/use-channel-tab-indicator";
import {
  AGENTS_DETAIL_TAB,
  issueDetailTabNeedsBoundedShell,
  resolveIssueDetailTab,
  tabsForIssueDetail,
  writeIssueDetailTabParam,
  type IssueDetailTab,
  type IssueDetailTabKey,
} from "../lib/issue-detail-tabs";
import type { ChannelTabIndicator } from "../lib/channel-tab-indicator";
import type { SupportingDocPreviewTab } from "../lib/supporting-docs";
import { AgentRunsPanel } from "./agent-runs-panel";
import { ChannelTranscriptPanel } from "./channel-transcript-panel";
import { SupportingDocPreview } from "./supporting-doc-preview";

function isDocTab(tab: IssueDetailTab): tab is SupportingDocPreviewTab {
  return "ref" in tab;
}

function isAgentsTab(
  tab: IssueDetailTab,
): tab is Extract<IssueDetailTab, { key: typeof AGENTS_DETAIL_TAB }> {
  return tab.key === AGENTS_DETAIL_TAB;
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
  const isMobile = useIsMobile();
  const mobileChannelChrome =
    isMobile && issueDetailTabNeedsBoundedShell(active, tabs);

  const setActive = (next: IssueDetailTabKey) => {
    setSearchParams((prev) => writeIssueDetailTabParam(prev, next), {
      replace: true,
    });
  };

  const onBackToOverview = () => setActive("overview");

  const channelTabs = tabs.filter(isChannelTab);
  const agentsTabs = tabs.filter(isAgentsTab);
  const docTabs = tabs.filter(isDocTab);
  const showBar = tabs.length > 1;
  const overviewSelected = active === "overview";

  if (!showBar) {
    return (
      <div className="min-h-0 flex-1 overflow-y-auto">{overview}</div>
    );
  }

  return (
    <div
      className={cn(
        "flex min-h-0 flex-1 flex-col",
        mobileChannelChrome ? "gap-0" : "gap-4",
      )}
    >
      {mobileChannelChrome ? null : (
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
            ) : isAgentsTab(tab) ? (
              <AgentsTabButton
                key={tab.key}
                issueId={issue.id}
                selected={active === tab.key}
                onClick={() => setActive(tab.key)}
              >
                {tab.label}
              </AgentsTabButton>
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
      )}

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
              projectId={projectId}
              parentKind={parentKind}
              mobileFullViewport={mobileChannelChrome && selected}
              onBackToOverview={
                mobileChannelChrome && selected ? onBackToOverview : undefined
              }
            />
          </div>
        );
      })}

      {agentsTabs.map((tab) => {
        const selected = active === tab.key;
        return (
          <div
            key={tab.key}
            role="tabpanel"
            className={cn(
              "min-h-0 min-w-0 flex-1 overflow-y-auto",
              !selected && "hidden",
            )}
            {...tabPanelVisibility(selected)}
          >
            <AgentRunsPanel issueId={issue.id} projectId={projectId} />
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

function AgentsTabButton({
  issueId,
  selected,
  onClick,
  children,
}: {
  issueId: string;
  selected: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  const { data } = useIssueAgentRunsQuery(issueId);
  const count = data?.runs.length ?? 0;
  return (
    <TabButton selected={selected} onClick={onClick} count={count || undefined}>
      {children}
    </TabButton>
  );
}

function TabButton({
  selected,
  onClick,
  children,
  indicator = null,
  count,
}: {
  selected: boolean;
  onClick: () => void;
  children: ReactNode;
  indicator?: ChannelTabIndicator | null;
  count?: number;
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
      {count != null ? (
        <span
          className="inline-flex min-w-[1.1rem] shrink-0 items-center justify-center rounded-full bg-muted px-1.5 py-0 font-mono text-[10px] font-semibold tabular-nums leading-none text-muted-foreground"
          data-tab-count={count}
        >
          {count}
        </span>
      ) : null}
      <RosterActiveRunIndicator activeRun={activeRun} />
    </button>
  );
}
