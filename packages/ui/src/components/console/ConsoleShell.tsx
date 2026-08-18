import { useState } from "react";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import type { LucideIcon } from "lucide-react";
import {
  BarChart3,
  Boxes,
  Building2,
  ChevronDown,
  KeyRound,
  LogOut,
  Menu,
  Network,
  PieChart,
  RefreshCw,
  ScrollText,
  Search,
  Settings,
  ShieldCheck,
  Users,
  Wallet,
} from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { clearSession } from "@/lib/session";
import type { AdminSession } from "@/lib/api/auth";
import { cn } from "@/lib/utils";

type NavItem =
  | { to: string; label: string; icon: LucideIcon; soon?: false }
  | { label: string; icon: LucideIcon; soon: true };

interface NavSection {
  title: string;
  items: NavItem[];
}

const NAV_SECTIONS: NavSection[] = [
  {
    title: "AI Gateway",
    items: [
      { to: "/keys", label: "Access Keys", icon: KeyRound },
      { to: "/models", label: "Models & Routing", icon: Boxes },
      { to: "/guardrails", label: "Guardrails", icon: ShieldCheck },
    ],
  },
  {
    title: "Observability",
    items: [
      { to: "/usage", label: "Usage", icon: BarChart3 },
      { to: "/analytics", label: "Analytics", icon: PieChart },
      { to: "/logs", label: "Request Logs", icon: ScrollText },
    ],
  },
  {
    title: "Access Control",
    items: [
      { to: "/organization", label: "Organizations", icon: Building2 },
      { label: "Org Structure", icon: Network, soon: true },
      { label: "Access Groups", icon: Users, soon: true },
      { to: "/budgets", label: "Budgets", icon: Wallet },
      { label: "Directory Sync", icon: RefreshCw, soon: true },
    ],
  },
  {
    title: "Settings",
    items: [{ to: "/organization", label: "Settings", icon: Settings }],
  },
];

export function ConsoleShell({
  session,
  children,
}: {
  session: AdminSession;
  children: ReactNode;
}) {
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  function signOut() {
    clearSession();
    navigate({ to: "/" });
  }

  return (
    <div className="flex min-h-screen bg-background">
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 flex w-60 flex-col bg-sidebar text-sidebar-foreground transition-transform lg:static lg:translate-x-0",
          mobileOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="flex h-14 items-center gap-2 border-b border-sidebar-border px-4">
          <div className="flex size-7 items-center justify-center rounded bg-sidebar-primary text-xs font-bold text-sidebar-primary-foreground">
            AG
          </div>
          <div className="leading-tight">
            <div className="text-sm font-semibold">AI Gateway</div>
            <div className="text-[11px] text-sidebar-foreground/60">Admin console</div>
          </div>
        </div>
        <nav className="flex-1 space-y-4 overflow-y-auto p-2">
          {NAV_SECTIONS.map((section) => (
            <div key={section.title}>
              <div className="px-2.5 pb-1.5 pt-2 text-[11px] font-semibold uppercase tracking-wider text-sidebar-foreground/50">
                {section.title}
              </div>
              <div className="space-y-0.5">
                {section.items.map((item, idx) => {
                  const key = "to" in item ? item.to : `${section.title}-${idx}`;
                  const active = "to" in item ? pathname.startsWith(item.to) : false;

                  if (item.soon) {
                    return (
                      <div
                        key={key}
                        className="flex cursor-not-allowed items-center justify-between rounded-md px-2.5 py-2 text-sm text-sidebar-foreground/40"
                        title="Coming soon"
                      >
                        <span className="flex items-center gap-2.5">
                          <item.icon className="size-4" />
                          <span className="lg:inline">{item.label}</span>
                        </span>
                        <Badge variant="outline" className="h-4 border-sidebar-border px-1 text-[9px] text-sidebar-foreground/50">
                          Soon
                        </Badge>
                      </div>
                    );
                  }

                  return (
                    <Link
                      key={key}
                      to={item.to}
                      onClick={() => setMobileOpen(false)}
                      className={cn(
                        "flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors",
                        active
                          ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                          : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
                      )}
                    >
                      <item.icon className="size-4" />
                      <span className="lg:inline">{item.label}</span>
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>
        <div className="border-t border-sidebar-border px-4 py-3 text-[11px] text-sidebar-foreground/60">
          Gateway v2.14 · region eu-west-1
        </div>
      </aside>

      {mobileOpen ? (
        <div
          className="fixed inset-0 z-30 bg-foreground/40 lg:hidden"
          onClick={() => setMobileOpen(false)}
          aria-hidden
        />
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-border bg-surface px-4">
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden"
            onClick={() => setMobileOpen((v) => !v)}
            aria-label="Toggle navigation"
          >
            <Menu className="size-4" />
          </Button>
          <Select defaultValue="prod">
            <SelectTrigger className="h-8 w-44 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="prod">{session.organization} · prod</SelectItem>
              <SelectItem value="staging">{session.organization} · staging</SelectItem>
            </SelectContent>
          </Select>
          <div className="relative hidden max-w-sm flex-1 md:block">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input placeholder="Search models, teams, keys…" className="h-8 pl-8 text-sm" />
          </div>
          <div className="ml-auto">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="h-8 gap-2 px-2 text-sm" aria-label="User menu">
                  <span className="flex size-6 items-center justify-center rounded-full bg-accent text-[11px] font-semibold text-accent-foreground">
                    AO
                  </span>
                  <span className="hidden max-w-40 truncate sm:inline">{session.adminEmail}</span>
                  <ChevronDown className="size-3.5 text-muted-foreground" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
                  Signed in as
                  <div className="truncate text-sm font-medium text-foreground">
                    {session.adminEmail}
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={signOut}>
                  <LogOut className="size-4" /> Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>
        <main className="min-w-0 flex-1 space-y-4 p-4 lg:p-6">{children}</main>
      </div>
    </div>
  );
}
