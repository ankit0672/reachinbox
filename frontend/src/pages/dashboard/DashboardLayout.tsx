import { useIsFetching, useQueryClient } from "@tanstack/react-query";
import { Clock, RotateCw, Send, type LucideIcon } from "lucide-react";
import { NavLink, Outlet, useMatch, useSearchParams } from "react-router";
import type { EmailTab } from "../../api/emails";
import logoUrl from "../../assets/onb-logo.png";
import { Button } from "../../components/ui/Button";
import { emailKeys, useEmailCount } from "../../emails/queries";
import { SearchBox } from "./SearchBox";
import { SearchResults } from "./SearchResults";
import { UserMenu } from "./UserMenu";

/** Figma dashboard: left sidebar (logo, user card, Compose, nav) + main area. */
export function DashboardLayout() {
  const [params] = useSearchParams();
  const q = params.get("q")?.trim() ?? "";
  return (
    <div className="flex h-full">
      <aside className="flex w-[248px] shrink-0 flex-col gap-4 p-4">
        <img src={logoUrl} alt="ONB" className="h-7 w-auto self-start" />
        <UserMenu />
        {/* Part D wires this to the compose page. */}
        <Button variant="outline" className="w-full" disabled title="Coming soon">
          Compose
        </Button>
        <MailboxNav />
      </aside>

      <main className="flex min-w-0 flex-1 flex-col">
        <Toolbar />
        <div className="min-h-0 flex-1 overflow-auto px-4">
          {/* A search replaces the tab list; clearing it brings the list back. */}
          {q ? <SearchResults key={q} q={q} /> : <Outlet />}
        </div>
      </main>
    </div>
  );
}

function MailboxNav() {
  // Counts poll alongside the Scheduled list, so they move live too.
  const live = useMatch("/dashboard") !== null;
  return (
    <nav aria-label="Mailboxes" className="flex flex-col gap-1">
      <p className="px-3 pt-2 pb-1 text-[11px] tracking-wide text-ink-subtle uppercase">Core</p>
      <SidebarLink to="/dashboard" end icon={Clock} label="Scheduled" tab="scheduled" live={live} />
      <SidebarLink to="/dashboard/sent" icon={Send} label="Sent" tab="sent" live={live} />
    </nav>
  );
}

interface SidebarLinkProps {
  to: string;
  label: string;
  icon: LucideIcon;
  tab: EmailTab;
  live: boolean;
  end?: boolean;
}

function SidebarLink({ to, label, icon: Icon, tab, live, end }: SidebarLinkProps) {
  const count = useEmailCount(tab, live);
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        `flex h-9 items-center gap-3 rounded-control px-3 text-sm transition-colors ${
          isActive ? "bg-primary-soft font-semibold" : "hover:bg-surface-muted"
        }`
      }
    >
      <Icon aria-hidden size={18} className="text-ink-muted" />
      {label}
      {count.data !== undefined && (
        <span
          className="ml-auto text-xs font-normal text-ink-muted"
          aria-label={`${count.data} ${label.toLowerCase()}`}
        >
          {count.data}
        </span>
      )}
    </NavLink>
  );
}

function Toolbar() {
  const queryClient = useQueryClient();
  const fetching = useIsFetching({ queryKey: emailKeys.all }) > 0;
  return (
    <div className="flex h-16 shrink-0 items-center gap-3 px-4">
      <SearchBox />
      <div className="flex-1" />
      <button
        type="button"
        aria-label="Refresh"
        title="Refresh"
        onClick={() => void queryClient.invalidateQueries({ queryKey: emailKeys.all })}
        className="rounded-control p-2 text-ink-muted hover:bg-surface-muted hover:text-ink"
      >
        <RotateCw aria-hidden size={18} className={fetching ? "animate-spin" : ""} />
      </button>
    </div>
  );
}
