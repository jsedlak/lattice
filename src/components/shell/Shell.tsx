import { useEffect, useRef, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import {
  Bot,
  FileText,
  LayoutDashboard,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  Waypoints,
} from "lucide-react";

import { ConfirmProvider, Logo, LogoMark, ResizeHandle } from "@/components/ui";
import { cn } from "@/lib/cn";
import { enqueueIngest, resumePendingIngest } from "@/lib/ingest/pipeline";
import { getWorkspaceInfo, listDocuments, syncWorkspace } from "@/lib/ipc";
import { layoutBootCache, loadLayoutPrefs, saveLayoutPrefs } from "@/lib/layout-prefs";
import type { Doc } from "@/lib/types";

const NAV = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/editor", label: "Editor", icon: FileText, end: false },
  { to: "/graph", label: "Graph", icon: Waypoints, end: false },
  { to: "/assistant", label: "Assistant", icon: Bot, end: false },
] as const;

const RECENT_COUNT = 5;
const COLLAPSED_WIDTH = 64;

export function Shell() {
  const location = useLocation();
  const [recent, setRecent] = useState<Doc[]>([]);
  const [collapsed, setCollapsed] = useState(() => layoutBootCache().sidebarCollapsed);
  const [width, setWidth] = useState(() => layoutBootCache().sidebarWidth);
  const [resizing, setResizing] = useState(false);
  const widthRef = useRef(width);

  // Reconcile with settings.json — the boot cache can be stale or missing.
  useEffect(() => {
    void loadLayoutPrefs().then((p) => {
      setCollapsed(p.sidebarCollapsed);
      setWidth(p.sidebarWidth);
      widthRef.current = p.sidebarWidth;
    });
  }, []);

  const toggleCollapsed = () => {
    const next = !collapsed;
    setCollapsed(next);
    saveLayoutPrefs({ sidebarCollapsed: next });
  };

  useEffect(() => {
    void (async () => {
      // Files mode: fold in whatever changed on disk since last launch, then
      // ingest it. Runs before resume so deleted notes' jobs are already gone.
      const workspace = await getWorkspaceInfo();
      if (workspace.mode === "files") {
        const report = await syncWorkspace();
        for (const id of [...report.added, ...report.changed]) enqueueIngest(id);
      }
      // Pick up ingest work left queued/processing by a previous session.
      await resumePendingIngest();
    })();
  }, []);

  // Refresh the Recent list on every navigation — edits elsewhere bump
  // updated_at, and navigation is when the list can go stale.
  useEffect(() => {
    void listDocuments().then((docs) =>
      setRecent(
        docs
          .slice()
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
          .slice(0, RECENT_COUNT),
      ),
    );
  }, [location.key]);

  return (
    <ConfirmProvider>
      <div className="flex h-full">
        <aside
          style={{ width: collapsed ? COLLAPSED_WIDTH : width }}
          className={cn(
            "flex shrink-0 flex-col border-r border-border bg-surface",
            !resizing && "transition-[width] duration-200",
          )}
        >
          {collapsed ? (
            <div className="flex flex-col items-center gap-3 pb-2 pt-4">
              <LogoMark />
              <button
                type="button"
                onClick={toggleCollapsed}
                title="Expand sidebar"
                className="rounded-md p-1.5 text-muted transition-colors hover:bg-surface-raised hover:text-foreground"
              >
                <PanelLeftOpen className="h-4 w-4" strokeWidth={1.75} />
              </button>
            </div>
          ) : (
            <div className="flex items-center justify-between px-4 pb-2 pt-4">
              <Logo />
              <button
                type="button"
                onClick={toggleCollapsed}
                title="Collapse sidebar"
                className="rounded-md p-1.5 text-muted transition-colors hover:bg-surface-raised hover:text-foreground"
              >
                <PanelLeftClose className="h-4 w-4" strokeWidth={1.75} />
              </button>
            </div>
          )}

          <nav className={cn("mt-4 flex flex-col gap-0.5", collapsed ? "px-2.5" : "px-2")}>
            {NAV.map(({ to, label, icon: Icon, end }) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                title={collapsed ? label : undefined}
                className={({ isActive }) =>
                  cn(
                    "flex items-center rounded-md py-1.5 font-medium transition-colors",
                    collapsed ? "justify-center px-0" : "gap-2.5 px-2.5",
                    isActive
                      ? "bg-surface-raised text-foreground"
                      : "text-muted hover:bg-surface-raised/60 hover:text-foreground",
                  )
                }
              >
                <Icon className="h-4 w-4 shrink-0" strokeWidth={1.75} />
                {!collapsed && label}
              </NavLink>
            ))}
          </nav>

          {!collapsed && recent.length > 0 && (
            <div className="mt-6 min-h-0 overflow-y-auto px-2">
              <div className="px-2.5 pb-1 text-[11px] font-medium uppercase tracking-wide text-faint">
                Recent
              </div>
              {recent.map((doc) => (
                <NavLink
                  key={doc.id}
                  to={`/editor/${doc.id}`}
                  className={({ isActive }) =>
                    cn(
                      "flex items-center gap-2.5 truncate rounded-md px-2.5 py-1.5 transition-colors",
                      isActive
                        ? "bg-surface-raised text-foreground"
                        : "text-muted hover:bg-surface-raised/60 hover:text-foreground",
                    )
                  }
                >
                  <FileText className="h-3.5 w-3.5 shrink-0 text-faint" strokeWidth={1.75} />
                  <span className="truncate">{doc.title}</span>
                </NavLink>
              ))}
            </div>
          )}

          {/* Footer — h-[52px] matches the document sidebar's footer so the top borders align. */}
          {collapsed ? (
            <div className="mt-auto flex h-[52px] shrink-0 items-center justify-center border-t border-border">
              <NavLink
                to="/settings"
                title="Settings"
                className={({ isActive }) =>
                  cn(
                    "rounded-md p-1.5 transition-colors",
                    isActive
                      ? "bg-surface-raised text-foreground"
                      : "text-muted hover:text-foreground",
                  )
                }
              >
                <Settings className="h-4 w-4" strokeWidth={1.75} />
              </NavLink>
            </div>
          ) : (
            <div className="mt-auto flex h-[52px] shrink-0 items-center border-t border-border px-3">
              <NavLink
                to="/settings"
                className={({ isActive }) =>
                  cn(
                    "flex items-center gap-2 rounded-md px-2 py-1.5 font-medium transition-colors",
                    isActive
                      ? "bg-surface-raised text-foreground"
                      : "text-muted hover:text-foreground",
                  )
                }
              >
                <Settings className="h-4 w-4" strokeWidth={1.75} />
                Settings
              </NavLink>
            </div>
          )}
        </aside>

        {!collapsed && (
          <ResizeHandle
            label="Resize sidebar"
            onStart={() => setResizing(true)}
            onResize={(x) => {
              // The sidebar starts at the window's left edge.
              const w = Math.min(400, Math.max(180, x));
              widthRef.current = w;
              setWidth(w);
            }}
            onEnd={() => {
              setResizing(false);
              saveLayoutPrefs({ sidebarWidth: widthRef.current });
            }}
          />
        )}

        <main className="min-w-0 flex-1 overflow-hidden bg-background">
          <Outlet />
        </main>
      </div>
    </ConfirmProvider>
  );
}
