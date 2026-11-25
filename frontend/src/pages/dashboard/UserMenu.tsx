import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, LogOut, MessageSquare } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { logout } from "../../api/auth";
import { useMe } from "../../auth/useMe";
import { Avatar } from "../../components/ui/Avatar";
import { Spinner } from "../../components/ui/Spinner";
import { useToast } from "../../components/ui/toastContext";

const itemClasses =
  "flex w-full items-center gap-2 rounded-control px-3 py-2 text-left text-sm " +
  "enabled:hover:bg-surface-muted disabled:cursor-not-allowed disabled:text-ink-subtle";

/** Figma sidebar user card (avatar, name, email, chevron) with an account menu. */
export function UserMenu() {
  const { data: me } = useMe(); // always loaded: rendered behind <RequireAuth>
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const toast = useToast();

  const logoutMutation = useMutation({
    mutationFn: logout,
    onSuccess: () => {
      queryClient.clear();
      void navigate("/login", { replace: true });
    },
    onError: () => toast.error("Couldn't log out. Please try again."),
  });

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  if (!me) return null;

  return (
    <div ref={rootRef} className="relative">
      <div className="flex items-center gap-3 rounded-card bg-surface-muted p-3">
        <Avatar name={me.name} src={me.avatarUrl} size={32} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{me.name}</p>
          <p className="truncate text-[11px] text-ink-muted">{me.email}</p>
        </div>
        <button
          type="button"
          aria-label="Account menu"
          aria-haspopup="menu"
          aria-expanded={open}
          aria-controls={menuId}
          onClick={() => setOpen((o) => !o)}
          className="rounded-control p-1 text-ink-muted hover:bg-surface hover:text-ink"
        >
          <ChevronDown aria-hidden size={16} className={open ? "rotate-180" : ""} />
        </button>
      </div>

      {open && (
        <div
          id={menuId}
          role="menu"
          aria-label="Account"
          className="absolute inset-x-0 top-full z-10 mt-1 rounded-card border border-border bg-surface p-1 shadow-popover"
        >
          {/* Placeholder: the Connect Slack flow is wired up in M11. */}
          <button type="button" role="menuitem" disabled className={itemClasses}>
            <MessageSquare aria-hidden size={16} />
            Connect Slack
            <span className="ml-auto text-[11px]">Soon</span>
          </button>
          <button
            type="button"
            role="menuitem"
            className={itemClasses}
            disabled={logoutMutation.isPending}
            onClick={() => logoutMutation.mutate()}
          >
            {logoutMutation.isPending ? <Spinner size={16} label="Logging out" /> : <LogOut aria-hidden size={16} />}
            Log out
          </button>
        </div>
      )}
    </div>
  );
}
