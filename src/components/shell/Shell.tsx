import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import {
  Bot,
  FileText,
  LayoutDashboard,
  Settings,
  Waypoints,
} from "lucide-react";

import { ConfirmProvider, Logo, ThemeToggle } from "@/components/ui";
import { cn } from "@/lib/cn";
import { resumePendingIngest } from "@/lib/ingest/pipeline";
import { listDocuments } from "@/lib/ipc";
import type { Doc } from "@/lib/types";

const NAV = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/editor", label: "Editor", icon: FileText, end: false },
  { to: "/graph", label: "Graph", icon: Waypoints, end: false },
  { to: "/assistant", label: "Assistant", icon: Bot, end: false },
] as const;

const RECENT_COUNT = 5;

export function Shell() {
  const location = useLocation();
  const [recent, setRecent] = useState<Doc[]>([]);

  useEffect(() => {
    // Pick up ingest work left queued/processing by a previous session.
    void resumePendingIngest();
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
        <aside className="flex w-56 shrink-0 flex-col border-r border-border bg-surface">
          <div className="flex items-center gap-2 px-4 pb-2 pt-4">
            <Logo />
          </div>

          <nav className="mt-4 flex flex-col gap-0.5 px-2">
            {NAV.map(({ to, label, icon: Icon, end }) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                className={({ isActive }) =>
                  cn(
                    "flex items-center gap-2.5 rounded-md px-2.5 py-1.5 font-medium transition-colors",
                    isActive
                      ? "bg-surface-raised text-foreground"
                      : "text-muted hover:bg-surface-raised/60 hover:text-foreground",
                  )
                }
              >
                <Icon className="h-4 w-4" strokeWidth={1.75} />
                {label}
              </NavLink>
            ))}
          </nav>

          {recent.length > 0 && (
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
          <div className="mt-auto flex h-[52px] shrink-0 items-center justify-between border-t border-border px-3">
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
            <ThemeToggle />
          </div>
        </aside>

        <main className="min-w-0 flex-1 overflow-hidden bg-background">
          <Outlet />
        </main>
      </div>
    </ConfirmProvider>
  );
}
