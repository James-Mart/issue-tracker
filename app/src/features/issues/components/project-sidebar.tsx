import { useEffect, useMemo, type ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  Bot,
  FolderKanban,
  LayoutDashboard,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import { projectAvatarFromId } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { cn } from "@/lib/utils/cn";
import { useIssuesQuery } from "../api/queries";
import { useRouteProjectId } from "../hooks/use-route-project-id";
import { useIssueUiStore } from "../store/use-issue-ui-store";
import { listProjects } from "../lib/build-tree";
import { issuePath, projectPath } from "../lib/links";

function NavItem({
  to,
  isActive,
  tooltip,
  label,
  icon: Icon,
  glyph,
  children,
}: {
  to: string;
  isActive: boolean;
  tooltip: string;
  label: string;
  icon?: LucideIcon;
  glyph?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild isActive={isActive} tooltip={tooltip}>
        <Link to={to}>
          {glyph ?? (Icon ? <Icon /> : null)}
          <span>{label}</span>
        </Link>
      </SidebarMenuButton>
      {children}
    </SidebarMenuItem>
  );
}

function ProjectNavGlyph({
  projectId,
  title,
}: {
  projectId: string;
  title: string;
}) {
  const { initials, colorClass } = projectAvatarFromId(projectId, title);

  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex size-4 shrink-0 items-center justify-center rounded-full font-mono text-[9px] font-semibold leading-none",
        colorClass,
      )}
    >
      {initials}
    </span>
  );
}

/**
 * On mobile the sidebar lives in an off-canvas sheet that covers the page, so any
 * navigation out of it has to hand the screen back to the destination. Keyed on
 * the location `key` rather than the pathname so re-tapping the current route
 * dismisses the sheet too.
 */
function useDismissMobileSidebarOnNavigate(locationKey: string) {
  const { isMobile, setOpenMobile } = useSidebar();

  useEffect(() => {
    if (isMobile) setOpenMobile(false);
  }, [locationKey, isMobile, setOpenMobile]);
}

export function ProjectSidebar() {
  const navigate = useNavigate();
  const { pathname, key: locationKey } = useLocation();
  const selectedProjectId = useRouteProjectId();
  useDismissMobileSidebarOnNavigate(locationKey);
  const { data } = useIssuesQuery();
  const openProjectDialog = useIssueUiStore((s) => s.openProjectDialog);
  const requestDelete = useIssueUiStore((s) => s.requestDelete);

  const projects = useMemo(
    () => listProjects(data?.issues ?? []),
    [data?.issues],
  );

  const isCockpit = pathname === "/";
  const isAgents = pathname === "/agents" || pathname.startsWith("/agents/");

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <Link
          to="/"
          className="flex items-center gap-2 rounded-md px-2 py-1.5 text-left outline-none ring-sidebar-ring transition-colors hover:text-foreground focus-visible:ring-2 touch:min-h-11"
        >
          <FolderKanban className="h-5 w-5 shrink-0 text-primary" />
          <span className="truncate font-semibold group-data-[collapsible=icon]:hidden">
            Issue Tracker
          </span>
        </Link>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarMenu>
            <NavItem
              to="/"
              isActive={isCockpit}
              tooltip="Cockpit"
              label="Cockpit"
              icon={LayoutDashboard}
            />
            <NavItem
              to="/agents"
              isActive={isAgents}
              tooltip="Agents"
              label="Agents"
              icon={Bot}
            />
          </SidebarMenu>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>Projects</SidebarGroupLabel>
          <SidebarGroupAction
            title="New project"
            className="touch:h-11 touch:w-11"
            onClick={() => openProjectDialog()}
          >
            <Plus />
            <span className="sr-only">New project</span>
          </SidebarGroupAction>
          <SidebarGroupContent>
            <SidebarMenu>
              {projects.length === 0 ? (
                <p className="px-2 py-1.5 text-xs text-muted-foreground group-data-[collapsible=icon]:hidden">
                  Create a project.
                </p>
              ) : (
                projects.map((project) => (
                  <NavItem
                    key={project.id}
                    to={projectPath(project.id)}
                    isActive={project.id === selectedProjectId}
                    tooltip={project.title}
                    label={project.title}
                    glyph={
                      <ProjectNavGlyph
                        projectId={project.id}
                        title={project.title}
                      />
                    }
                  >
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <SidebarMenuAction showOnHover>
                          <MoreHorizontal />
                          <span className="sr-only">Project actions</span>
                        </SidebarMenuAction>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent side="right" align="start">
                        <DropdownMenuItem
                          onClick={() =>
                            navigate(issuePath(project.id, project.id))
                          }
                        >
                          <FolderKanban className="h-4 w-4" />
                          Open
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() =>
                            openProjectDialog({
                              id: project.id,
                              title: project.title,
                            })
                          }
                        >
                          <Pencil className="h-4 w-4" />
                          Rename
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          className="text-destructive focus:text-destructive"
                          onClick={() => requestDelete(project.id)}
                        >
                          <Trash2 className="h-4 w-4" />
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </NavItem>
                ))
              )}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}
