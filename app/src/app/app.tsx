import { Route, Routes } from "react-router-dom";
import { Suspense, lazy, useEffect } from "react";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { PageShell } from "@/components/page-shell";
import { ShellLoadingState } from "@/app/shell-state";
import { NewIssueDialog } from "@/features/issues/components/new-issue-dialog";
import { DeleteIssueDialog } from "@/features/issues/components/delete-issue-dialog";
import { ProjectSidebar } from "@/features/issues/components/project-sidebar";
import { ProjectDialog } from "@/features/issues/components/project-dialog";
import { TopBar } from "@/features/issues/components/top-bar";
import { useIssueEvents } from "@/features/issues/hooks/use-issue-events";

const CockpitPage = lazy(() =>
  import("@/features/issues/components/cockpit-page").then((m) => ({
    default: m.CockpitPage,
  })),
);
const AgentsPage = lazy(() =>
  import("@/features/agents/components/agents-page").then((m) => ({
    default: m.AgentsPage,
  })),
);
const PipelinePage = lazy(() =>
  import("@/features/pipeline/components/pipeline-page").then((m) => ({
    default: m.PipelinePage,
  })),
);
const OverviewPage = lazy(() =>
  import("@/features/issues/components/overview-page").then((m) => ({
    default: m.OverviewPage,
  })),
);
const IssueDetailPage = lazy(() =>
  import("@/features/issues/components/issue-detail-page").then((m) => ({
    default: m.IssueDetailPage,
  })),
);

const LEGACY_SELECTED_PROJECT_KEY = "issue-tracker.selectedProject";

export function App() {
  useIssueEvents();
  useEffect(() => {
    localStorage.removeItem(LEGACY_SELECTED_PROJECT_KEY);
  }, []);

  return (
    <SidebarProvider>
      <ProjectSidebar />
      <SidebarInset>
        <TopBar />
        <Suspense
          fallback={
            <PageShell>
              <ShellLoadingState label="Loading page…" />
            </PageShell>
          }
        >
          <Routes>
            <Route path="/" element={<CockpitPage />} />
            <Route path="/agents" element={<AgentsPage />} />
            <Route path="/pipeline" element={<PipelinePage />} />
            <Route path="/pipeline/runs" element={<PipelinePage />} />
            <Route
              path="/pipeline/runs/:conversationId"
              element={<PipelinePage />}
            />
            <Route path="/projects/:projectId" element={<OverviewPage />} />
            <Route
              path="/projects/:projectId/issues/:id"
              element={<IssueDetailPage />}
            />
          </Routes>
        </Suspense>
      </SidebarInset>
      <NewIssueDialog />
      <DeleteIssueDialog />
      <ProjectDialog />
    </SidebarProvider>
  );
}
