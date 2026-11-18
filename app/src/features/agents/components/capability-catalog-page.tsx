import { useEffect, useLayoutEffect, useRef, type ReactNode, type RefObject } from "react";
import { ArrowLeft, ChevronRight } from "lucide-react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import type {
  CapabilityCatalog,
  CatalogEntry,
} from "@server/services/capability-catalog";
import { PageShell } from "@/components/page-shell";
import { DetailEyebrow, SETTINGS_HEADING_CLASS } from "@/features/issues/components/detail-section";
import { ShellInlineFault, ShellLoadingState, ShellState } from "@/app/shell-state";
import { Button } from "@/components/ui/button";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils/cn";
import {
  tabTitleEntityName,
  useTabTitle,
} from "@/lib/tab-title/use-tab-title";
import { useCapabilityCatalogQuery } from "../api/queries";
import {
  AGENTS_CATALOG_PATH,
  agentsCatalogDefaultPath,
  agentsCatalogEntryPath,
  type AgentsCatalogSelection,
} from "../lib/links";
import { CapabilityCatalogContract } from "./capability-catalog-contract";

/** The top bar can wrap past 3rem, so the catalog measures the space under it. */
function useCatalogViewportHeight(ref: RefObject<HTMLDivElement | null>) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = () => {
      const top = el.getBoundingClientRect().top;
      const height = Math.max(0, window.innerHeight - top);
      el.style.height = `${height}px`;
      const shell = el.firstElementChild;
      if (shell instanceof HTMLElement) {
        shell.style.height = `${height}px`;
        shell.style.minHeight = "0px";
      }
    };
    fit();
    const header = el.closest("main")?.querySelector(":scope > header");
    const observer = new ResizeObserver(fit);
    if (header) observer.observe(header);
    window.addEventListener("resize", fit);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", fit);
    };
  }, [ref]);
}

function listDescription(description: string): string {
  const sentence = /^.+?\./.exec(description);
  return sentence ? sentence[0] : description;
}

function entrySelected(
  entry: CatalogEntry,
  selection: AgentsCatalogSelection,
  isMobile: boolean,
): boolean {
  if (entry.kind === "default") {
    return selection.kind === "default" || (!isMobile && selection.kind === "list");
  }
  if (entry.kind === "profile") {
    return selection.kind === "profile" && selection.id === entry.id;
  }
  return selection.kind === "role" && selection.id === entry.id;
}

function resolveEntry(
  catalog: CapabilityCatalog,
  selection: AgentsCatalogSelection,
  isMobile: boolean,
): CatalogEntry | "missing" | null {
  if (selection.kind === "list") {
    return isMobile ? null : catalog.sharedDefault;
  }
  if (selection.kind === "default") return catalog.sharedDefault;
  const entries =
    selection.kind === "profile" ? catalog.profiles : catalog.roles;
  return entries.find((entry) => entry.id === selection.id) ?? "missing";
}

function CatalogHeader() {
  return (
    <header>
      <DetailEyebrow>Agents</DetailEyebrow>
      <h1 className="font-display text-xl font-semibold text-foreground">
        Capability catalog
      </h1>
      <p className="max-w-[72ch] text-sm text-muted-foreground">
        Resolved contracts for the shared default, each profile, and every
        spawnable role.
      </p>
    </header>
  );
}

function CatalogRow({
  entry,
  selected,
}: {
  entry: CatalogEntry;
  selected: boolean;
}) {
  const ref = useRef<HTMLAnchorElement>(null);
  useEffect(() => {
    if (!selected) return;
    ref.current?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  return (
    <Link
      ref={ref}
      to={agentsCatalogEntryPath(entry)}
      aria-current={selected ? "true" : undefined}
      data-testid={`catalog-entry-${entry.kind}-${entry.id}`}
      className={cn(
        "block rounded-lg border px-3 py-2.5 no-underline transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring touch:min-h-11",
        selected
          ? "border-[hsl(var(--current))] bg-[hsl(var(--current)/0.08)]"
          : "border-border bg-card hover:border-[hsl(var(--rail-lit))]",
      )}
    >
      <span className="flex items-center justify-between gap-2">
        <span className="min-w-0 truncate text-sm font-medium text-foreground">
          {entry.title}
        </span>
        <ChevronRight
          className="size-4 shrink-0 text-muted-foreground shell:hidden"
          aria-hidden
        />
      </span>
      {entry.description ? (
        <span className="mt-0.5 line-clamp-2 block text-xs text-muted-foreground">
          {listDescription(entry.description)}
        </span>
      ) : null}
    </Link>
  );
}

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <h2 className={`px-1 pb-1 pt-4 ${SETTINGS_HEADING_CLASS}`}>
      {children}
    </h2>
  );
}

