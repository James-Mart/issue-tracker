import { Route, Routes } from "react-router-dom";
import { useEffect } from "react";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { CockpitPage } from "@/features/issues/components/cockpit-page";
import { OverviewPage } from "@/features/issues/components/overview-page";
import { IssueDetailPage } from "@/features/issues/components/issue-detail-page";
import { NewIssueDialog } from "@/features/issues/components/new-issue-dialog";
import { DeleteIssueDialog } from "@/features/issues/components/delete-issue-dialog";
import { ProjectSidebar } from "@/features/issues/components/project-sidebar";
import { ProjectDialog } from "@/features/issues/components/project-dialog";
import { TopBar } from "@/features/issues/components/top-bar";
import { useIssueEvents } from "@/features/issues/hooks/use-issue-events";

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
        <Routes>
          <Route path="/" element={<CockpitPage />} />
          <Route path="/projects/:projectId" element={<OverviewPage />} />
          <Route
            path="/projects/:projectId/issues/:id"
            element={<IssueDetailPage />}
          />
        </Routes>
      </SidebarInset>
      <NewIssueDialog />
      <DeleteIssueDialog />
      <ProjectDialog />
    </SidebarProvider>
  );
}
