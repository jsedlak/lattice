import { useEffect } from "react";
import { NavLink, Outlet } from "react-router-dom";
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

const NAV = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/editor", label: "Editor", icon: FileText, end: false },
  { to: "/graph", label: "Graph", icon: Waypoints, end: false },
  { to: "/assistant", label: "Assistant", icon: Bot, end: false },
] as const;

export function Shell() {
  useEffect(() => {
    // Pick up ingest work left queued/processing by a previous session.
    void resumePendingIngest();
  }, []);

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
                    "flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13px] font-medium transition-colors",
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

          <div className="mt-auto flex items-center justify-between border-t border-border px-3 py-2.5">
            <NavLink
              to="/settings"
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-2 rounded-md px-2 py-1.5 text-[13px] font-medium transition-colors",
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