function CatalogList({
  catalog,
  selection,
  isMobile,
}: {
  catalog: CapabilityCatalog;
  selection: AgentsCatalogSelection;
  isMobile: boolean;
}) {
  return (
    <nav
      aria-label="Capability catalog"
      data-testid="capability-catalog-list"
      className={cn(
        "flex min-h-0 flex-col",
        isMobile ? "flex-1" : "w-80 shrink-0 border-r border-border",
      )}
    >
      {isMobile ? null : (
        <div className="shrink-0 border-b border-border px-4 py-3">
          <h2 className="text-sm font-medium text-foreground">Catalog</h2>
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        <ul className="space-y-2">
          <li>
            <CatalogRow
              entry={catalog.sharedDefault}
              selected={entrySelected(catalog.sharedDefault, selection, isMobile)}
            />
          </li>
        </ul>
        <SectionLabel>Profiles</SectionLabel>
        <ul className="space-y-2">
          {catalog.profiles.map((entry) => (
            <li key={entry.id}>
              <CatalogRow
                entry={entry}
                selected={entrySelected(entry, selection, isMobile)}
              />
            </li>
          ))}
        </ul>
        <SectionLabel>
          Roles{" "}
          <span className="tabular-nums">{catalog.roles.length}</span>
        </SectionLabel>
        <ul className="space-y-2">
          {catalog.roles.map((entry) => (
            <li key={entry.id}>
              <CatalogRow
                entry={entry}
                selected={entrySelected(entry, selection, isMobile)}
              />
            </li>
          ))}
        </ul>
      </div>
    </nav>
  );
}

function ContractPane({
  entry,
  isMobile,
}: {
  entry: CatalogEntry | "missing";
  isMobile: boolean;
}) {
  const navigate = useNavigate();
  const title =
    entry === "missing"
      ? "Missing entry"
      : entry.kind === "role"
        ? (entry.roleId ?? entry.title)
        : entry.title;

  return (
    <section
      aria-label="Resolved contract"
      className="flex min-h-0 min-w-0 flex-1 flex-col"
    >
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-3">
        {isMobile ? (
          <Button
            variant="ghost"
            size="sm"
            className="-ml-2 h-7 gap-1 px-2"
            onClick={() => navigate(AGENTS_CATALOG_PATH)}
            aria-label="Back to catalog"
            data-testid="catalog-back"
          >
            <ArrowLeft className="h-4 w-4" />
            Back
          </Button>
        ) : null}
        <h2 className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
          {isMobile ? title : "Resolved contract"}
        </h2>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {entry === "missing" ? (
          <ShellState
            className="m-4 border-0 bg-transparent px-4 py-8 shadow-none"
            eyebrow="Missing"
            title="This entry is not in the catalog."
            detail="It is not the shared default, a profile, or a spawnable role."
          />
        ) : (
          <CapabilityCatalogContract entry={entry} />
        )}
      </div>
    </section>
  );
}

function catalogSelection(
  pathname: string,
  profileId: string | undefined,
  roleId: string | undefined,
): AgentsCatalogSelection {
  if (profileId !== undefined) return { kind: "profile", id: profileId };
  if (roleId !== undefined) return { kind: "role", id: roleId };
  if (pathname === agentsCatalogDefaultPath()) return { kind: "default" };
  return { kind: "list" };
}

function CapabilityCatalogView({ catalog }: { catalog: CapabilityCatalog }) {
  const { pathname } = useLocation();
  const { profileId, roleId } = useParams<{
    profileId?: string;
    roleId?: string;
  }>();
  const isMobile = useIsMobile();
  const selection = catalogSelection(pathname, profileId, roleId);
  const entry = resolveEntry(catalog, selection, isMobile);
  const showList = !isMobile || selection.kind === "list";
  const showContract = entry !== null;
  const tabName =
    entry && entry !== "missing"
      ? tabTitleEntityName(
          entry.kind === "role" ? entry.roleId : entry.title,
          entry.id,
        )
      : "Agents";
  useTabTitle(tabName, entry ? "Agents" : undefined);
  const frameRef = useRef<HTMLDivElement>(null);
  useCatalogViewportHeight(frameRef);

  return (
    <div ref={frameRef} className="flex min-h-0 flex-col overflow-hidden">
      <PageShell className="min-h-0 max-w-6xl flex-1 gap-4 overflow-hidden py-6">
        {showList ? <CatalogHeader /> : null}
        <div
          className={cn(
            "flex min-h-0 flex-1 overflow-hidden rounded-lg border border-border bg-card",
            !isMobile && "flex-row",
          )}
        >
          {showList ? (
            <CatalogList
              catalog={catalog}
              selection={selection}
              isMobile={isMobile}
            />
          ) : null}
          {showContract ? (
            <ContractPane entry={entry} isMobile={isMobile} />
          ) : null}
        </div>
      </PageShell>
    </div>
  );
}

export function CapabilityCatalogPage() {
  const catalog = useCapabilityCatalogQuery();
  if (catalog.isPending) {
    return (
      <PageShell>
        <ShellLoadingState label="Loading capability catalog…" />
      </PageShell>
    );
  }
  if (catalog.isError || !catalog.data) {
    return (
      <PageShell>
        <ShellInlineFault
          message={catalog.error?.message ?? "Could not load the capability catalog."}
          hint="Reload the page to read the capability document again."
        />
      </PageShell>
    );
  }
  return <CapabilityCatalogView catalog={catalog.data} />;
}
