import { Clock, Send, type LucideIcon } from "lucide-react";
import { NavLink, Outlet } from "react-router";
import logoUrl from "../../assets/onb-logo.png";
import { Button } from "../../components/ui/Button";
import { UserMenu } from "./UserMenu";

/** Figma dashboard: left sidebar (logo, user card, Compose, nav) + main area. */
export function DashboardLayout() {
  return (
    <div className="flex h-full">
      <aside className="flex w-[248px] shrink-0 flex-col gap-4 border-r border-border p-4">
        <img src={logoUrl} alt="ONB" className="h-7 w-auto self-start" />
        <UserMenu />
        {/* M11 wires this to the compose page. */}
        <Button variant="outline" className="w-full" disabled title="Coming soon">
          Compose
        </Button>

        <nav aria-label="Mailboxes" className="flex flex-col gap-1">
          <p className="px-3 pt-2 pb-1 text-[11px] tracking-wide text-ink-subtle uppercase">Core</p>
          <SidebarLink to="/dashboard" end icon={Clock} label="Scheduled" />
          <SidebarLink to="/dashboard/sent" icon={Send} label="Sent" />
        </nav>
      </aside>

      <main className="min-w-0 flex-1 overflow-auto p-4">
        <Outlet />
      </main>
    </div>
  );
}

interface SidebarLinkProps {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
}

function SidebarLink({ to, label, icon: Icon, end }: SidebarLinkProps) {
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
    </NavLink>
  );
}
