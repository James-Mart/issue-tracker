import { useMemo, type ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { FolderKanban, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
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
  SidebarHeader,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { cn } from "@/lib/utils/cn";
import { useIssuesQuery } from "../api/queries";
import { useRouteProjectId } from "../hooks/use-route-project-id";
import { useIssueUiStore } from "../store/use-issue-ui-store";
import { listProjects } from "../lib/build-tree";
import { issuePath, projectPath } from "../lib/links";

/** A quiet nav item on the bus: strips the accent fill so only the port + ink read. */
const busItem =
  "group/bus-btn text-muted-foreground hover:bg-transparent hover:text-foreground focus-visible:bg-transparent active:bg-transparent data-[active=true]:bg-transparent data-[active=true]:text-foreground data-[active=true]:font-medium";

/**
 * A station on the bus. Idle ports are hollow rail-lit discs; the active port
 * (driven by the button's `data-active`) and any port under hover light
 * `current` with the live glow — the same selection treatment the design system
 * gives nav ports. The `[box-shadow:var(--glow)]` literals are written out (not
 * imported from `currentGlow`) because they're applied through `group-*`
 * variants, and Tailwind only emits variant classes it can see as whole strings.
 */
function BusPort() {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "h-2.5 w-2.5 shrink-0 rounded-full border transition-[background-color,border-color,box-shadow] duration-150",
        "border-[hsl(var(--rail-lit))] bg-[hsl(var(--background))]",
        "group-hover/menu-item:border-[hsl(var(--current))] group-hover/menu-item:bg-[hsl(var(--current))] group-hover/menu-item:[box-shadow:var(--glow)]",
        "group-data-[active=true]/bus-btn:border-[hsl(var(--current))] group-data-[active=true]/bus-btn:bg-[hsl(var(--current))] group-data-[active=true]/bus-btn:[box-shadow:var(--glow)]",
      )}
    />
  );
}

/** A station on the bus: a port + label link, with an optional trailing slot (e.g. row actions). */
function BusNavItem({
  to,
  isActive,
  tooltip,
  label,
  children,
}: {
  to: string;
  isActive: boolean;
  tooltip: string;
  label: string;
  children?: ReactNode;
}) {
  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild isActive={isActive} tooltip={tooltip} className={busItem}>
        <Link to={to}>
          <BusPort />
          <span>{label}</span>
        </Link>
      </SidebarMenuButton>
      {children}
    </SidebarMenuItem>
  );
}

export function ProjectSidebar() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const selectedProjectId = useRouteProjectId();
  const { data } = useIssuesQuery();
  const openProjectDialog = useIssueUiStore((s) => s.openProjectDialog);
  const requestDelete = useIssueUiStore((s) => s.requestDelete);

  const projects = useMemo(
    () => listProjects(data?.issues ?? []),
    [data?.issues],
  );

  const isCockpit = pathname === "/";

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <Link
          to="/"
          className="flex items-center gap-2 rounded-md px-2 py-1.5 text-left outline-none ring-sidebar-ring transition-colors hover:text-foreground focus-visible:ring-2"
        >
          <FolderKanban className="h-5 w-5 shrink-0 text-primary" />
          <span className="truncate font-semibold group-data-[collapsible=icon]:hidden">
            Issue Tracker
          </span>
        </Link>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          {/* The bus: one continuous spine threading the Cockpit and project ports. */}
          <div className="relative">
            <span
              aria-hidden="true"
              className="pointer-events-none absolute left-3 top-4 bottom-4 w-0.5 rounded-[2px] bg-[hsl(var(--rail))] group-data-[collapsible=icon]:hidden"
            />
            <SidebarMenu>
              <BusNavItem
                to="/"
                isActive={isCockpit}
                tooltip="Cockpit"
                label="Cockpit"
              />
            </SidebarMenu>

            <div className="flex items-center justify-between pl-[26px] pr-2 pt-3 pb-1 group-data-[collapsible=icon]:hidden">
              <span className="text-xs font-medium text-muted-foreground/70">
                Projects
              </span>
              <button
                type="button"
                title="New project"
                onClick={() => openProjectDialog()}
                className="flex aspect-square w-5 items-center justify-center rounded-md text-sidebar-foreground outline-none ring-sidebar-ring transition-colors hover:text-foreground focus-visible:ring-2"
              >
                <Plus className="h-4 w-4" />
                <span className="sr-only">New project</span>
              </button>
            </div>

            <SidebarMenu>
              {projects.length === 0 ? (
                <p className="pl-[26px] pr-2 py-1.5 text-xs text-muted-foreground group-data-[collapsible=icon]:hidden">
                  Create a project.
                </p>
              ) : (
                projects.map((project) => (
                  <BusNavItem
                    key={project.id}
                    to={projectPath(project.id)}
                    isActive={project.id === selectedProjectId}
                    tooltip={project.title}
                    label={project.title}
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
                  </BusNavItem>
                ))
              )}
            </SidebarMenu>
          </div>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}
